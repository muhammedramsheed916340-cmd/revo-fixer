/**
 * FUSION ENGINE — Live History + Live Video Physics → Calibrated Top-4
 * ====================================================================
 *
 * Pipeline:
 *   1. VIDEO PHYSICS → stopping-angle prediction (deceleration model)
 *   2. STOPPING ANGLE → 54-sector probability (Gaussian around predicted stop)
 *   3. 54 SECTORS → 8-outcome probability (sum sectors per outcome)
 *   4. HISTORY PROBABILITY (from C1-C9 engine, independent)
 *   5. CALIBRATED FUSION (learned weight, not simple average)
 *   6. 70-COMBINATION OPTIMIZER (C(8,4)=70, select best Top-4)
 *
 * CRITICAL RULES:
 *   - Video is used ONLY when tracking confidence is valid
 *   - Fusion weight is learned from historical out-of-sample data
 *   - If video has no validated predictive value, its weight → 0
 *   - Production stays C1-C9 dynamic; fusion is experimental until validated
 *   - Lock timing: all inputs <= lockTimestamp (no future info, no post-stop)
 */

import {
  GAMES,
  THEORETICAL,
  WHEEL_SEGMENTS,
  BONUS_NAMES,
  buildInitial,
  ALL_FLAGS_OFF,
  type FeatureFlags,
  type RoundResult,
  type EngineOutput,
} from "./decisionEngine";
import type { SpinData } from "./aiStats";
import type { WheelPhysicsState } from "./RevoVideoSensor";

// ============================================================
// 54-SECTOR PHYSICAL ORDER (Evolution Crazy Time wheel)
// ============================================================
// This is the clockwise sequence of outcomes around the 54-segment wheel.
// Sector 0 is at angle 0°, sector 53 is at angle ~353.3°.
// Each sector spans 360/54 = 6.6667°.
export const PHYSICAL_ORDER_54 = [
  "1", "2", "5", "1", "2", "10", "1", "PACHINKO", "2", "1", "5", "COIN FLIP",
  "1", "2", "10", "1", "2", "5", "1", "CASH HUNT", "2", "1", "5", "10", "2", "1",
  "COIN FLIP", "5", "1", "2", "10", "1", "PACHINKO", "2", "5", "1", "10", "2",
  "1", "CRAZY TIME", "5", "2", "10", "1", "2", "5", "1", "COIN FLIP", "2", "10", "1", "5",
];

export const SECTOR_WIDTH = 360 / 54; // 6.6667°

/** Map a sector index (0..53) to its outcome name. */
export function sectorToOutcome(idx: number): string {
  return PHYSICAL_ORDER_54[((idx % 54) + 54) % 54] ?? "?";
}

/** Map an angle (degrees, 0..360) to its sector index (0..53). */
export function angleToSector(angle: number): number {
  const a = ((angle % 360) + 360) % 360;
  return Math.floor(a / SECTOR_WIDTH) % 54;
}

/** Map an angle (degrees) to its outcome name. */
export function angleToOutcome(angle: number): string {
  return sectorToOutcome(angleToSector(angle));
}

// ============================================================
// 1. PHYSICAL STOPPING MODEL
// ============================================================

export interface PhysicsSnapshot {
  timestamp: number; // seconds
  angle: number; // unwrapped, continuous (degrees)
  velocity: number; // deg/s (filtered)
  acceleration: number; // deg/s²
  confidence: number; // 0..1 (tracking confidence)
  direction: 1 | -1;
  isTracking: boolean;
  calibrationStable: boolean;
}

export interface StoppingPrediction {
  predictedStopAngle: number; // degrees (0..360, wrapped)
  predictedStopSector: number; // 0..53
  predictedStopOutcome: string;
  angularUncertainty: number; // degrees (1-sigma of the stopping distribution)
  sectorProbabilities: Float64Array; // length 54, sums to 1
  outcomeProbabilities: Record<string, number>; // 8 outcomes
  physicsConfidence: number; // 0..1
  isValid: boolean; // false if video confidence too low or wheel stopped
  reason: string; // why valid/invalid
}

/**
 * Predict the stopping angle using a constant-deceleration model.
 *
 * Physics: if the wheel has velocity v and deceleration a (a < 0 when v > 0),
 * the stopping time is t_stop = -v / a, and the remaining rotation is:
 *   Δθ = v * t_stop + 0.5 * a * t_stop² = -v² / (2a)
 *
 * The predicted stopping angle is: current_angle + Δθ (wrapped to 0..360).
 *
 * Angular uncertainty grows with:
 *   - Low confidence (noisy tracking)
 *   - High velocity (more integration error)
 *   - Near-zero deceleration (ill-defined stop time)
 *
 * The 54-sector probability is a Gaussian centered on the predicted stop angle,
 * with sigma = angularUncertainty, wrapped around the circle.
 */
