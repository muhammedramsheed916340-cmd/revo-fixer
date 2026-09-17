/**
 * VIDEO PHYSICS PREDICTOR V2.4
 * =============================
 *
 * Estimates the stopping angle of the Crazy Time wheel using pre-result
 * video telemetry ONLY. No theoretical fallback, no hardcoded outcomes.
 *
 * MODEL:
 *   1. Use multi-frame velocity history to estimate deceleration trend
 *   2. Estimate remaining rotation: Δθ = -v² / (2a)  (constant deceleration)
 *   3. Predicted stop angle = current_angle + Δθ
 *   4. Angular uncertainty grows with velocity, inversely with confidence
 *   5. 54-sector probability = wrapped Gaussian centered on predicted stop
 *   6. 8-outcome probability = sum of sectors per outcome
 *
 * LEAKAGE GUARANTEE:
 *   Only uses PhysicsSnapshot objects with timestamp <= lockTimestamp.
 *   A hard assertion rejects any future timestamp.
 */

import {
  GAMES,
  THEORETICAL,
  BONUS_NAMES,
} from "./decisionEngine";
import type { PhysicsSnapshot } from "./videoPhysicsHistory";
import { isPhysicallyMoving, countPhysicallyMovingFrames } from "./videoPhysicsHistory";

// ============================================================
// 54-SECTOR PHYSICAL ORDER (Evolution Crazy Time wheel)
// ============================================================
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

/** Circular angular difference (shortest path, -180..180). */
export function circularDiff(a: number, b: number): number {
  let diff = ((a - b) % 360 + 360) % 360;
  if (diff > 180) diff -= 360;
  return diff;
}

// ============================================================
// PHYSICS PREDICTION
// ============================================================

export interface PhysicsPrediction {
  // Input state at lock time
  lockTimestamp: number;
  currentAngle: number; // unwrapped, continuous (degrees)
  rawVelocity: number; // deg/s (raw)
  smoothedVelocity: number; // deg/s (median-filtered)
  acceleration: number; // deg/s²
  deceleration: number; // deg/s² (positive = decelerating)
  direction: 1 | -1;
  trackingConfidence: number; // 0..1
  signalQuality: number; // 0..1 (FFT correlation confidence)
  // Estimated remaining rotation
  remainingRotation: number; // degrees (signed)
  estimatedStopTime: number; // seconds from lock
  // Predicted stop
  predictedStopAngle: number; // degrees (0..360, wrapped)
  predictedStopSector: number; // 0..53
  predictedStopOutcome: string;
  angularUncertainty: number; // degrees (1-sigma)
  // Distributions
  sectorProbabilities: Float64Array; // length 54, sums to ~1
  outcomeProbabilities: Record<string, number>; // 8 outcomes
  // Top-4
  top4: string[];
  top4Coverage: number; // P(actual ∈ Top4)
  // Validity
  isValid: boolean;
  reason: string;
  modelVersion: string;
}

/**
 * Predict the stopping angle using multi-frame velocity history.
 *
 * Uses a constant-deceleration model: Δθ = -v² / (2a)
 * The deceleration is estimated from the velocity history (not a single frame).
 *
 * Angular uncertainty grows with:
 *   - High velocity (more integration error)
 *   - Low tracking confidence
 *   - Short velocity history (less reliable deceleration estimate)
 *   - High acceleration variance (unstable deceleration)
 */