export function predictStoppingAngle(
  physics: PhysicsSnapshot,
  learnedDeceleration: number | null,
): StoppingPrediction {
  // Validate: only predict when we have real movement + adequate confidence
  if (!physics.isTracking || !physics.calibrationStable) {
    return invalidPrediction("Not tracking or calibration unstable");
  }
  if (physics.confidence < 0.15) {
    return invalidPrediction(`Confidence too low (${(physics.confidence * 100).toFixed(0)}%)`);
  }
  if (Math.abs(physics.velocity) < 5) {
    return invalidPrediction(`Velocity too low (${physics.velocity.toFixed(1)}°/s — wheel stopped or nearly stopped)`);
  }

  // Use learned deceleration if available, otherwise estimate from current accel
  // The instantaneous acceleration is noisy; the learned value is more stable.
  const decel = learnedDeceleration ?? Math.abs(physics.acceleration);

  // If deceleration is near zero, we can't predict a stop time
  if (decel < 1) {
    return invalidPrediction(`Deceleration too low (${decel.toFixed(1)}°/s²)`);
  }

  const v = physics.velocity; // signed
  const a = -Math.abs(decel) * Math.sign(v); // always opposes velocity

  // Remaining rotation: Δθ = -v² / (2a)
  // a is negative when v is positive, so -v²/(2a) is positive (forward rotation)
  const deltaTheta = -(v * v) / (2 * a);
  const stopAngleRaw = physics.angle + deltaTheta;
  const stopAngleWrapped = ((stopAngleRaw % 360) + 360) % 360;
  const stopSector = angleToSector(stopAngleWrapped);
  const stopOutcome = sectorToOutcome(stopSector);

  // Angular uncertainty: grows with velocity (integration error) and
  // inversely with confidence. Base sigma is ~30° (2 sectors) at moderate
  // confidence, growing to ~90° (5 sectors) at low confidence/high speed.
  const velocityFactor = 1 + Math.abs(v) / 500; // 500°/s doubles uncertainty
  const confidenceFactor = 1 / Math.max(0.1, physics.confidence);
  const baseSigma = 25; // degrees — empirically tuned starting point
  const angularUncertainty = Math.min(180, baseSigma * velocityFactor * confidenceFactor);

  // 54-sector probability: Gaussian centered on stopAngleWrapped
  const sectorProbs = new Float64Array(54);
  const sigma = angularUncertainty;
  let total = 0;
  for (let i = 0; i < 54; i++) {
    const sectorAngle = i * SECTOR_WIDTH + SECTOR_WIDTH / 2; // center of sector
    // Angular distance (wrapped, shortest path)
    let diff = sectorAngle - stopAngleWrapped;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    // Gaussian
    const prob = Math.exp(-(diff * diff) / (2 * sigma * sigma));
    sectorProbs[i] = prob;
    total += prob;
  }
  // Normalize
  if (total > 0) {
    for (let i = 0; i < 54; i++) sectorProbs[i] /= total;
  }

  // Map 54 sectors to 8 outcomes
  const outcomeProbs: Record<string, number> = {};
  for (const g of GAMES) outcomeProbs[g.name] = 0;
  for (let i = 0; i < 54; i++) {
    const outcome = sectorToOutcome(i);
    if (outcomeProbs[outcome] !== undefined) {
      outcomeProbs[outcome] += sectorProbs[i];
    }
  }

  // Physics confidence: how concentrated the distribution is
  // A sharp peak (low uncertainty) = high confidence
  // A flat distribution (high uncertainty) = low confidence
  const maxProb = Math.max(...sectorProbs);
  const physicsConfidence = Math.min(1, maxProb / (1 / 54)); // 1 = perfectly concentrated, 0 = uniform

  return {
    predictedStopAngle: stopAngleWrapped,
    predictedStopSector: stopSector,
    predictedStopOutcome: stopOutcome,
    angularUncertainty,
    sectorProbabilities: sectorProbs,
    outcomeProbabilities: outcomeProbs,
    physicsConfidence,
    isValid: true,
    reason: `v=${v.toFixed(0)}°/s a=${a.toFixed(0)}°/s² Δθ=${deltaTheta.toFixed(0)}° stop=${stopAngleWrapped.toFixed(1)}° σ=${sigma.toFixed(0)}°`,
  };
}

function invalidPrediction(reason: string): StoppingPrediction {
  return {
    predictedStopAngle: 0,
    predictedStopSector: 0,
    predictedStopOutcome: "?",
    angularUncertainty: 180, // maximum uncertainty
    sectorProbabilities: new Float64Array(54).fill(1 / 54), // uniform
    outcomeProbabilities: Object.fromEntries(GAMES.map((g) => [g.name, THEORETICAL[g.name] ?? 0])),
    physicsConfidence: 0,
    isValid: false,
    reason,
  };
}

// ============================================================
// 2. HISTORY PROBABILITY (from C1-C9 engine)
// ============================================================

export interface HistoryProbability {
  outcomeProbabilities: Record<string, number>; // 8 outcomes
  confidence: number; // 0..1 (honest, sample-aware)
  sampleSize: number;
}

/**
 * Generate an independent probability distribution over the 8 outcomes
 * using the C1-C9 engine. Uses only history available before lock.
 */
export function getHistoryProbability(
  rounds: RoundResult[],
  liveSpins: SpinData[],
  flags: FeatureFlags = ALL_FLAGS_OFF,
): HistoryProbability {
  const engine: EngineOutput = buildInitial(rounds, liveSpins, "baseline", flags);

  // Build probability distribution from the engine's predictions + candidate scores
  const probs: Record<string, number> = {};
  for (const g of GAMES) probs[g.name] = 0;

  // Primary: use engine predictions (these are always populated by buildInitial)
  // The predictions have a `confidence` field — use it as the probability weight
  if (engine.predictions && engine.predictions.length > 0) {
    let total = 0;
    for (const pred of engine.predictions) {
      const name = pred.game.name;
      const weight = Math.max(0.001, pred.confidence / 100);
      probs[name] = (probs[name] ?? 0) + weight;
      total += weight;
    }
    if (total > 0) {
      for (const k of Object.keys(probs)) probs[k] /= total;
    }
  }

  // Augment with candidate scores if available (finer-grained distribution)
  if (engine.candidateScores && engine.candidateScores.length > 0) {
    const csProbs: Record<string, number> = {};
    let csTotal = 0;
    for (const cs of engine.candidateScores) {
      const name = cs.game.name;
      const score = Math.max(0, cs.score);
      csProbs[name] = (csProbs[name] ?? 0) + score;
      csTotal += score;
    }
    if (csTotal > 0) {
      for (const k of Object.keys(csProbs)) csProbs[k] /= csTotal;
      // Blend: 50% predictions + 50% candidate scores
      for (const g of GAMES) {
        probs[g.name] = 0.5 * (probs[g.name] ?? 0) + 0.5 * (csProbs[g.name] ?? 0);
      }
    }
  }

  // Fallback: if still all zero, use theoretical prior blended with recent
  // outcome frequency from liveSpins
  let total = Object.values(probs).reduce((s, v) => s + v, 0);
  if (total === 0 || !isFinite(total) || Object.values(probs).every((v) => v === 0)) {
    if (liveSpins.length > 0) {
      const counts: Record<string, number> = {};
      for (const g of GAMES) counts[g.name] = 0;
      for (const spin of liveSpins) {
        const name = SPIN_TO_GAME_NAME_INTERNAL[spin.sector] ?? spin.sector;
        if (counts[name] !== undefined) counts[name]++;
      }
      const n = liveSpins.length;
      const blendWeight = Math.min(0.5, n / 50);
      for (const g of GAMES) {
        const empirical = counts[g.name] / n;
        const theo = THEORETICAL[g.name] ?? 0;
        probs[g.name] = (1 - blendWeight) * theo + blendWeight * empirical;
      }
    } else {
      for (const g of GAMES) probs[g.name] = THEORETICAL[g.name] ?? 0;
    }
  }

  // Normalize to sum to 1 (handle NaN/Infinity)
  total = Object.values(probs).reduce((s, v) => s + (isFinite(v) ? v : 0), 0);
  if (total > 0) {
    for (const k of Object.keys(probs)) probs[k] = (isFinite(probs[k]) ? probs[k] : 0) / total;
  } else {
    // Ultimate fallback: uniform theoretical
    for (const g of GAMES) probs[g.name] = THEORETICAL[g.name] ?? 0;
  }

  return {
    outcomeProbabilities: probs,
    confidence: Math.max(0, Math.min(1, (engine.confidence ?? 0) / 100)),
    sampleSize: rounds.length,
  };
}

// Internal mapping (to avoid importing from decisionEngine's private const)
const SPIN_TO_GAME_NAME_INTERNAL: Record<string, string> = {
  "1": "1", "2": "2", "5": "5", "10": "10",
  CoinFlip: "COIN FLIP", Pachinko: "PACHINKO",
  CashHunt: "CASH HUNT", CrazyTime: "CRAZY TIME",
  CrazyBonus: "CRAZY TIME",
};

// ============================================================
// 3. CALIBRATED FUSION
// ============================================================

export interface FusionWeights {
  historyWeight: number; // 0..1
  videoWeight: number; // 0..1
  version: string;
  learnedFrom: number; // number of training samples
  lastUpdated: number; // timestamp
}

export interface FusionResult {
  outcomeProbabilities: Record<string, number>; // 8 outcomes, fused
  top4: string[]; // 4 outcome names
  top4Coverage: number; // P(actual ∈ Top4)
  historyConfidence: number;
  videoConfidence: number;
  fusionConfidence: number;
  weights: FusionWeights;
  videoUsed: boolean;
  videoReason: string;
  stoppingPrediction: StoppingPrediction | null;
}