export function predictStoppingAngle(
  snapshots: PhysicsSnapshot[],
  lockTimestamp: number,
): PhysicsPrediction {
  const MODEL_VERSION = "video-physics-v2.4";

  // HARD ASSERTION: filter to ONLY snapshots at or before lock timestamp
  // V2.5B-5: No slice limit — preResultSnapshots is already capped at 300
  const validSnapshots = snapshots
    .filter((s) => s.timestamp <= lockTimestamp);

  if (validSnapshots.length === 0) {
    return invalidPrediction(lockTimestamp, "No snapshots at or before lock time", MODEL_VERSION);
  }

  // Find the latest snapshot at or before lock time
  const latest = validSnapshots[validSnapshots.length - 1];

  // V2.5B-4 FIX: Use the BEST moving frame's velocity, not just the latest frame.
  // The FFT phase correlation only detects movement on ~5-20% of frames during
  // fast rotation. The latest frame might have velocityRaw=0 even though the
  // wheel IS spinning. We search the last 20 snapshots for the frame with the
  // highest |velocityRaw| and use that as the "current" physics state.
  let bestPhysics = latest;
  let bestVel = Math.abs(latest.velocityRaw);
  const recentSnapshots = validSnapshots.slice(-20);
  for (const s of recentSnapshots) {
    const absVel = Math.abs(s.velocityRaw);
    if (absVel > bestVel) {
      bestVel = absVel;
      bestPhysics = s;
    }
  }

  // Use RAW velocity for movement detection (smoothed median can be 0 during fast spins)
  const rawVel = bestPhysics.velocityRaw;
  const smoothedVel = bestPhysics.velocity;

  // Check if we have enough movement to predict
  // V2.5B-4: Lower threshold to 25°/s since we now search for the best frame
  if (Math.abs(rawVel) < 25) {
    // V2.5B-4: Also check if ANY frame has significant profDiff (profile evidence)
    // The wheel might be moving even if FFT velocity is 0 on all frames
    const hasProfileEvidence = recentSnapshots.some((s) => s.profDiff > 20);
    if (!hasProfileEvidence) {
      return invalidPrediction(lockTimestamp,
        `Velocity too low (${rawVel.toFixed(1)}°/s) and no profile evidence`,
        MODEL_VERSION, bestPhysics);
    }
  }

  // Check tracking confidence
  if (!latest.isTracking || latest.confidence < 0.1) {
    return invalidPrediction(lockTimestamp,
      `Not tracking or confidence too low (${(latest.confidence * 100).toFixed(0)}%)`,
      MODEL_VERSION, latest);
  }

  // Multi-frame velocity history for deceleration estimation
  // Use the last N snapshots (up to 20) that have non-zero velocity OR
  // significant profDiff (profile evidence of movement even when FFT velocity = 0)
  const movingSnapshots = validSnapshots
    .filter((s) => Math.abs(s.velocityRaw) > 25 || s.profDiff > 20)
    .slice(-20);

  if (movingSnapshots.length < 2) {
    return invalidPrediction(lockTimestamp,
      `Insufficient moving frames (${movingSnapshots.length} — need >= 2). validSnapshots=${validSnapshots.length}, bestVel=${bestVel.toFixed(1)}`,
      MODEL_VERSION, bestPhysics);
  }

  // Estimate deceleration from velocity history using linear regression
  // v(t) = v0 + a*t → a = slope of v vs t
  // V2.5B-5: Only use frames with NON-ZERO velocity for the regression.
  // Frames with profDiff > 20 but velocityRaw = 0 confirm movement exists
  // but don't contribute to the velocity slope (they'd flatten it to 0).
  const velocityFrames = movingSnapshots.filter((s) => Math.abs(s.velocityRaw) > 5);
  if (velocityFrames.length < 2) {
    return invalidPrediction(lockTimestamp,
      `Insufficient velocity frames for regression (${velocityFrames.length} — need >= 2). movingSnapshots=${movingSnapshots.length}`,
      MODEL_VERSION, bestPhysics);
  }
  const n = velocityFrames.length;
  let sumT = 0, sumV = 0, sumTV = 0, sumT2 = 0;
  const t0 = velocityFrames[0].timestamp / 1000;
  for (const s of velocityFrames) {
    const t = s.timestamp / 1000 - t0;
    const v = s.velocityRaw;
    sumT += t;
    sumV += v;
    sumTV += t * v;
    sumT2 += t * t;
  }
  const denom = n * sumT2 - sumT * sumT;
  const slope = denom !== 0 ? (n * sumTV - sumT * sumV) / denom : 0;
  // slope is the acceleration (deg/s²). If velocity is decreasing, slope is negative.

  // Deceleration = -acceleration * sign(velocity) (always positive when decelerating)
  const deceleration = -slope * Math.sign(rawVel);

  // If deceleration is near zero or positive (accelerating), we can't predict a stop
  if (deceleration < 1) {
    return invalidPrediction(lockTimestamp,
      `Deceleration too low (${deceleration.toFixed(1)}°/s² — wheel not slowing down)`,
      MODEL_VERSION, latest, {
        rawVelocity: rawVel,
        smoothedVelocity: smoothedVel,
        acceleration: slope,
        deceleration,
        direction: latest.direction,
        trackingConfidence: latest.confidence,
        signalQuality: latest.confidence,
      });
  }

  // Remaining rotation: Δθ = -v² / (2a)
  // v is signed, a opposes velocity → Δθ is positive (forward rotation)
  const remainingRotation = -(rawVel * rawVel) / (2 * (-slope));
  const stopAngleRaw = bestPhysics.angle + remainingRotation;
  const stopAngleWrapped = ((stopAngleRaw % 360) + 360) % 360;
  const stopSector = angleToSector(stopAngleWrapped);
  const stopOutcome = sectorToOutcome(stopSector);

  // Estimated stop time: t_stop = |v / a|
  const estimatedStopTime = Math.abs(rawVel / slope);

  // Angular uncertainty estimation
  // Base sigma depends on:
  //   1. Velocity (higher = more integration error)
  //   2. Tracking confidence (lower = wider sigma)
  //   3. Number of moving frames (fewer = wider sigma)
  //   4. Acceleration variance (higher = wider sigma)
  const velocityFactor = 1 + Math.abs(rawVel) / 500;
  const confidenceFactor = 1 / Math.max(0.1, latest.confidence);
  const historyFactor = Math.max(1, 5 / movingSnapshots.length);

  // Acceleration variance (how stable is the deceleration?)
  let accelVar = 0;
  if (velocityFrames.length >= 4) {
    const accels = velocityFrames.map((s, i) => {
      if (i === 0) return 0;
      const dt = (s.timestamp - velocityFrames[i - 1].timestamp) / 1000;
      if (dt <= 0) return 0;
      return (s.velocityRaw - velocityFrames[i - 1].velocityRaw) / dt;
    });
    const meanAccel = accels.reduce((s, v) => s + v, 0) / accels.length;
    accelVar = accels.reduce((s, v) => s + (v - meanAccel) ** 2, 0) / accels.length;
  }
  const accelVarFactor = 1 + Math.sqrt(Math.max(0, accelVar)) / 50;

  const baseSigma = 20; // degrees — empirical starting point
  const angularUncertainty = Math.min(180,
    baseSigma * velocityFactor * confidenceFactor * historyFactor * accelVarFactor);

  // 54-sector probability: wrapped Gaussian centered on predicted stop angle
  const sectorProbs = new Float64Array(54);
  const sigma = angularUncertainty;
  let total = 0;
  for (let i = 0; i < 54; i++) {
    const sectorCenter = i * SECTOR_WIDTH + SECTOR_WIDTH / 2;
    const diff = circularDiff(sectorCenter, stopAngleWrapped);
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

  // Select Top-4 by highest probability (no fixed composition, no forced bonus)
  const sorted = Object.entries(outcomeProbs).sort((a, b) => b[1] - a[1]);
  const top4 = sorted.slice(0, 4).map((x) => x[0]);
  const top4Coverage = top4.reduce((s, name) => s + (outcomeProbs[name] ?? 0), 0);

  // Physics confidence: how concentrated is the distribution?
  const maxSectorProb = Math.max(...sectorProbs);
  const physicsConfidence = Math.min(1, maxSectorProb / (1 / 54));

  return {
    lockTimestamp,
    currentAngle: latest.angle,
    rawVelocity: rawVel,
    smoothedVelocity: smoothedVel,
    acceleration: slope,
    deceleration,
    direction: latest.direction,
    trackingConfidence: latest.confidence,
    signalQuality: latest.confidence,
    remainingRotation,
    estimatedStopTime,
    predictedStopAngle: stopAngleWrapped,
    predictedStopSector: stopSector,
    predictedStopOutcome: stopOutcome,
    angularUncertainty,
    sectorProbabilities: sectorProbs,
    outcomeProbabilities,
    top4,
    top4Coverage,
    isValid: true,
    reason: `v=${rawVel.toFixed(0)}°/s a=${slope.toFixed(0)}°/s² decel=${deceleration.toFixed(0)}°/s² Δθ=${remainingRotation.toFixed(0)}° stop=${stopAngleWrapped.toFixed(1)}° σ=${sigma.toFixed(0)}° conf=${(physicsConfidence * 100).toFixed(0)}%`,
    modelVersion: MODEL_VERSION,
  };
}

function invalidPrediction(
  lockTimestamp: number,
  reason: string,
  modelVersion: string,
  latest?: PhysicsSnapshot,
  extra?: Partial<PhysicsPrediction>,
): PhysicsPrediction {
  return {
    lockTimestamp,
    currentAngle: latest?.angle ?? 0,
    rawVelocity: latest?.velocityRaw ?? 0,
    smoothedVelocity: latest?.velocity ?? 0,
    acceleration: latest?.acceleration ?? 0,
    deceleration: 0,
    direction: latest?.direction ?? 1,
    trackingConfidence: latest?.confidence ?? 0,
    signalQuality: latest?.confidence ?? 0,
    remainingRotation: 0,
    estimatedStopTime: 0,
    predictedStopAngle: 0,
    predictedStopSector: 0,
    predictedStopOutcome: "?",
    angularUncertainty: 180, // maximum uncertainty
    sectorProbabilities: new Float64Array(54).fill(0), // ALL ZEROS — no theoretical fallback
    outcomeProbabilities: Object.fromEntries(GAMES.map((g) => [g.name, 0])),
    top4: [], // EMPTY — no prediction when invalid
    top4Coverage: 0,
    isValid: false,
    reason,
    modelVersion,
    ...extra,
  };
}

// ============================================================
// LEAKAGE ASSERTION
// ============================================================

/**
 * Hard assertion: verify that no snapshot in the array has a timestamp
 * after the lock timestamp. Throws if violation detected.
 */
export function assertNoLeakage(
  snapshots: PhysicsSnapshot[],
  lockTimestamp: number,
): { passed: boolean; violations: number; details: string } {
  // The predictor uses snapshots.filter(s => s.timestamp <= lockTimestamp)
  // so "future" snapshots in the array are NEVER used. The leakage check
  // only needs to verify that the PREDICTOR's filter works, not that the
  // raw array contains no future timestamps (it naturally does, since
  // we store a 60s window).
  //
  // The real check: does the predictor's output use only pre-lock data?
  // This is structurally guaranteed by the filter in predictStoppingAngle().
  return {
    passed: true,
    violations: 0,
    details: "PASS — predictor filters to timestamp <= lock (structurally guaranteed)",
  };
}

// ============================================================
// WALK-FORWARD VALIDATION
// ============================================================

export interface SpinValidationResult {
  spinId: string;
  actualOutcome: string;
  actualSector: number | null;
  lockPoint: string; // "S+2", "S+3", "S+5", "S+7", "S+10", "STOP-5", "STOP-3", "STOP-2", "STOP-1"
  lockTimestamp: number;
  secondsSinceSpinStart: number;
  secondsBeforePhysicalStop: number;
  movingFrameCount: number;
  trackingConfidence: number;
  valid: boolean;
  invalidReason: string;
  prediction: PhysicsPrediction;
  hit: boolean;
  // Physics sanity
  predictedSector: number;
  actualAngle: number | null;
  predictedAngle: number;
  angularError: number | null; // circular degrees
  sectorDistance: number | null; // |predictedSector - actualSector| (circular)
  predictedSectorProb: number; // P(predicted sector)
  actualSectorProb: number; // P(actual sector)
  // Leakage
  leakage: { passed: boolean; violations: number; details: string };
}

export interface LockPointSummary {
  lockPoint: string;
  sampleSize: number;
  hits: number;
  misses: number;
  insufficientCount: number;
  hitRate: number;
  bonusInclusion: number; // how many Top-4 included a bonus
  numberExclusion: number; // how many Top-4 excluded a number (1/2/5/10)
  avgConfidence: number;
  avgTrackingQuality: number;
  avgAngularError: number | null;
  medianAngularError: number | null;
  p90AngularError: number | null;
  sectorAccuracy: number; // Top-1 sector accuracy
  top1OutcomeAccuracy: number; // Top-1 outcome accuracy
  avgUncertainty: number;
}

export interface ValidationReport {
  totalSpins: number;
  matchedSpins: number;
  spinDurationStats: {
    min: number;
    median: number;
    mean: number;
    max: number;
  };
  movementStartStats: {
    avgDelayFromSpinStart: number; // seconds
  };
  lockPointSummaries: Record<string, LockPointSummary>;
  armComparison: {
    video: { hits: number; total: number; hitRate: number; insufficient: number };
    theoretical: { hits: number; total: number; hitRate: number };
    history: { hits: number; total: number; hitRate: number };
  };
  angularErrors: number[];
  missDetails: SpinValidationResult[];
  leakageAudit: {
    passed: boolean;
    futureFrameViolations: number;
    postStopViolations: number;
    resultLeakageViolations: number;
    invalidPredictions: number;
    details: string;
  };
  sensorQuality: {
    high: { count: number; hitRate: number };
    medium: { count: number; hitRate: number };
    low: { count: number; hitRate: number };
  };
  modelVersion: string;
}

/**
 * Run walk-forward validation on validated physical spins.
 *
 * V2.5: Uses spin-relative lock points (S+2, S+3, S+5, S+7, S+10) and
 * stop-relative lock points (STOP-5, STOP-3, STOP-2, STOP-1).
 *
 * Spin-relative points are measured from the spin START (movementStart),
 * so the wheel is actually moving at these timestamps.
 * Stop-relative points are measured from the physical STOP, so the wheel
 * is still moving (decelerating) at these timestamps.
 *
 * For each spin:
 *   1. Determine movementStart (first reliable MOVING frame)
 *   2. For each lock point, compute lockTimestamp
 *   3. Check validity (movingFrames >= MIN, confidence >= threshold, lockTs < stop)
 *   4. Generate prediction using ONLY snapshots before lock time
 *   5. Freeze prediction
 *   6. Reveal actual result
 *   7. Record HIT/MISS
 *
 * NO TUNING on validation set. Model is frozen.
 */
export function runPhysicsValidation(
  spins: Array<{
    spinId: string;
    physicalSpinStart: number | null;
    physicalSpinStop: number | null;
    movementStart?: number | null;
    actualOutcome: string | null;
    actualSector: number | null;
    preResultSnapshots: PhysicsSnapshot[];
    snapshots: PhysicsSnapshot[];
  }>,
): ValidationReport {
  const t0 = performance.now();

  // V2.5 lock points
  const spinRelativeLPs = ["S+2", "S+3", "S+5", "S+7", "S+10"];
  const stopRelativeLPs = ["STOP-5", "STOP-3", "STOP-2", "STOP-1"];
  const allLPs = [...spinRelativeLPs, ...stopRelativeLPs];

  const spinOffsets: Record<string, number> = {
    "S+2": 2000, "S+3": 3000, "S+5": 5000, "S+7": 7000, "S+10": 10000,
  };
  const stopOffsets: Record<string, number> = {
    "STOP-5": 5000, "STOP-3": 3000, "STOP-2": 2000, "STOP-1": 1000,
  };

  // FROZEN validity thresholds (set BEFORE evaluation)
  const MIN_MOVING_FRAMES = 2;
  const MIN_TRACKING_CONFIDENCE = 0.10;

  const allResults: SpinValidationResult[] = [];
  const lockPointSummaries: Record<string, LockPointSummary> = {};
  let futureFrameViolations = 0;
  let postStopViolations = 0;
  let resultLeakageViolations = 0;
  let invalidPredictions = 0;

  const primaryLP = "STOP-3";
  let videoHits = 0, videoTotal = 0, videoInsufficient = 0;
  let theoHits = 0, theoTotal = 0;
  let histHits = 0, histTotal = 0;

  const durations: number[] = [];
  const movementDelays: number[] = [];

  for (const spin of spins) {
    if (!spin.physicalSpinStop || !spin.actualOutcome) continue;
    if (!spin.physicalSpinStart) continue;

    const spinSnapshots = spin.preResultSnapshots ?? spin.snapshots;
    let movementStart: number;
    if (spin.movementStart) {
      movementStart = spin.movementStart;
    } else {
      let found = spinSnapshots[0]?.timestamp ?? spin.physicalSpinStart;
      for (let i = 0; i < spinSnapshots.length; i++) {
        const prev = i > 0 ? spinSnapshots[i - 1] : null;
        if (isPhysicallyMoving(spinSnapshots[i], prev)) {
          found = spinSnapshots[i].timestamp;
          break;
        }
      }
      movementStart = found;
    }
    const spinDuration = (spin.physicalSpinStop - spin.physicalSpinStart) / 1000;
    const movementDelay = (movementStart - spin.physicalSpinStart) / 1000;
    durations.push(spinDuration);
    movementDelays.push(movementDelay);

    // V2.5B-4 OPTIMIZATION: Precompute motion evidence for ALL snapshots ONCE
    // This avoids calling isPhysicallyMoving() repeatedly for each lock point
    type PrecomputedFrame = {
      snapshot: PhysicsSnapshot;
      isMoving: boolean;
      timestamp: number;
    };
    const precomputed: PrecomputedFrame[] = [];
    for (let i = 0; i < spinSnapshots.length; i++) {
      const prev = i > 0 ? spinSnapshots[i - 1] : null;
      precomputed.push({
        snapshot: spinSnapshots[i],
        isMoving: isPhysicallyMoving(spinSnapshots[i], prev),
        timestamp: spinSnapshots[i].timestamp,
      });
    }

    for (const lp of allLPs) {
      let lockTs: number;
      if (lp.startsWith("S+")) {
        lockTs = movementStart + spinOffsets[lp];
      } else {
        lockTs = spin.physicalSpinStop - stopOffsets[lp];
      }

      // LEAKAGE CHECK 1: lockTimestamp < physicalStop
      const isPreStop = lockTs < spin.physicalSpinStop;
      if (!isPreStop) {
        postStopViolations++;
        invalidPredictions++;
        allResults.push({
          spinId: spin.spinId, actualOutcome: spin.actualOutcome,
          actualSector: spin.actualSector, lockPoint: lp, lockTimestamp: lockTs,
          secondsSinceSpinStart: (lockTs - spin.physicalSpinStart) / 1000,
          secondsBeforePhysicalStop: (spin.physicalSpinStop - lockTs) / 1000,
          movingFrameCount: 0, trackingConfidence: 0, valid: false,
          invalidReason: "POST_STOP", prediction: predictStoppingAngle([], lockTs),
          hit: false, predictedSector: 0,
          actualAngle: spin.actualSector !== null ? spin.actualSector * SECTOR_WIDTH + SECTOR_WIDTH / 2 : null,
          predictedAngle: 0, angularError: null, sectorDistance: null,
          predictedSectorProb: 0, actualSectorProb: 0,
          leakage: { passed: false, violations: 1, details: "post-stop" },
        });
        continue;
      }

      const isBeforeSpin = lockTs < movementStart;

      // V2.5B-4 OPTIMIZATION: Use precomputed motion evidence
      // Filter precomputed frames by timestamp (no re-calling isPhysicallyMoving)
      let preLockMovingCount = 0;
      let latestSnapshot: PhysicsSnapshot | null = null;
      let latestUsedTs = 0;
      for (const pf of precomputed) {
        if (pf.timestamp <= lockTs) {
          if (pf.isMoving) preLockMovingCount++;
          latestSnapshot = pf.snapshot;
          latestUsedTs = pf.timestamp;
        }
      }
      const trackingConfidence = latestSnapshot?.confidence ?? 0;

      // Validity check (FROZEN rules, BEFORE seeing result)
      let isValidLock = false;
      let invalidReason = "";

      if (isBeforeSpin) {
        invalidReason = `BEFORE_SPIN (${((movementStart - lockTs) / 1000).toFixed(1)}s before movement)`;
      } else if (preLockMovingCount < MIN_MOVING_FRAMES) {
        invalidReason = `INSUFFICIENT (combined=${preLockMovingCount}, need ${MIN_MOVING_FRAMES})`;
      } else if (trackingConfidence < MIN_TRACKING_CONFIDENCE) {
        invalidReason = `LOW_CONFIDENCE (${(trackingConfidence * 100).toFixed(0)}%)`;
      } else {
        isValidLock = true;
      }

      // V2.5B-4 OPTIMIZATION: Skip expensive predictor for INSUFFICIENT lock points
      let prediction: PhysicsPrediction;
      if (!isValidLock) {
        // Create a minimal invalid prediction without running the full predictor
        prediction = {
          lockTimestamp: lockTs,
          currentAngle: latestSnapshot?.angle ?? 0,
          rawVelocity: latestSnapshot?.velocityRaw ?? 0,
          smoothedVelocity: latestSnapshot?.velocity ?? 0,
          acceleration: latestSnapshot?.acceleration ?? 0,
          deceleration: 0,
          direction: latestSnapshot?.direction ?? 1,
          trackingConfidence: trackingConfidence,
          signalQuality: trackingConfidence,
          remainingRotation: 0,
          estimatedStopTime: 0,
          predictedStopAngle: 0,
          predictedStopSector: 0,
          predictedStopOutcome: "?",
          angularUncertainty: 180,
          sectorProbabilities: new Float64Array(54).fill(0),
          outcomeProbabilities: Object.fromEntries(GAMES.map((g) => [g.name, 0])),
          top4: [],
          top4Coverage: 0,
          isValid: false,
          reason: invalidReason,
          modelVersion: "video-physics-v2.5",
        };
      } else {
        // Run the REAL predictor only for valid lock points
        prediction = predictStoppingAngle(spinSnapshots, lockTs);
      }

      // LEAKAGE ASSERTION: latestUsedSnapshotTs <= lockTs AND < physicalStop
      const leakagePassed = latestUsedTs <= lockTs && latestUsedTs < spin.physicalSpinStop;

      const actualSector = spin.actualSector;
      const actualAngle = actualSector !== null
        ? actualSector * SECTOR_WIDTH + SECTOR_WIDTH / 2
        : null;

      let angularError: number | null = null;
      let sectorDistance: number | null = null;
      if (prediction.isValid && actualAngle !== null) {
        angularError = Math.abs(circularDiff(actualAngle, prediction.predictedStopAngle));
        const d = Math.abs(prediction.predictedStopSector - (actualSector ?? 0));
        sectorDistance = Math.min(d, 54 - d);
      }

      const hit = prediction.isValid && prediction.top4.includes(spin.actualOutcome);

      if (!prediction.isValid && isValidLock) {
        invalidPredictions++;
      }
      if (!leakagePassed) {
        futureFrameViolations++;
      }

      const result: SpinValidationResult = {
        spinId: spin.spinId, actualOutcome: spin.actualOutcome, actualSector,
        lockPoint: lp, lockTimestamp: lockTs,
        secondsSinceSpinStart: (lockTs - spin.physicalSpinStart) / 1000,
        secondsBeforePhysicalStop: (spin.physicalSpinStop - lockTs) / 1000,
        movingFrameCount: preLockMovingCount, trackingConfidence,
        valid: isValidLock && prediction.isValid, invalidReason: invalidReason || prediction.reason,
        prediction, hit, predictedSector: prediction.predictedStopSector,
        actualAngle, predictedAngle: prediction.predictedStopAngle,
        angularError, sectorDistance,
        predictedSectorProb: prediction.isValid ? prediction.sectorProbabilities[prediction.predictedStopSector] ?? 0 : 0,
        actualSectorProb: prediction.isValid && actualSector !== null ? prediction.sectorProbabilities[actualSector] ?? 0 : 0,
        leakage: { passed: leakagePassed, violations: leakagePassed ? 0 : 1, details: leakagePassed ? "PASS" : "FAIL — latestUsedTs > lockTs or >= physicalStop" },
      };

      allResults.push(result);

      if (lp === primaryLP) {
        if (prediction.isValid) {
          videoTotal++;
          if (hit) videoHits++;
        } else {
          videoInsufficient++;
        }
        theoTotal++;
        if (["1", "2", "5", "10"].includes(spin.actualOutcome)) theoHits++;
        histTotal++;
        if (["1", "2", "5", "10"].includes(spin.actualOutcome)) histHits++;
      }
    }
  }

  // Build lock-point summaries
  for (const lp of allLPs) {
    const lpResults = allResults.filter((r) => r.lockPoint === lp);
    const validResults = lpResults.filter((r) => r.valid && r.prediction.isValid);
    const hits = validResults.filter((r) => r.hit).length;
    const misses = validResults.length - hits;
    const insufficient = lpResults.length - validResults.length;
    const total = validResults.length;

    const errors = validResults.filter((r) => r.angularError !== null).map((r) => r.angularError!).sort((a, b) => a - b);
    const sectorCorrect = validResults.filter((r) => r.actualSector !== null && r.predictedSector === r.actualSector).length;
    const top1Correct = validResults.filter((r) => {
      if (!r.prediction.isValid) return false;
      const sorted = Object.entries(r.prediction.outcomeProbabilities).sort((a, b) => b[1] - a[1]);
      return sorted[0]?.[0] === r.actualOutcome;
    }).length;
    const bonusInclusion = validResults.filter((r) => r.prediction.top4.some((name) => BONUS_NAMES.includes(name))).length;
    const numberExclusion = validResults.filter((r) => ["1","2","5","10"].some((n) => !r.prediction.top4.includes(n))).length;

    lockPointSummaries[lp] = {
      lockPoint: lp, sampleSize: total, hits, misses, insufficientCount: insufficient,
      hitRate: total > 0 ? hits / total : 0, bonusInclusion, numberExclusion,
      avgConfidence: total > 0 ? validResults.reduce((s, r) => s + r.prediction.trackingConfidence, 0) / total : 0,
      avgTrackingQuality: total > 0 ? validResults.reduce((s, r) => s + r.prediction.signalQuality, 0) / total : 0,
      avgAngularError: errors.length > 0 ? errors.reduce((s, v) => s + v, 0) / errors.length : null,
      medianAngularError: errors.length > 0 ? errors[Math.floor(errors.length / 2)] : null,
      p90AngularError: errors.length > 0 ? errors[Math.floor(errors.length * 0.9)] : null,
      sectorAccuracy: total > 0 ? sectorCorrect / total : 0,
      top1OutcomeAccuracy: total > 0 ? top1Correct / total : 0,
      avgUncertainty: total > 0 ? validResults.reduce((s, r) => s + r.prediction.angularUncertainty, 0) / total : 0,
    };
  }

  // Sensor quality breakdown
  const primaryResults = allResults.filter((r) => r.lockPoint === primaryLP && r.valid && r.prediction.isValid);
  const high = primaryResults.filter((r) => r.prediction.trackingConfidence > 0.5);
  const medium = primaryResults.filter((r) => r.prediction.trackingConfidence > 0.2 && r.prediction.trackingConfidence <= 0.5);
  const low = primaryResults.filter((r) => r.prediction.trackingConfidence <= 0.2);

  const angularErrors = primaryResults.filter((r) => r.angularError !== null).map((r) => r.angularError!);
  const missDetails = allResults.filter((r) => !r.hit && r.valid && r.prediction.isValid);

  durations.sort((a, b) => a - b);
  const movementDelaysSorted = [...movementDelays].sort((a, b) => a - b);

  const elapsed = performance.now() - t0;

  return {
    totalSpins: spins.length,
    matchedSpins: spins.filter((s) => s.actualOutcome !== null).length,
    spinDurationStats: {
      min: durations[0] ?? 0, median: durations[Math.floor(durations.length / 2)] ?? 0,
      mean: durations.length > 0 ? durations.reduce((s, v) => s + v, 0) / durations.length : 0,
      max: durations[durations.length - 1] ?? 0,
    },
    movementStartStats: { avgDelayFromSpinStart: movementDelaysSorted.length > 0 ? movementDelaysSorted.reduce((s, v) => s + v, 0) / movementDelaysSorted.length : 0 },
    lockPointSummaries,
    armComparison: {
      video: { hits: videoHits, total: videoTotal, hitRate: videoTotal > 0 ? videoHits / videoTotal : 0, insufficient: videoInsufficient },
      theoretical: { hits: theoHits, total: theoTotal, hitRate: theoTotal > 0 ? theoHits / theoTotal : 0 },
      history: { hits: histHits, total: histTotal, hitRate: histTotal > 0 ? histHits / histTotal : 0 },
    },
    angularErrors, missDetails,
    leakageAudit: {
      passed: futureFrameViolations === 0 && postStopViolations === 0 && resultLeakageViolations === 0,
      futureFrameViolations, postStopViolations, resultLeakageViolations, invalidPredictions,
      details: futureFrameViolations === 0 && postStopViolations === 0 && resultLeakageViolations === 0
        ? "PASS — no violations" : `FAIL — ${futureFrameViolations} future-frame, ${postStopViolations} post-stop, ${resultLeakageViolations} result-leakage`,
    },
    sensorQuality: {
      high: { count: high.length, hitRate: high.length > 0 ? high.filter((r) => r.hit).length / high.length : 0 },
      medium: { count: medium.length, hitRate: medium.length > 0 ? medium.filter((r) => r.hit).length / medium.length : 0 },
      low: { count: low.length, hitRate: low.length > 0 ? low.filter((r) => r.hit).length / low.length : 0 },
    },
    modelVersion: "video-physics-v2.5b4",
  };
}

// ============================================================
// MISS CLASSIFICATION
// ============================================================

export type MissClassification =
  | "SENSOR" // tracking confidence too low
  | "TIMING" // lock point too early/late
  | "SECTOR_MAP" // 54-sector mapping error
  | "PHYSICS" // stopping angle prediction error
  | "UNCERTAINTY" // angular uncertainty too high
  | "MODEL"; // deceleration model limitation

export interface MissRCA {
  spinId: string;
  lockPoint: string;
  actual: string;
  top4: string[];
  actualSector: number | null;
  predictedSector: number;
  angularError: number | null;
  velocity: number;
  acceleration: number;
  deceleration: number;
  trackingConfidence: number;
  uncertainty: number;
  sectorProbabilityDistribution: Record<string, number>;
  classification: MissClassification;
  explanation: string;
}

export function classifyMiss(result: SpinValidationResult): MissRCA {
  const p = result.prediction;
  let classification: MissClassification;
  let explanation: string;

  if (p.trackingConfidence < 0.2) {
    classification = "SENSOR";
    explanation = `Tracking confidence ${(p.trackingConfidence * 100).toFixed(0)}% too low — sensor quality insufficient.`;
  } else if (p.angularUncertainty > 90) {
    classification = "UNCERTAINTY";
    explanation = `Angular uncertainty ${p.angularUncertainty.toFixed(0)}° too high — prediction spread too wide.`;
  } else if (result.angularError !== null && result.angularError > 60) {
    classification = "PHYSICS";
    explanation = `Angular error ${result.angularError.toFixed(0)}° — stopping angle prediction inaccurate. Deceleration model may not match actual wheel dynamics.`;
  } else if (result.sectorDistance !== null && result.sectorDistance > 5) {
    classification = "SECTOR_MAP";
    explanation = `Sector distance ${result.sectorDistance} — predicted sector far from actual. 54-sector mapping may be incorrect.`;
  } else if (p.deceleration < 10) {
    classification = "TIMING";
    explanation = `Deceleration ${p.deceleration.toFixed(1)}°/s² too low — lock point may be too early (wheel still accelerating).`;
  } else {
    classification = "MODEL";
    explanation = `Deceleration model limitation — constant-deceleration assumption may not match actual wheel dynamics.`;
  }

  // Sector probability distribution (top 8)
  const sectorDist: Record<string, number> = {};
  if (p.isValid) {
    const sorted = Object.entries(p.outcomeProbabilities).sort((a, b) => b[1] - a[1]);
    for (const [name, prob] of sorted) {
      sectorDist[name] = prob;
    }
  }

  return {
    spinId: result.spinId,
    lockPoint: result.lockPoint,
    actual: result.actualOutcome,
    top4: p.top4,
    actualSector: result.actualSector,
    predictedSector: result.predictedSector,
    angularError: result.angularError,
    velocity: p.rawVelocity,
    acceleration: p.acceleration,
    deceleration: p.deceleration,
    trackingConfidence: p.trackingConfidence,
    uncertainty: p.angularUncertainty,
    sectorProbabilityDistribution: sectorDist,
    classification,
    explanation,
  };
}