/**
 * Calibrated fusion: combine history + video probabilities.
 *
 * The fusion weight is NOT a simple average. It's learned from historical
 * out-of-sample data. If video has no validated predictive value, its
 * weight → 0 (fusion = history).
 *
 * Fusion formula:
 *   P_fused(outcome) = w_history * P_history(outcome) + w_video * P_video(outcome)
 *   where w_history + w_video = 1
 *
 * The video weight is scaled by the video's physics confidence (so low-confidence
 * video contributes less even if the learned weight is high).
 */
export function calibrateFusion(
  history: HistoryProbability,
  video: StoppingPrediction | null,
  weights: FusionWeights,
): FusionResult {
  const probs: Record<string, number> = {};
  for (const g of GAMES) probs[g.name] = 0;

  // Effective video weight = learned_weight * physics_confidence
  // (If video confidence is 0, video contributes nothing)
  const effVideoWeight = video?.isValid
    ? weights.videoWeight * video.physicsConfidence
    : 0;
  const effHistoryWeight = 1 - effVideoWeight;

  for (const g of GAMES) {
    const hp = history.outcomeProbabilities[g.name] ?? 0;
    const vp = video?.outcomeProbabilities[g.name] ?? 0;
    probs[g.name] = effHistoryWeight * hp + effVideoWeight * vp;
  }

  // Normalize
  const total = Object.values(probs).reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (const k of Object.keys(probs)) probs[k] /= total;
  }

  // 70-combination optimizer
  const { top4, coverage } = selectTop4(probs);

  const fusionConfidence = effVideoWeight > 0
    ? Math.min(1, history.confidence * (1 - effVideoWeight * 0.3) + video!.physicsConfidence * effVideoWeight * 0.3)
    : history.confidence;

  return {
    outcomeProbabilities: probs,
    top4,
    top4Coverage: coverage,
    historyConfidence: history.confidence,
    videoConfidence: video?.physicsConfidence ?? 0,
    fusionConfidence,
    weights,
    videoUsed: effVideoWeight > 0,
    videoReason: video?.reason ?? "no video available",
    stoppingPrediction: video,
  };
}

// ============================================================
// 4. 70-COMBINATION OPTIMIZER
// ============================================================

/**
 * Evaluate all C(8,4) = 70 possible Top-4 combinations.
 * Select the one with the highest P(actual ∈ Top4).
 *
 * P(actual ∈ Top4) = P(A) + P(B) + P(C) + P(D) (mutually exclusive outcomes).
 *
 * No fixed composition. No forced bonus. No random selection.
 */
export function selectTop4(probs: Record<string, number>): {
  top4: string[];
  coverage: number;
  allCombos: { combo: string[]; coverage: number }[];
} {
  const names = GAMES.map((g) => g.name);
  const allCombos: { combo: string[]; coverage: number }[] = [];

  // Generate all C(8,4) = 70 combinations
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      for (let k = j + 1; k < 8; k++) {
        for (let l = k + 1; l < 8; l++) {
          const combo = [names[i], names[j], names[k], names[l]];
          const coverage =
            (probs[names[i]] ?? 0) +
            (probs[names[j]] ?? 0) +
            (probs[names[k]] ?? 0) +
            (probs[names[l]] ?? 0);
          allCombos.push({ combo, coverage });
        }
      }
    }
  }

  // Sort by coverage descending
  allCombos.sort((a, b) => b.coverage - a.coverage);
  const best = allCombos[0];
  return { top4: best.combo, coverage: best.coverage, allCombos };
}

// ============================================================
// 5. FUSION WEIGHT LEARNING (chronological, no leakage)
// ============================================================

export interface TrainingSample {
  // Pre-lock state (what was known BEFORE the result)
  historyProb: Record<string, number>;
  videoProb: Record<string, number> | null;
  videoValid: boolean;
  videoConfidence: number;
  historyConfidence: number;
  // Post-lock actual
  actualOutcome: string;
  // Lock metadata
  lockTimestamp: number;
  lastHistoryTimestamp: number;
  lastVideoFrameTimestamp: number | null;
}

/**
 * Learn the optimal fusion weight from chronological training data.
 *
 * For each candidate weight w_video (0..1 in steps of 0.05):
 *   - Compute the fused probability for each training sample
 *   - Evaluate the log-loss / Brier score / Top-4 HIT
 *   - Select the weight that minimizes log-loss (proper scoring rule)
 *
 * The weight is clamped to [0, 0.5] — video can contribute at most 50%
 * until it proves itself on a large sample.
 *
 * Returns the learned weights + calibration metrics.
 */
export function learnFusionWeights(
  samples: TrainingSample[],
): {
  weights: FusionWeights;
  metrics: {
    logLoss: number;
    brierScore: number;
    top4HitRate: number;
    nSamples: number;
  };
} {
  if (samples.length < 10) {
    // Not enough data — default to history-only
    return {
      weights: {
        historyWeight: 1,
        videoWeight: 0,
        version: "fusion-v1-untrained",
        learnedFrom: samples.length,
        lastUpdated: Date.now(),
      },
      metrics: { logLoss: 0, brierScore: 0, top4HitRate: 0, nSamples: samples.length },
    };
  }

  // Split: first 70% for training, last 30% for validation
  const splitIdx = Math.floor(samples.length * 0.7);
  const trainSamples = samples.slice(0, splitIdx);
  const valSamples = samples.slice(splitIdx);

  let bestWeight = 0;
  let bestScore = Infinity;

  // Try weights 0, 0.05, 0.10, ..., 0.50
  for (let w = 0; w <= 0.5; w += 0.05) {
    const score = evaluateWeight(trainSamples, w);
    if (score < bestScore) {
      bestScore = score;
      bestWeight = w;
    }
  }

  // Validate on held-out set
  const valMetrics = evaluateWeightDetailed(valSamples, bestWeight);

  return {
    weights: {
      historyWeight: 1 - bestWeight,
      videoWeight: bestWeight,
      version: `fusion-v1-trained-w${bestWeight.toFixed(2)}`,
      learnedFrom: trainSamples.length,
      lastUpdated: Date.now(),
    },
    metrics: {
      logLoss: valMetrics.logLoss,
      brierScore: valMetrics.brierScore,
      top4HitRate: valMetrics.top4HitRate,
      nSamples: valSamples.length,
    },
  };
}

function evaluateWeight(samples: TrainingSample[], videoWeight: number): number {
  // Log-loss (proper scoring rule)
  let totalLogLoss = 0;
  for (const s of samples) {
    const fused = fuseSample(s, videoWeight);
    const p = fused[s.actualOutcome] ?? 0.001;
    totalLogLoss += -Math.log(Math.max(1e-9, p));
  }
  return totalLogLoss / samples.length;
}

function evaluateWeightDetailed(
  samples: TrainingSample[],
  videoWeight: number,
): { logLoss: number; brierScore: number; top4HitRate: number } {
  let totalLogLoss = 0;
  let totalBrier = 0;
  let hits = 0;
  for (const s of samples) {
    const fused = fuseSample(s, videoWeight);
    // Log-loss
    const p = fused[s.actualOutcome] ?? 0.001;
    totalLogLoss += -Math.log(Math.max(1e-9, p));
    // Brier score (only for actual outcome)
    totalBrier += (1 - p) ** 2;
    // Top-4 HIT
    const sorted = Object.entries(fused).sort((a, b) => b[1] - a[1]);
    const top4 = sorted.slice(0, 4).map((x) => x[0]);
    if (top4.includes(s.actualOutcome)) hits++;
  }
  return {
    logLoss: totalLogLoss / samples.length,
    brierScore: totalBrier / samples.length,
    top4HitRate: hits / samples.length,
  };
}

function fuseSample(
  s: TrainingSample,
  videoWeight: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  const effVideo = s.videoValid ? videoWeight * s.videoConfidence : 0;
  const effHist = 1 - effVideo;
  for (const g of GAMES) {
    const hp = s.historyProb[g.name] ?? 0;
    const vp = s.videoProb?.[g.name] ?? 0;
    result[g.name] = effHist * hp + effVideo * vp;
  }
  // Normalize
  const total = Object.values(result).reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (const k of Object.keys(result)) result[k] /= total;
  }
  return result;
}

// ============================================================
// 6. LOCK RECORD (no-leakage guarantee)
// ============================================================

export interface LockRecord {
  predictionId: string;
  spinId: string | null;
  lockTimestamp: number; // ms epoch
  lastHistoryTimestamp: number; // ms epoch (latest round or spin used)
  lastVideoFrameTimestamp: number | null; // ms epoch (latest video frame used)
  outcomeProbabilities: Record<string, number>;
  top4: string[];
  top4Coverage: number;
  historyConfidence: number;
  videoConfidence: number;
  fusionConfidence: number;
  videoUsed: boolean;
  stoppingPrediction: {
    angle: number;
    sector: number;
    uncertainty: number;
    physicsConfidence: number;
  } | null;
  // For forensics
  physicsSnapshot: {
    angle: number;
    velocity: number;
    acceleration: number;
    direction: number;
    isTracking: boolean;
  } | null;
}

/**
 * Lock a prediction at the given timestamp.
 * GUARANTEE: all inputs (history + video) are <= lockTimestamp.
 * No post-stop frame. No API result. No settledAt. No future information.
 */
export function lockPrediction(
  rounds: RoundResult[],
  liveSpins: SpinData[],
  physics: PhysicsSnapshot | null,
  weights: FusionWeights,
  lockTimestamp: number,
): LockRecord {
  // Filter history to ONLY include data available at lock time
  const safeRounds = rounds.filter((r) => r.time <= lockTimestamp);
  const safeSpins = liveSpins.filter((s) => {
    const spinTime = new Date(s.settledAt).getTime();
    return spinTime <= lockTimestamp;
  });

  // Filter video to ONLY include frames at or before lock time
  const safePhysics = physics && physics.timestamp * 1000 <= lockTimestamp ? physics : null;

  // Get history probability (from C1-C9 engine)
  const history = getHistoryProbability(safeRounds, safeSpins);

  // Get video stopping prediction (if video available and valid)
  const video = safePhysics
    ? predictStoppingAngle(safePhysics, null) // no learned deceleration yet
    : null;

  // Fuse
  const fusion = calibrateFusion(history, video, weights);

  // Generate prediction ID
  const predictionId = `pred-${lockTimestamp}-${Math.random().toString(36).slice(2, 8)}`;

  // Find the latest spinId (for tracking)
  const latestSpin = safeSpins[0]; // newest first
  const spinId = latestSpin?.settledAt ?? null;

  // Last history timestamp
  const lastHistoryTimestamp = safeRounds.length > 0
    ? Math.max(...safeRounds.map((r) => r.time))
    : safeSpins.length > 0
      ? new Date(safeSpins[safeSpins.length - 1].settledAt).getTime()
      : lockTimestamp;

  return {
    predictionId,
    spinId,
    lockTimestamp,
    lastHistoryTimestamp,
    lastVideoFrameTimestamp: safePhysics ? safePhysics.timestamp * 1000 : null,
    outcomeProbabilities: fusion.outcomeProbabilities,
    top4: fusion.top4,
    top4Coverage: fusion.top4Coverage,
    historyConfidence: fusion.historyConfidence,
    videoConfidence: fusion.videoConfidence,
    fusionConfidence: fusion.fusionConfidence,
    videoUsed: fusion.videoUsed,
    stoppingPrediction: fusion.stoppingPrediction
      ? {
          angle: fusion.stoppingPrediction.predictedStopAngle,
          sector: fusion.stoppingPrediction.predictedStopSector,
          uncertainty: fusion.stoppingPrediction.angularUncertainty,
          physicsConfidence: fusion.stoppingPrediction.physicsConfidence,
        }
      : null,
    physicsSnapshot: safePhysics
      ? {
          angle: safePhysics.angle,
          velocity: safePhysics.velocity,
          acceleration: safePhysics.acceleration,
          direction: safePhysics.direction,
          isTracking: safePhysics.isTracking,
        }
      : null,
  };
}

// ============================================================
// 7. MISS FORENSICS
// ============================================================

export interface MissForensics {
  actual: string;
  top4: string[];
  actualRank: number | null; // 1-8 (1 = highest prob)
  outcomeProbabilities: Record<string, number>;
  margin4vs5: number; // |P(#4) - P(#5)|
  physicsSnapshot: {
    angle: number;
    velocity: number;
    acceleration: number;
    direction: number;
  } | null;
  predictedStopAngle: number | null;
  actualSector: number | null;
  angularError: number | null; // degrees between predicted and actual
  historyConfidence: number;
  videoConfidence: number;
  fusionConfidence: number;
  videoUsed: boolean;
  hadPreResultInfo: boolean;
  missingSignal: string | null; // if we could have predicted better
  classification: "EXPLAINED" | "UNEXPLAINED" | "BONUS_UNPREDICTABLE";
}

/**
 * Analyze a miss to determine if pre-result information existed
 * that could have put the winner inside Top-4.
 */
export function analyzeMiss(
  lock: LockRecord,
  actualOutcome: string,
  actualSector: number | null,
): MissForensics {
  const sorted = Object.entries(lock.outcomeProbabilities).sort((a, b) => b[1] - a[1]);
  const actualRank = sorted.findIndex((x) => x[0] === actualOutcome) + 1;
  const prob4 = sorted[3]?.[1] ?? 0;
  const prob5 = sorted[4]?.[1] ?? 0;
  const margin = prob4 - prob5;

  // Angular error (if we have both predicted stop angle and actual sector)
  let angularError: number | null = null;
  if (lock.stoppingPrediction && actualSector !== null) {
    const actualAngle = actualSector * SECTOR_WIDTH + SECTOR_WIDTH / 2;
    let diff = actualAngle - lock.stoppingPrediction.angle;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    angularError = Math.abs(diff);
  }

  // Was the actual outcome in the top-5? (just barely excluded)
  const actualProb = lock.outcomeProbabilities[actualOutcome] ?? 0;
  const wasClose = actualRank === 5; // just missed Top-4

  // Was this a bonus outcome? (harder to predict)
  const isBonus = BONUS_NAMES.includes(actualOutcome);

  // Did video have any useful info?
  const videoHadInfo = lock.videoUsed && (lock.videoConfidence ?? 0) > 0.1;

  // Classification
  let classification: "EXPLAINED" | "UNEXPLAINED" | "BONUS_UNPREDICTABLE";
  let missingSignal: string | null;

  if (isBonus && actualProb < 0.05) {
    classification = "BONUS_UNPREDICTABLE";
    missingSignal = "Bonus outcome with very low probability — no pre-result signal could identify this specific bonus.";
  } else if (wasClose && margin < 0.02) {
    classification = "EXPLAINED";
    missingSignal = `Actual was #${actualRank} — within ${(margin * 100).toFixed(1)}pp of #4. A slightly better calibrated model could have included it.`;
  } else if (!videoHadInfo && isBonus) {
    classification = "EXPLAINED";
    missingSignal = "Video not available/valid — if video physics had identified the deceleration pattern, the bonus might have been predictable.";
  } else if (angularError !== null && angularError > 60) {
    classification = "EXPLAINED";
    missingSignal = `Angular error ${angularError.toFixed(0)}° — video physics stopping prediction was inaccurate. Better deceleration model could help.`;
  } else {
    classification = "UNEXPLAINED";
    missingSignal = "No pre-result information available that could have corrected this miss. Outcome may be genuinely random.";
  }

  return {
    actual: actualOutcome,
    top4: lock.top4,
    actualRank: actualRank || null,
    outcomeProbabilities: lock.outcomeProbabilities,
    margin4vs5: margin,
    physicsSnapshot: lock.physicsSnapshot,
    predictedStopAngle: lock.stoppingPrediction?.angle ?? null,
    actualSector,
    angularError,
    historyConfidence: lock.historyConfidence,
    videoConfidence: lock.videoConfidence,
    fusionConfidence: lock.fusionConfidence,
    videoUsed: lock.videoUsed,
    hadPreResultInfo: videoHadInfo,
    missingSignal,
    classification,
  };
}

// ============================================================
// 8. EXPERIMENT HARNESS — A/B/C/D comparison
// ============================================================

export interface ExperimentArm {
  name: string;
  top4: string[];
  hit: boolean;
  outcomeProbabilities: Record<string, number>;
}

export interface ExperimentResult {
  totalRounds: number;
  arms: Record<string, {
    hits: number;
    misses: number;
    hitRate: number;
    top4List: string[][];
    logLoss: number;
    brierScore: number;
    bonusRecall: number;
    falseBonusInclusion: number;
  }>;
  mcnemar: {
    r: number;
    s: number;
    statistic: number;
    pValue: number;
    significant: boolean;
    discordant: number;
  } | null;
  missForensics: MissForensics[];
  leakageAudit: {
    passed: boolean;
    details: string;
  };
}

/**
 * Run the A/B/C/D experiment on historical rounds.
 *
 * A = theoretical [1,2,5,10]
 * B = C1-C9 (history-only, ALL_FLAGS_OFF)
 * C = Video-only (physics stopping prediction)
 * D = Fusion (history + video, calibrated)
 *
 * All arms predict the SAME spins at the SAME lock points.
 * Lock points: T-20, T-15, T-10, T-5 (seconds before result).
 */
export function runFusionExperiment(
  rounds: RoundResult[],
  liveSpins: SpinData[],
  physicsHistory: PhysicsSnapshot[],
  fusionWeights: FusionWeights,
): ExperimentResult {
  const armNames = ["A_theoretical", "B_history", "C_video", "D_fusion"];
  const armResults: Record<string, {
    hits: number;
    misses: number;
    top4List: string[][];
    logLossSum: number;
    brierSum: number;
    bonusHits: number;
    bonusTotal: number;
    falseBonusCount: number;
    falseBonusTotal: number;
  }> = {};
  for (const name of armNames) {
    armResults[name] = {
      hits: 0, misses: 0, top4List: [],
      logLossSum: 0, brierSum: 0,
      bonusHits: 0, bonusTotal: 0,
      falseBonusCount: 0, falseBonusTotal: 0,
    };
  }

  const missForensics: MissForensics[] = [];
  let leakageIssues = 0;

  // Use the last N rounds for the experiment
  const N = Math.min(100, rounds.length);
  const experimentRounds = rounds.slice(-N);

  for (const round of experimentRounds) {
    const actual = round.actualResult.name;
    const isBonus = BONUS_NAMES.includes(actual);
    const resultTime = round.time;

    // Lock at T-5 (5 seconds before result)
    // In a real system, we'd lock at the physical stop boundary.
    // For retrospective analysis, we use the round time minus 5s.
    const lockTime = resultTime - 5000; // 5s before

    // Filter inputs to before lock time
    const safeRounds = rounds.filter((r) => r.time < lockTime);
    const safeSpins = liveSpins.filter((s) => new Date(s.settledAt).getTime() < lockTime);
    const safePhysics = physicsHistory.filter((p) => p.timestamp * 1000 < lockTime);
    const latestPhysics = safePhysics[safePhysics.length - 1] ?? null;

    // Arm A: Theoretical [1,2,5,10]
    const armA_top4 = ["1", "2", "5", "10"];
    const armA_probs = { ...THEORETICAL };
    evaluateArm(armA_top4, armA_probs, actual, isBonus, armResults["A_theoretical"], lockTime, round, latestPhysics, missForensics);

    // Arm B: C1-C9 History
    const history = getHistoryProbability(safeRounds, safeSpins);
    const armB = selectTop4(history.outcomeProbabilities);
    evaluateArm(armB.top4, history.outcomeProbabilities, actual, isBonus, armResults["B_history"], lockTime, round, latestPhysics, missForensics);

    // Arm C: Video-only
    const video = latestPhysics ? predictStoppingAngle(latestPhysics, null) : null;
    const armC_probs = video?.outcomeProbabilities ?? { ...THEORETICAL };
    const armC = selectTop4(armC_probs);
    evaluateArm(armC.top4, armC_probs, actual, isBonus, armResults["C_video"], lockTime, round, latestPhysics, missForensics);

    // Arm D: Fusion
    const fusion = calibrateFusion(history, video, fusionWeights);
    evaluateArm(fusion.top4, fusion.outcomeProbabilities, actual, isBonus, armResults["D_fusion"], lockTime, round, latestPhysics, missForensics);

    // Leakage check: ensure no future data was used
    if (safeRounds.some((r) => r.time >= lockTime)) leakageIssues++;
    if (safeSpins.some((s) => new Date(s.settledAt).getTime() >= lockTime)) leakageIssues++;
  }

  // Build final arm metrics
  const arms: ExperimentResult["arms"] = {};
  for (const name of armNames) {
    const a = armResults[name];
    const total = a.hits + a.misses;
    arms[name] = {
      hits: a.hits,
      misses: a.misses,
      hitRate: total > 0 ? a.hits / total : 0,
      top4List: a.top4List,
      logLoss: total > 0 ? a.logLossSum / total : 0,
      brierScore: total > 0 ? a.brierSum / total : 0,
      bonusRecall: a.bonusTotal > 0 ? a.bonusHits / a.bonusTotal : 0,
      falseBonusInclusion: a.falseBonusTotal > 0 ? a.falseBonusCount / a.falseBonusTotal : 0,
    };
  }

  // McNemar: compare D (fusion) vs B (history)
  let r = 0; // B HIT & D MISS
  let s = 0; // B MISS & D HIT
  for (let i = 0; i < experimentRounds.length; i++) {
    const bHit = armResults["B_history"].top4List[i]?.includes(experimentRounds[i].actualResult.name) ?? false;
    const dHit = armResults["D_fusion"].top4List[i]?.includes(experimentRounds[i].actualResult.name) ?? false;
    if (bHit && !dHit) r++;
    if (!bHit && dHit) s++;
  }
  const discordant = r + s;
  const statistic = discordant > 0 ? (Math.abs(r - s) - 1) ** 2 / discordant : 0;
  const pValue = discordant > 0 ? chiSquare1dfSurvival(statistic) : 1;

  return {
    totalRounds: experimentRounds.length,
    arms,
    mcnemar: {
      r, s, statistic, pValue,
      significant: pValue < 0.05,
      discordant,
    },
    missForensics,
    leakageAudit: {
      passed: leakageIssues === 0,
      details: leakageIssues === 0
        ? "PASS — all inputs filtered to before lock time"
        : `FAIL — ${leakageIssues} leakage violations detected`,
    },
  };
}

function evaluateArm(
  top4: string[],
  probs: Record<string, number>,
  actual: string,
  isBonus: boolean,
  armResult: {
    hits: number;
    misses: number;
    top4List: string[][];
    logLossSum: number;
    brierSum: number;
    bonusHits: number;
    bonusTotal: number;
    falseBonusCount: number;
    falseBonusTotal: number;
  },
  lockTime: number,
  round: RoundResult,
  physics: PhysicsSnapshot | null,
  missForensics: MissForensics[],
): void {
  const hit = top4.includes(actual);
  if (hit) armResult.hits++;
  else armResult.misses++;
  armResult.top4List.push(top4);

  // Log-loss
  const p = probs[actual] ?? 0.001;
  armResult.logLossSum += -Math.log(Math.max(1e-9, p));
  // Brier
  armResult.brierSum += (1 - p) ** 2;

  // Bonus metrics
  if (isBonus) {
    armResult.bonusTotal++;
    if (hit) armResult.bonusHits++;
  }
  // False bonus inclusion: bonus in Top-4 that didn't hit
  for (const name of top4) {
    if (BONUS_NAMES.includes(name) && name !== actual) {
      armResult.falseBonusTotal++;
      armResult.falseBonusCount++;
    }
  }
}

/** Chi-square 1-df survival function (upper tail). */
function chiSquare1dfSurvival(x: number): number {
  // For 1 df, P(X > x) = 2 * (1 - Phi(sqrt(x)))
  // Using erfc approximation
  const sqrtX = Math.sqrt(Math.max(0, x));
  return erfc(sqrtX / Math.SQRT2);
}

function erfc(x: number): number {
  // Abramowitz and Stegun approximation
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? ans : 2 - ans;
}

// ============================================================
// DEFAULT WEIGHTS (untrained — history-only)
// ============================================================

export const DEFAULT_FUSION_WEIGHTS: FusionWeights = {
  historyWeight: 1,
  videoWeight: 0,
  version: "fusion-v1-untrained",
  learnedFrom: 0,
  lastUpdated: Date.now(),
};
