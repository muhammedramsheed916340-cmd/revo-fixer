/**
 * ML MODEL MODULE — Lightweight Logistic Regression for Outcome Prediction
 * =======================================================================
 *
 * Pure TypeScript machine learning module for Crazy Time outcome prediction.
 * NO external ML libraries — implements logistic regression from scratch.
 *
 * ARCHITECTURE
 * ------------
 *   - 8 binary logistic regression classifiers (one-vs-rest per outcome)
 *   - Trained with batch gradient descent
 *   - L2 regularization (lambda tunable)
 *   - Feature standardization (mean/std computed from TRAINING data ONLY)
 *   - Chronological train/validation split (70/30 by lockTimestamp)
 *   - NEVER shuffles temporal data
 *
 * FEATURE GROUPS
 * --------------
 *   1. PHYSICS (from video snapshots, all timestamp <= lockTimestamp)
 *      - current angle, velocity (raw + smoothed), acceleration, deceleration
 *      - movement duration, spin duration
 *      - predicted stop-angle estimate, predicted sector, angular uncertainty
 *      - tracking confidence, signal agreement, calibration stable
 *      - direction, moving frame count, tracking frame count
 *      - distance to nearest bonus sector
 *
 *   2. HISTORY (from past settled spins, all settledAt <= lockTimestamp)
 *      - empirical frequency of each of the 8 outcomes
 *      - last outcome (one-hot)
 *      - transition evidence: P(next = k | last outcome)
 *      - history sample size (log scaled)
 *
 *   3. CONTEXT
 *      - spin duration (seconds from spin start to lock)
 *      - time of day (hour, sin/cos encoded — periodic)
 *      - recent movement rate (moving / total frames)
 *
 * LEAKAGE GUARANTEE
 * -----------------
 *   - extractFeatures() accepts an optional lockTimestamp.
 *     If provided, snapshots with timestamp > lockTimestamp are REMOVED and
 *     history spins with settledAt > lockTimestamp are REMOVED. This is a
 *     hard, structural guard — even if the caller passes future data, it
 *     cannot leak into features.
 *   - trainMLModel() sorts samples by lockTimestamp (NEVER shuffles) and
 *     splits chronologically. Validation samples are always LATER in time
 *     than training samples, mimicking realistic deployment.
 *   - If insufficient training data (< MIN_SAMPLES samples, or any class
 *     has < MIN_POSITIVES positive examples), predictML returns uniform
 *     probabilities (1/8 each) with isFallback = true.
 *
 * USAGE
 * -----
 *   import { trainMLModel, predictML, extractFeatures } from "./mlModel";
 *
 *   // 1. Train on historical (snapshot, outcome) pairs:
 *   const stats = trainMLModel(samples);
 *
 *   // 2. Extract features at prediction time (pre-lock only):
 *   const features = extractFeatures(snapshots, history, lockTimestamp);
 *
 *   // 3. Predict:
 *   const pred = predictML(features);
 *   // pred.probabilities = { "1": 0.31, "2": 0.27, ... }
 */

import type { PhysicsSnapshot } from "./videoPhysicsHistory";
import type { SpinData } from "./aiStats";

// ============================================================
// CONSTANTS
// ============================================================

export const ML_MODEL_VERSION = "ml-logistic-v1.0";

/** The 8 outcomes (matches GAMES in decisionEngine.ts). */
export const OUTCOME_NAMES = [
  "1",
  "2",
  "5",
  "10",
  "PACHINKO",
  "COIN FLIP",
  "CASH HUNT",
  "CRAZY TIME",
] as const;

/** Bonus outcomes (used for "distance to nearest bonus" feature). */
const BONUS_OUTCOMES = new Set(["PACHINKO", "COIN FLIP", "CASH HUNT", "CRAZY TIME"]);

/** Map CasinoScores / engine sector names to canonical outcome names. */
const SECTOR_TO_OUTCOME: Record<string, string> = {
  "1": "1",
  "2": "2",
  "5": "5",
  "10": "10",
  CoinFlip: "COIN FLIP",
  Pachinko: "PACHINKO",
  CashHunt: "CASH HUNT",
  CrazyTime: "CRAZY TIME",
  CrazyBonus: "CRAZY TIME",
  "COIN FLIP": "COIN FLIP",
  PACHINKO: "PACHINKO",
  "CASH HUNT": "CASH HUNT",
  "CRAZY TIME": "CRAZY TIME",
};

/** 54-sector physical order of the Evolution Crazy Time wheel. */
export const PHYSICAL_ORDER_54 = [
  "1", "2", "5", "1", "2", "10", "1", "PACHINKO", "2", "1", "5", "COIN FLIP",
  "1", "2", "10", "1", "2", "5", "1", "CASH HUNT", "2", "1", "5", "10", "2", "1",
  "COIN FLIP", "5", "1", "2", "10", "1", "PACHINKO", "2", "5", "1", "10", "2",
  "1", "CRAZY TIME", "5", "2", "10", "1", "2", "5", "1", "COIN FLIP", "2", "10", "1", "5",
];

export const SECTOR_WIDTH = 360 / 54; // 6.6667° per sector

/** Ordered feature names. The order MUST match featuresToVector(). */
export const FEATURE_NAMES = [
  // --- Physics features (18) ---
  "physics_angle_norm",                  // 0  current angle / 360 (wrapped)
  "physics_velocity_raw",                // 1  raw velocity / 2000 (clipped)
  "physics_velocity_smoothed",          // 2  smoothed velocity / 2000 (clipped)
  "physics_velocity_abs",                // 3  |raw velocity| / 2000
  "physics_acceleration",                // 4  deg/s^2 / 500 (clipped)
  "physics_deceleration",                // 5  positive deg/s^2 / 500
  "physics_movement_duration",           // 6  seconds / 60
  "physics_spin_duration",               // 7  seconds / 120
  "physics_predicted_stop_norm",         // 8  predicted stop angle / 360
  "physics_predicted_sector",            // 9  0..53 / 53
  "physics_angular_uncertainty",         // 10 degrees / 180
  "physics_tracking_confidence",         // 11 0..1
  "physics_signal_agreement",            // 12 0..1
  "physics_calibration_stable",          // 13 0 or 1
  "physics_direction",                   // 14 0 (CW) or 1 (CCW)
  "physics_moving_frame_ratio",          // 15 moving frames / total frames
  "physics_tracking_frame_ratio",        // 16 tracking frames / total frames
  "physics_distance_to_nearest_bonus",   // 17 sectors / 27
  // --- History features (17) ---
  "history_freq_1",                      // 18
  "history_freq_2",                      // 19
  "history_freq_5",                      // 20
  "history_freq_10",                     // 21
  "history_freq_PACHINKO",               // 22
  "history_freq_COIN_FLIP",              // 23
  "history_freq_CASH_HUNT",              // 24
  "history_freq_CRAZY_TIME",             // 25
  "history_last_1",                      // 26 one-hot of last outcome
  "history_last_2",                      // 27
  "history_last_5",                      // 28
  "history_last_10",                     // 29
  "history_last_PACHINKO",               // 30
  "history_last_COIN_FLIP",              // 31
  "history_last_CASH_HUNT",              // 32
  "history_last_CRAZY_TIME",             // 33
  "history_count_log",                   // 34 log(1 + count) / 10
  // --- Transition features (8) — P(next = k | last outcome) per k ---
  "transition_1",                        // 35
  "transition_2",                        // 36
  "transition_5",                        // 37
  "transition_10",                       // 38
  "transition_PACHINKO",                 // 39
  "transition_COIN_FLIP",                // 40
  "transition_CASH_HUNT",                // 41
  "transition_CRAZY_TIME",               // 42
  // --- Context features (4) ---
  "context_spin_duration",               // 43 seconds / 120
  "context_time_sin",                    // 44 sin(2π * hour / 24)
  "context_time_cos",                    // 45 cos(2π * hour / 24)
  "context_recent_movement_rate",        // 46 moving frames in last 60s / total
] as const;

export const NUM_FEATURES = FEATURE_NAMES.length;

// Training hyperparameters (tunable, no external config).
const HYPERPARAMS = {
  LEARNING_RATE: 0.1,
  EPOCHS: 300,
  L2_LAMBDA: 0.01,           // L2 regularization strength
  TRAIN_FRACTION: 0.7,       // chronological split (70% train, 30% validation)
  MIN_SAMPLES: 20,           // need >= 20 spins to train at all
  MIN_POSITIVES_PER_CLASS: 2,// need >= 2 positive examples per class
  STANDARDIZATION_EPS: 1e-8, // prevents division by zero
  PROB_EPS: 1e-9,            // numerical floor for log / division
  MAX_VELOCITY: 2000,        // deg/s clip
  MAX_ACCEL: 500,            // deg/s^2 clip
} as const;

/** Minimum number of samples required to train. Exported for tests. */
export const MIN_SAMPLES = HYPERPARAMS.MIN_SAMPLES;

// ============================================================
// TYPES
// ============================================================

/** Structured feature object (groups physics / history / context). */
export interface MLFeatures {
  physics: {
    angle: number;                       // current angle, deg (0..360 wrapped)
    velocityRaw: number;                 // deg/s (raw)
    velocitySmoothed: number;            // deg/s (smoothed)
    velocityAbs: number;                 // |raw velocity|, deg/s
    acceleration: number;                // deg/s^2 (signed)
    deceleration: number;                // deg/s^2 (positive when slowing)
    movementDuration: number;            // seconds (first MOVING → latest)
    spinDuration: number;                // seconds (earliest → latest snapshot)
    predictedStopAngle: number;          // deg (0..360)
    predictedStopSector: number;         // 0..53
    angularUncertainty: number;          // degrees (1-sigma)
    trackingConfidence: number;          // 0..1
    signalAgreement: number;              // 0..1
    calibrationStable: boolean;
    direction: 1 | -1;
    movingFrameRatio: number;            // moving / total frames (0..1)
    trackingFrameRatio: number;          // tracking / total frames (0..1)
    distanceToNearestBonus: number;       // sectors (0..27)
  };
  history: {
    frequencies: Record<string, number>; // 8 outcomes, 0..1, sums to 1
    lastOutcome: string | null;          // canonical name or null if empty
    transitionProbabilities: Record<string, number>; // 8 outcomes, P(next=k|last)
    count: number;                       // total past spins observed
  };
  context: {
    spinDuration: number;                // seconds (lock - spinStart)
    timeOfDayHour: number;               // 0..23.99 (fractional hour)
    lockTimestamp: number;               // ms epoch (for reference)
    recentMovementRate: number;          // moving frames in last 60s / total frames
  };
}

/** Prediction result returned by predictML(). */
export interface MLPrediction {
  /** 8 outcome probabilities. Sums to 1. */
  probabilities: Record<string, number>;
  /** Outcome with highest probability. */
  topOutcome: string;
  /** Highest probability value. */
  topProbability: number;
  /** Model version that produced this prediction. */
  modelVersion: string;
  /** True if model is untrained or insufficient data → uniform fallback. */
  isFallback: boolean;
  /** Human-readable reason (especially for fallback). */
  reason: string;
}

/** Training statistics returned by trainMLModel(). */
export interface MLModelStats {
  /** Number of training samples (after chronological split). */
  trainSamples: number;
  /** Number of validation samples (after chronological split). */
  validationSamples: number;
  /** Total samples received. */
  totalSamples: number;
  /** Top-1 accuracy on training set (fraction). */
  trainAccuracy: number;
  /** Top-1 accuracy on validation set (fraction). */
  validationAccuracy: number;
  /** Average log loss on training set (lower = better). */
  trainLogLoss: number;
  /** Average log loss on validation set. */
  validationLogLoss: number;
  /** Per-outcome validation recall (fraction of true k predicted as k). */
  perOutcomeValidationRecall: Record<string, number>;
  /** Per-outcome validation precision. */
  perOutcomeValidationPrecision: Record<string, number>;
  /** List of feature names (in vector order). */
  featureNames: readonly string[];
  /** Outcome class names. */
  outcomeNames: readonly string[];
  /** Whether training succeeded (false = fallback). */
  trained: boolean;
  /** Reason for fallback (if trained = false). */
  reason: string;
  /** Hyperparameters used (for reproducibility). */
  hyperparameters: Readonly<typeof HYPERPARAMS>;
  /** Model version. */
  modelVersion: string;
}

/** Trained model (serializable). */
export interface MLModel {
  modelVersion: string;
  trained: boolean;
  outcomeNames: readonly string[];
  featureNames: readonly string[];
  /** Per-feature mean (computed on training set). */
  mean: number[];
  /** Per-feature std (computed on training set). */
  std: number[];
  /** Per-outcome classifier weights + bias. */
  classifiers: { weights: number[]; bias: number }[];
  /** Training statistics. */
  stats: MLModelStats;
}

/** One training sample: pre-lock snapshots, past history, outcome label, lock time. */
export interface MLSpinSample {
  /** Pre-lock video snapshots for this spin (will be filtered by lockTimestamp). */
  snapshots: PhysicsSnapshot[];
  /** Past settled spins observed before this spin (will be filtered by lockTimestamp). */
  history: SpinData[];
  /** Actual outcome of this spin (canonical: "1".."10" or "PACHINKO" etc.). */
  outcome: string;
  /** Lock timestamp (ms epoch). Features use only data with ts <= lockTimestamp. */
  lockTimestamp: number;
  /** Optional spin start timestamp (ms epoch). Used for context.spinDuration. */
  spinStartTimestamp?: number;
}

// ============================================================
// INTERNAL STATE — singleton model
// ============================================================

let trainedModel: MLModel | null = null;

/** Reset the singleton model (for tests). */
export function resetMLModel(): void {
  trainedModel = null;
}

/** Get the current singleton model (null if not trained). */
export function getMLModel(): MLModel | null {
  return trainedModel;
}

// ============================================================
// HELPERS
// ============================================================

function normalizeOutcome(sector: string): string | null {
  return SECTOR_TO_OUTCOME[sector] ?? null;
}

function sectorToOutcome(idx: number): string {
  return PHYSICAL_ORDER_54[((idx % 54) + 54) % 54] ?? "?";
}

function angleToSector(angle: number): number {
  const a = ((angle % 360) + 360) % 360;
  return Math.floor(a / SECTOR_WIDTH) % 54;
}

/** Sigmoid (clamped to avoid overflow). */
function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Clip to [-clip, +clip]. */
function clip(v: number, limit: number): number {
  if (v > limit) return limit;
  if (v < -limit) return -limit;
  return v;
}

/** Parse a settledAt ISO string to ms epoch. Returns NaN on failure. */
function parseTimestamp(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : t;
}

/** Circular angular difference (shortest path, -180..180). */
function circularDiff(a: number, b: number): number {
  let diff = (((a - b) % 360) + 360) % 360;
  if (diff > 180) diff -= 360;
  return diff;
}

/** Smallest sector distance from a given sector to any sector of `outcome`. */
function distanceToOutcomeSector(startSector: number, outcome: string): number {
  let best = 27; // half the wheel
  for (let i = 0; i < 54; i++) {
    if (sectorToOutcome(i) === outcome) {
      const d = Math.abs(((i - startSector + 54) % 54));
      const circ = Math.min(d, 54 - d);
      if (circ < best) best = circ;
    }
  }
  return best;
}

/** Empty (zero) physics sub-features, used when no snapshots are available. */
function emptyPhysics(): MLFeatures["physics"] {
  return {
    angle: 0,
    velocityRaw: 0,
    velocitySmoothed: 0,
    velocityAbs: 0,
    acceleration: 0,
    deceleration: 0,
    movementDuration: 0,
    spinDuration: 0,
    predictedStopAngle: 0,
    predictedStopSector: 0,
    angularUncertainty: 180, // max uncertainty
    trackingConfidence: 0,
    signalAgreement: 0,
    calibrationStable: false,
    direction: 1,
    movingFrameRatio: 0,
    trackingFrameRatio: 0,
    distanceToNearestBonus: 27,
  };
}

function emptyHistory(): MLFeatures["history"] {
  return {
    frequencies: Object.fromEntries(OUTCOME_NAMES.map((n) => [n, 0])) as Record<string, number>,
    lastOutcome: null,
    transitionProbabilities: Object.fromEntries(
      OUTCOME_NAMES.map((n) => [n, 0]),
    ) as Record<string, number>,
    count: 0,
  };
}

function emptyContext(lockTimestamp: number): MLFeatures["context"] {
  return {
    spinDuration: 0,
    timeOfDayHour: 0,
    lockTimestamp,
    recentMovementRate: 0,
  };
}

// ============================================================
// PHYSICS FEATURE EXTRACTION (pre-lock only)
// ============================================================

/**
 * Compute physics features from pre-lock snapshots.
 *
 * LEAKAGE GUARANTEE: If `lockTimestamp` is provided, snapshots with
 * timestamp > lockTimestamp are removed BEFORE feature extraction.
 */
function extractPhysicsFeatures(
  snapshots: PhysicsSnapshot[],
  lockTimestamp?: number,
): MLFeatures["physics"] {
  if (!snapshots || snapshots.length === 0) return emptyPhysics();

  // HARD FILTER: only pre-lock snapshots (no future leakage).
  const pre = lockTimestamp != null
    ? snapshots.filter((s) => s.timestamp <= lockTimestamp)
    : snapshots.slice();
  if (pre.length === 0) return emptyPhysics();

  // OPTIMIZATION: only use the last 200 snapshots to keep it fast.
  const used = pre.slice(-200);
  const latest = used[used.length - 1];

  // ---- Latest physical state ----
  const angle = ((latest.angle % 360) + 360) % 360;
  const velocityRaw = clip(latest.velocityRaw, HYPERPARAMS.MAX_VELOCITY);
  const velocitySmoothed = clip(latest.velocity, HYPERPARAMS.MAX_VELOCITY);
  const velocityAbs = Math.abs(velocityRaw);
  const acceleration = clip(latest.acceleration, HYPERPARAMS.MAX_ACCEL);
  const trackingConfidence = clip(latest.confidence, 1);
  const signalAgreement = clip(latest.signalAgreement, 1);
  const calibrationStable = !!latest.calibrationStable;
  const direction = latest.direction;

  // ---- Movement duration: from first MOVING snapshot to latest ----
  let movementDuration = 0;
  const movingSnapshotsAll = used.filter((s) => s.movementState === "MOVING");
  if (movingSnapshotsAll.length > 0) {
    const firstMoving = movingSnapshotsAll[0]!;
    movementDuration = Math.max(0, (latest.timestamp - firstMoving.timestamp) / 1000);
  }

  // ---- Spin duration: earliest → latest snapshot ----
  const earliest = used[0]!;
  const spinDuration = Math.max(0, (latest.timestamp - earliest.timestamp) / 1000);

  // ---- Deceleration via linear regression on velocity history (pre-lock, moving only) ----
  const movingSnapshots = used
    .filter((s) => Math.abs(s.velocityRaw) > 50)
    .slice(-20);

  let deceleration = 0;
  let predictedStopAngle = angle;
  let angularUncertainty = 180; // max uncertainty if can't estimate
  let slope = 0;

  if (movingSnapshots.length >= 3) {
    const n = movingSnapshots.length;
    let sumT = 0, sumV = 0, sumTV = 0, sumT2 = 0;
    const t0 = movingSnapshots[0]!.timestamp / 1000;
    for (const s of movingSnapshots) {
      const t = s.timestamp / 1000 - t0;
      const v = s.velocityRaw;
      sumT += t;
      sumV += v;
      sumTV += t * v;
      sumT2 += t * t;
    }
    const denom = n * sumT2 - sumT * sumT;
    slope = denom !== 0 ? (n * sumTV - sumT * sumV) / denom : 0;
    deceleration = Math.max(0, -slope * Math.sign(velocityRaw));

    // Remaining rotation: Δθ = -v² / (2a).  v signed, slope opposes velocity.
    if (deceleration > 1) {
      const remainingRotation = -(velocityRaw * velocityRaw) / (2 * (-slope));
      const stopAngleRaw = latest.angle + remainingRotation;
      predictedStopAngle = ((stopAngleRaw % 360) + 360) % 360;

      // Uncertainty: grows with velocity, low confidence, short history.
      const velocityFactor = 1 + Math.abs(velocityRaw) / 500;
      const confidenceFactor = 1 / Math.max(0.1, trackingConfidence);
      const historyFactor = Math.max(1, 5 / movingSnapshots.length);
      const baseSigma = 20;
      angularUncertainty = Math.min(
        180,
        baseSigma * velocityFactor * confidenceFactor * historyFactor,
      );
    }
  }

  const predictedStopSector = angleToSector(predictedStopAngle);

  // ---- Distance to nearest bonus sector ----
  let distanceToNearestBonus = 27;
  for (const bonus of BONUS_OUTCOMES) {
    const d = distanceToOutcomeSector(predictedStopSector, bonus);
    if (d < distanceToNearestBonus) distanceToNearestBonus = d;
  }

  // ---- Frame ratios ----
  const totalFrames = used.length;
  const movingFrames = used.filter((s) => s.movementState === "MOVING").length;
  const trackingFrames = used.filter((s) => s.isTracking).length;
  const movingFrameRatio = totalFrames > 0 ? movingFrames / totalFrames : 0;
  const trackingFrameRatio = totalFrames > 0 ? trackingFrames / totalFrames : 0;

  return {
    angle,
    velocityRaw,
    velocitySmoothed,
    velocityAbs,
    acceleration,
    deceleration,
    movementDuration,
    spinDuration,
    predictedStopAngle,
    predictedStopSector,
    angularUncertainty,
    trackingConfidence,
    signalAgreement,
    calibrationStable,
    direction,
    movingFrameRatio,
    trackingFrameRatio,
    distanceToNearestBonus,
  };
}

// ============================================================
// HISTORY FEATURE EXTRACTION (pre-lock only)
// ============================================================

/**
 * Compute history features from past settled spins.
 *
 * LEAKAGE GUARANTEE: If `lockTimestamp` is provided, history spins with
 * settledAt > lockTimestamp are REMOVED before computing features.
 */
function extractHistoryFeatures(
  history: SpinData[],
  lockTimestamp?: number,
): MLFeatures["history"] {
  const empty = emptyHistory();
  if (!history || history.length === 0) return empty;

  // HARD FILTER: only settled-before-lock spins.
  const pre = lockTimestamp != null
    ? history.filter((s) => {
        const t = parseTimestamp(s.settledAt);
        return !Number.isNaN(t) && t <= lockTimestamp;
      })
    : history.slice();

  if (pre.length === 0) return empty;

  // ---- Frequency per outcome ----
  const counts: Record<string, number> = Object.fromEntries(
    OUTCOME_NAMES.map((n) => [n, 0]),
  ) as Record<string, number>;
  const normalized: string[] = [];
  for (const s of pre) {
    const o = normalizeOutcome(s.sector);
    if (o && counts[o] !== undefined) {
      counts[o]++;
      normalized.push(o);
    } else {
      normalized.push("");
    }
  }

  const total = normalized.filter((x) => x !== "").length;
  const frequencies: Record<string, number> = {};
  for (const n of OUTCOME_NAMES) {
    frequencies[n] = total > 0 ? counts[n]! / total : 0;
  }

  // ---- Last outcome (most recent pre-lock spin) ----
  let lastOutcome: string | null = null;
  for (let i = normalized.length - 1; i >= 0; i--) {
    if (normalized[i] !== "") {
      lastOutcome = normalized[i]!;
      break;
    }
  }

  // ---- Transition probabilities: P(next = k | last outcome) ----
  // Build a 2-step transition count from the chronological sequence.
  const transitionCounts: Record<string, Record<string, number>> = {};
  for (const a of OUTCOME_NAMES) {
    transitionCounts[a] = Object.fromEntries(OUTCOME_NAMES.map((b) => [b, 0])) as Record<
      string,
      number
    >;
  }
  for (let i = 1; i < normalized.length; i++) {
    const prev = normalized[i - 1]!;
    const curr = normalized[i]!;
    if (prev !== "" && curr !== "" && transitionCounts[prev] && transitionCounts[prev][curr] !== undefined) {
      transitionCounts[prev][curr]!++;
    }
  }
  const transitionProbabilities: Record<string, number> = {};
  for (const k of OUTCOME_NAMES) {
    if (lastOutcome && transitionCounts[lastOutcome]) {
      const row = transitionCounts[lastOutcome]!;
      const rowTotal = OUTCOME_NAMES.reduce((s, j) => s + row[j]!, 0);
      transitionProbabilities[k] = rowTotal > 0 ? row[k]! / rowTotal : 0;
    } else {
      transitionProbabilities[k] = 0;
    }
  }

  return {
    frequencies,
    lastOutcome,
    transitionProbabilities,
    count: total,
  };
}

// ============================================================
// CONTEXT FEATURE EXTRACTION
// ============================================================

function extractContextFeatures(
  snapshots: PhysicsSnapshot[],
  lockTimestamp: number,
  spinStartTimestamp?: number,
): MLFeatures["context"] {
  // Spin duration: lock - spinStart, or fall back to latest snapshot - earliest.
  let spinDuration = 0;
  if (spinStartTimestamp != null) {
    spinDuration = Math.max(0, (lockTimestamp - spinStartTimestamp) / 1000);
  } else if (snapshots.length > 0) {
    const pre = snapshots.filter((s) => s.timestamp <= lockTimestamp);
    if (pre.length > 0) {
      spinDuration = Math.max(0, (lockTimestamp - pre[0]!.timestamp) / 1000);
    }
  }

  // Time of day (fractional hour, local).
  const date = new Date(lockTimestamp);
  const timeOfDayHour =
    date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;

  // Recent movement rate: in the last 60 seconds before lock, fraction of MOVING frames.
  const cutoff = lockTimestamp - 60_000;
  const recent = snapshots.filter(
    (s) => s.timestamp <= lockTimestamp && s.timestamp >= cutoff,
  );
  const recentMoving = recent.filter((s) => s.movementState === "MOVING").length;
  const recentMovementRate = recent.length > 0 ? recentMoving / recent.length : 0;

  return {
    spinDuration,
    timeOfDayHour,
    lockTimestamp,
    recentMovementRate,
  };
}

// ============================================================
// PUBLIC: extractFeatures
// ============================================================

/**
 * Extract ML features from pre-lock data.
 *
 * @param snapshots Pre-lock video physics snapshots (will be filtered if lockTimestamp given)
 * @param history   Past settled spins (will be filtered if lockTimestamp given)
 * @param lockTimestamp  Lock time (ms epoch). If provided, ALL snapshots/history
 *                       with timestamp/settledAt > lockTimestamp are REMOVED.
 *                       This is the hard leakage guard.
 * @param spinStartTimestamp  Optional spin start (for context.spinDuration).
 *
 * LEAKAGE GUARANTEE:
 *   - When `lockTimestamp` is provided, NO future data can reach the features,
 *     even if the caller accidentally includes it.
 *   - When `lockTimestamp` is omitted, the caller is responsible for pre-filtering
 *     (still supported for backward compatibility, but not recommended).
 */
export function extractFeatures(
  snapshots: PhysicsSnapshot[],
  history: SpinData[],
  lockTimestamp?: number,
  spinStartTimestamp?: number,
): MLFeatures {
  // Use lockTimestamp as a fallback for context when not provided.
  const lock = lockTimestamp ?? Date.now();
  return {
    physics: extractPhysicsFeatures(snapshots, lockTimestamp),
    history: extractHistoryFeatures(history, lockTimestamp),
    context: extractContextFeatures(snapshots, lock, spinStartTimestamp),
  };
}

// ============================================================
// FEATURE VECTORIZATION
// ============================================================

/**
 * Convert structured MLFeatures → flat numeric vector.
 *
 * Order MUST match FEATURE_NAMES exactly.
 * All values are pre-normalized to roughly [-1, 1] or [0, 1] to help GD converge,
 * but additional standardization (mean/std) is applied at training time.
 */
export function featuresToVector(features: MLFeatures): number[] {
  const p = features.physics;
  const h = features.history;
  const c = features.context;

  const v: number[] = new Array(NUM_FEATURES);

  // Physics (18 features, indices 0..17)
  v[0] = p.angle / 360;
  v[1] = clip(p.velocityRaw / HYPERPARAMS.MAX_VELOCITY, 1);
  v[2] = clip(p.velocitySmoothed / HYPERPARAMS.MAX_VELOCITY, 1);
  v[3] = clip(p.velocityAbs / HYPERPARAMS.MAX_VELOCITY, 1);
  v[4] = clip(p.acceleration / HYPERPARAMS.MAX_ACCEL, 1);
  v[5] = clip(p.deceleration / HYPERPARAMS.MAX_ACCEL, 1);
  v[6] = clip(p.movementDuration / 60, 1);
  v[7] = clip(p.spinDuration / 120, 1);
  v[8] = p.predictedStopAngle / 360;
  v[9] = p.predictedStopSector / 53;
  v[10] = clip(p.angularUncertainty / 180, 1);
  v[11] = clip(p.trackingConfidence, 1);
  v[12] = clip(p.signalAgreement, 1);
  v[13] = p.calibrationStable ? 1 : 0;
  v[14] = p.direction === 1 ? 0 : 1;
  v[15] = clip(p.movingFrameRatio, 1);
  v[16] = clip(p.trackingFrameRatio, 1);
  v[17] = clip(p.distanceToNearestBonus / 27, 1);

  // History frequencies (8 features, indices 18..25)
  v[18] = h.frequencies["1"] ?? 0;
  v[19] = h.frequencies["2"] ?? 0;
  v[20] = h.frequencies["5"] ?? 0;
  v[21] = h.frequencies["10"] ?? 0;
  v[22] = h.frequencies["PACHINKO"] ?? 0;
  v[23] = h.frequencies["COIN FLIP"] ?? 0;
  v[24] = h.frequencies["CASH HUNT"] ?? 0;
  v[25] = h.frequencies["CRAZY TIME"] ?? 0;

  // History last-outcome one-hot (8 features, indices 26..33)
  const lastOutcome = h.lastOutcome;
  v[26] = lastOutcome === "1" ? 1 : 0;
  v[27] = lastOutcome === "2" ? 1 : 0;
  v[28] = lastOutcome === "5" ? 1 : 0;
  v[29] = lastOutcome === "10" ? 1 : 0;
  v[30] = lastOutcome === "PACHINKO" ? 1 : 0;
  v[31] = lastOutcome === "COIN FLIP" ? 1 : 0;
  v[32] = lastOutcome === "CASH HUNT" ? 1 : 0;
  v[33] = lastOutcome === "CRAZY TIME" ? 1 : 0;

  // History count (log scaled)
  v[34] = Math.log(1 + h.count) / 10;

  // Transition probabilities (8 features, indices 35..42)
  v[35] = h.transitionProbabilities["1"] ?? 0;
  v[36] = h.transitionProbabilities["2"] ?? 0;
  v[37] = h.transitionProbabilities["5"] ?? 0;
  v[38] = h.transitionProbabilities["10"] ?? 0;
  v[39] = h.transitionProbabilities["PACHINKO"] ?? 0;
  v[40] = h.transitionProbabilities["COIN FLIP"] ?? 0;
  v[41] = h.transitionProbabilities["CASH HUNT"] ?? 0;
  v[42] = h.transitionProbabilities["CRAZY TIME"] ?? 0;

  // Context (4 features, indices 43..46)
  v[43] = clip(c.spinDuration / 120, 1);
  const hour = c.timeOfDayHour;
  v[44] = Math.sin((2 * Math.PI * hour) / 24);
  v[45] = Math.cos((2 * Math.PI * hour) / 24);
  v[46] = clip(c.recentMovementRate, 1);

  return v;
}

// ============================================================
// LOGISTIC REGRESSION (pure TypeScript, no external deps)
// ============================================================

/**
 * Binary logistic regression classifier.
 * Trains via batch gradient descent with L2 regularization.
 */
class BinaryLogisticRegression {
  weights: number[];
  bias: number;

  constructor(numFeatures: number) {
    this.weights = new Array(numFeatures).fill(0);
    this.bias = 0;
  }

  /** Raw linear score z = w·x + b. */
  score(x: number[]): number {
    let z = this.bias;
    const w = this.weights;
    for (let i = 0; i < x.length; i++) {
      z += w[i]! * x[i]!;
    }
    return z;
  }

  /** Predicted probability P(y=1 | x). */
  predictProb(x: number[]): number {
    return sigmoid(this.score(x));
  }

  /**
   * Train one classifier with batch gradient descent + L2 regularization.
   *
   * Loss = -(1/n) Σ [y log(p) + (1-y) log(1-p)] + (λ/2) ||w||²
   * Gradient_w = (1/n) Σ (p_i - y_i) x_i + λ w
   * Gradient_b = (1/n) Σ (p_i - y_i)
   */
  train(
    X: number[][],
    y: number[],
    learningRate: number,
    lambda: number,
    epochs: number,
  ): void {
    const n = X.length;
    if (n === 0) return;
    const m = this.weights.length;

    for (let epoch = 0; epoch < epochs; epoch++) {
      // Accumulate gradients.
      const gradW = new Array(m).fill(0);
      let gradB = 0;
      for (let i = 0; i < n; i++) {
        const xi = X[i]!;
        const p = this.predictProb(xi);
        const err = p - y[i]!;
        const w = this.weights;
        for (let j = 0; j < m; j++) {
          gradW[j]! += err * xi[j]!;
        }
        gradB += err;
      }
      // Apply L2 reg to weight gradient and update.
      for (let j = 0; j < m; j++) {
        const gj = gradW[j]! / n + lambda * this.weights[j]!;
        this.weights[j] = this.weights[j]! - learningRate * gj;
      }
      this.bias -= learningRate * (gradB / n);
    }
  }
}

// ============================================================
// STANDARDIZATION (z-scoring)
// ============================================================

interface Standardizer {
  mean: number[];
  std: number[];
}

/** Compute mean/std per feature from a matrix X (rows = samples). */
function fitStandardizer(X: number[][]): Standardizer {
  const n = X.length;
  const m = X[0]?.length ?? NUM_FEATURES;
  const mean = new Array(m).fill(0);
  const std = new Array(m).fill(0);

  if (n === 0) return { mean, std };

  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i]![j]!;
    mean[j] = s / n;
  }
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const d = X[i]![j]! - mean[j]!;
      s += d * d;
    }
    std[j] = Math.sqrt(s / Math.max(1, n - 1));
  }
  return { mean, std };
}

/** Apply z-score normalization: x' = (x - mean) / (std + eps). */
function applyStandardizer(x: number[], std: Standardizer): number[] {
  const out = new Array(x.length);
  for (let j = 0; j < x.length; j++) {
    out[j] = (x[j]! - std.mean[j]!) / (std.std[j]! + HYPERPARAMS.STANDARDIZATION_EPS);
  }
  return out;
}

// ============================================================
// METRICS
// ============================================================

/** Binary cross-entropy / log loss for one true label y ∈ {0,1} and predicted p. */
function binaryLogLoss(y: number, p: number): number {
  const pp = Math.max(HYPERPARAMS.PROB_EPS, Math.min(1 - HYPERPARAMS.PROB_EPS, p));
  return -y * Math.log(pp) - (1 - y) * Math.log(1 - pp);
}

/** Average multi-class log loss across 8 binary classifiers. */
function multiClassLogLoss(
  classifiers: BinaryLogisticRegression[],
  X: number[][],
  Y: number[][],
): number {
  if (X.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < X.length; i++) {
    let rowLoss = 0;
    for (let k = 0; k < classifiers.length; k++) {
      rowLoss += binaryLogLoss(Y[i]![k]!, classifiers[k]!.predictProb(X[i]!));
    }
    total += rowLoss / classifiers.length;
  }
  return total / X.length;
}

/**
 * Multi-class prediction: pick the outcome with highest one-vs-rest probability.
 * Returns indices into OUTCOME_NAMES.
 */
function predictTop1(
  classifiers: BinaryLogisticRegression[],
  x: number[],
): number {
  let bestIdx = 0;
  let bestP = -Infinity;
  for (let k = 0; k < classifiers.length; k++) {
    const p = classifiers[k]!.predictProb(x);
    if (p > bestP) {
      bestP = p;
      bestIdx = k;
    }
  }
  return bestIdx;
}

// ============================================================
// PUBLIC: trainMLModel
// ============================================================

/**
 * Train the ML model on historical (snapshots, history, outcome) samples.
 *
 * CRITICAL RULES:
 *   - NEVER shuffles samples. They are sorted by lockTimestamp ascending.
 *   - First 70% (by time) → training. Last 30% → validation.
 *   - Standardization (mean/std) is computed from TRAINING data ONLY, then
 *     applied to both training and validation sets (prevents leakage).
 *   - 8 binary one-vs-rest classifiers are trained independently.
 *   - If insufficient data (MIN_SAMPLES or MIN_POSITIVES_PER_CLASS), returns
 *     an untrained model. predictML() will then return uniform probabilities.
 *
 * Side effect: stores the trained model as a module-level singleton
 * (accessible via predictML() and getMLModel()).
 *
 * @returns Training statistics.
 */
export function trainMLModel(spinData: MLSpinSample[]): MLModelStats {
  // ---- Validate input ----
  if (!Array.isArray(spinData) || spinData.length < HYPERPARAMS.MIN_SAMPLES) {
    const stats = fallbackStats(
      spinData?.length ?? 0,
      `Insufficient samples (${spinData?.length ?? 0} < ${HYPERPARAMS.MIN_SAMPLES})`,
    );
    trainedModel = { ...emptyModel(), stats };
    return stats;
  }

  // ---- Sort by lockTimestamp (chronological). NEVER shuffle. ----
  const sorted = spinData
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.lockTimestamp - b.s.lockTimestamp)
    .map((x) => x.s);

  // ---- Extract features for each sample ----
  // Each sample's features use only its own (snapshots, history) pre-lock.
  // (The caller already supplies pre-lock data; we re-filter defensively.)
  const featureVectors: number[][] = [];
  const labels: string[] = [];
  for (const sample of sorted) {
    const feats = extractFeatures(
      sample.snapshots,
      sample.history,
      sample.lockTimestamp,
      sample.spinStartTimestamp,
    );
    featureVectors.push(featuresToVector(feats));
    const norm = normalizeOutcome(sample.outcome);
    if (!norm) continue; // skip unknown outcomes
    labels.push(norm);
  }

  if (featureVectors.length < HYPERPARAMS.MIN_SAMPLES) {
    const stats = fallbackStats(
      featureVectors.length,
      "Too few samples with valid outcomes",
    );
    trainedModel = { ...emptyModel(), stats };
    return stats;
  }

  // ---- Chronological 70/30 split (NEVER shuffled) ----
  const splitIdx = Math.floor(featureVectors.length * HYPERPARAMS.TRAIN_FRACTION);
  const XTrainRaw = featureVectors.slice(0, splitIdx);
  const yTrain = labels.slice(0, splitIdx);
  const XValRaw = featureVectors.slice(splitIdx);
  const yVal = labels.slice(splitIdx);

  if (XTrainRaw.length === 0) {
    const stats = fallbackStats(featureVectors.length, "Empty training set after split");
    trainedModel = { ...emptyModel(), stats };
    return stats;
  }

  // ---- Per-class positive count check ----
  const trainCountPerClass: Record<string, number> = Object.fromEntries(
    OUTCOME_NAMES.map((n) => [n, 0]),
  ) as Record<string, number>;
  for (const y of yTrain) {
    if (trainCountPerClass[y] !== undefined) trainCountPerClass[y]!++;
  }
  const insufficientClasses = OUTCOME_NAMES.filter(
    (n) => trainCountPerClass[n]! < HYPERPARAMS.MIN_POSITIVES_PER_CLASS,
  );

  if (insufficientClasses.length === OUTCOME_NAMES.length) {
    const stats = fallbackStats(
      featureVectors.length,
      `No class has >= ${HYPERPARAMS.MIN_POSITIVES_PER_CLASS} positive training examples`,
    );
    trainedModel = { ...emptyModel(), stats };
    return stats;
  }
  // Note: we proceed even if SOME classes are deficient — those classifiers
  // will be near-zero and the model relies on the others. Predictions for
  // deficient classes will be near base-rate.

  // ---- Fit standardizer on TRAIN ONLY ----
  const standardizer = fitStandardizer(XTrainRaw);
  const XTrain = XTrainRaw.map((x) => applyStandardizer(x, standardizer));
  const XVal = XValRaw.length > 0 ? XValRaw.map((x) => applyStandardizer(x, standardizer)) : [];

  // ---- Train 8 one-vs-rest binary classifiers ----
  const classifiers: BinaryLogisticRegression[] = [];
  for (let k = 0; k < OUTCOME_NAMES.length; k++) {
    const cls = new BinaryLogisticRegression(NUM_FEATURES);
    const yk = yTrain.map((y) => (y === OUTCOME_NAMES[k] ? 1 : 0));
    cls.train(
      XTrain,
      yk,
      HYPERPARAMS.LEARNING_RATE,
      HYPERPARAMS.L2_LAMBDA,
      HYPERPARAMS.EPOCHS,
    );
    classifiers.push(cls);
  }

  // ---- Evaluate on training set ----
  const YTrain: number[][] = XTrain.map((_, i) =>
    OUTCOME_NAMES.map((n) => (yTrain[i] === n ? 1 : 0)),
  );
  const YVal: number[][] = XVal.map((_, i) =>
    OUTCOME_NAMES.map((n) => (yVal[i] === n ? 1 : 0)),
  );

  const trainLogLoss = multiClassLogLoss(classifiers, XTrain, YTrain);
  const valLogLoss = XVal.length > 0 ? multiClassLogLoss(classifiers, XVal, YVal) : 0;

  // ---- Top-1 accuracy + per-class recall/precision (validation) ----
  let trainCorrect = 0;
  for (let i = 0; i < XTrain.length; i++) {
    if (OUTCOME_NAMES[predictTop1(classifiers, XTrain[i]!)] === yTrain[i]) trainCorrect++;
  }
  const trainAccuracy = XTrain.length > 0 ? trainCorrect / XTrain.length : 0;

  let valCorrect = 0;
  const perOutcomeTruePositive: Record<string, number> = Object.fromEntries(
    OUTCOME_NAMES.map((n) => [n, 0]),
  ) as Record<string, number>;
  const perOutcomeFalsePositive: Record<string, number> = Object.fromEntries(
    OUTCOME_NAMES.map((n) => [n, 0]),
  ) as Record<string, number>;
  const perOutcomeActualCount: Record<string, number> = Object.fromEntries(
    OUTCOME_NAMES.map((n) => [n, 0]),
  ) as Record<string, number>;
  const perOutcomePredCount: Record<string, number> = Object.fromEntries(
    OUTCOME_NAMES.map((n) => [n, 0]),
  ) as Record<string, number>;

  for (let i = 0; i < XVal.length; i++) {
    const predIdx = predictTop1(classifiers, XVal[i]!);
    const predName = OUTCOME_NAMES[predIdx]!;
    const trueName = yVal[i]!;
    perOutcomeActualCount[trueName]!++;
    perOutcomePredCount[predName]!++;
    if (predName === trueName) {
      valCorrect++;
      perOutcomeTruePositive[trueName]!++;
    } else {
      perOutcomeFalsePositive[predName]!++;
    }
  }
  const validationAccuracy = XVal.length > 0 ? valCorrect / XVal.length : 0;

  const perOutcomeValidationRecall: Record<string, number> = {};
  const perOutcomeValidationPrecision: Record<string, number> = {};
  for (const n of OUTCOME_NAMES) {
    const tp = perOutcomeTruePositive[n]!;
    const fp = perOutcomeFalsePositive[n]!;
    const actual = perOutcomeActualCount[n]!;
    const pred = perOutcomePredCount[n]!;
    perOutcomeValidationRecall[n] = actual > 0 ? tp / actual : 0;
    perOutcomeValidationPrecision[n] = pred > 0 ? tp / pred : 0;
  }

  // ---- Build final model ----
  const model: MLModel = {
    modelVersion: ML_MODEL_VERSION,
    trained: true,
    outcomeNames: OUTCOME_NAMES,
    featureNames: FEATURE_NAMES,
    mean: standardizer.mean,
    std: standardizer.std,
    classifiers: classifiers.map((c) => ({ weights: c.weights, bias: c.bias })),
    stats: {
      trainSamples: XTrain.length,
      validationSamples: XVal.length,
      totalSamples: featureVectors.length,
      trainAccuracy,
      validationAccuracy,
      trainLogLoss,
      validationLogLoss: valLogLoss,
      perOutcomeValidationRecall,
      perOutcomeValidationPrecision,
      featureNames: FEATURE_NAMES,
      outcomeNames: OUTCOME_NAMES,
      trained: true,
      reason: `Trained ${classifiers.length} one-vs-rest classifiers on ${XTrain.length} samples (val: ${XVal.length}); chronological 70/30 split.`,
      hyperparameters: HYPERPARAMS,
      modelVersion: ML_MODEL_VERSION,
    },
  };

  trainedModel = model;
  return model.stats;
}

// ============================================================
// PUBLIC: predictML
// ============================================================

/**
 * Predict outcome probabilities from ML features.
 *
 * Uses the singleton model trained by trainMLModel().
 * If the model is untrained or insufficient data was available,
 * returns UNIFORM probabilities (1/8 each) with isFallback = true.
 *
 * @param features  MLFeatures produced by extractFeatures()
 * @returns         MLPrediction with 8 probabilities summing to 1
 */
export function predictML(features: MLFeatures): MLPrediction {
  const model = trainedModel;
  if (!model || !model.trained) {
    return uniformPrediction(
      ML_MODEL_VERSION,
      "Model not trained — returning uniform probabilities",
    );
  }
  return predictWithModel(model, features);
}

/**
 * Stateless prediction: use a specific model (useful for tests / walk-forward).
 */
export function predictWithModel(model: MLModel, features: MLFeatures): MLPrediction {
  if (!model || !model.trained) {
    return uniformPrediction(
      model?.modelVersion ?? ML_MODEL_VERSION,
      "Model not trained — returning uniform probabilities",
    );
  }

  // Vectorize + standardize using the model's stored mean/std (from training set).
  const rawVec = featuresToVector(features);
  const stdVec = new Array(rawVec.length);
  for (let j = 0; j < rawVec.length; j++) {
    stdVec[j] = (rawVec[j]! - model.mean[j]!) / (model.std[j]! + HYPERPARAMS.STANDARDIZATION_EPS);
  }

  // Per-class one-vs-rest sigmoid scores.
  const scores: number[] = new Array(model.classifiers.length);
  for (let k = 0; k < model.classifiers.length; k++) {
    const cls = model.classifiers[k]!;
    let z = cls.bias;
    const w = cls.weights;
    for (let j = 0; j < stdVec.length; j++) {
      z += w[j]! * stdVec[j]!;
    }
    scores[k] = sigmoid(z);
  }

  // Normalize the 8 independent sigmoids to sum to 1.
  // (One-vs-rest probabilities do not naturally sum to 1.)
  let total = 0;
  for (const s of scores) total += s;
  const probabilities: Record<string, number> = {};
  let topOutcome = model.outcomeNames[0]!;
  let topProbability = -Infinity;
  for (let k = 0; k < model.outcomeNames.length; k++) {
    const name = model.outcomeNames[k]!;
    const p = total > 0 ? scores[k]! / total : 1 / model.outcomeNames.length;
    probabilities[name] = p;
    if (p > topProbability) {
      topProbability = p;
      topOutcome = name;
    }
  }

  return {
    probabilities,
    topOutcome,
    topProbability,
    modelVersion: model.modelVersion,
    isFallback: false,
    reason: `ML prediction: top=${topOutcome} (${(topProbability * 100).toFixed(1)}%)`,
  };
}

// ============================================================
// FALLBACK HELPERS
// ============================================================

/** Build a uniform 1/8 prediction (used when model is untrained). */
export function uniformPrediction(
  modelVersion: string = ML_MODEL_VERSION,
  reason: string = "Insufficient training data — uniform fallback",
): MLPrediction {
  const p = 1 / OUTCOME_NAMES.length;
  const probabilities: Record<string, number> = {};
  for (const n of OUTCOME_NAMES) probabilities[n] = p;
  return {
    probabilities,
    topOutcome: OUTCOME_NAMES[0]!,
    topProbability: p,
    modelVersion,
    isFallback: true,
    reason,
  };
}

/** Build an empty (untrained) model — used when training falls back. */
function emptyModel(): Omit<MLModel, "stats"> {
  return {
    modelVersion: ML_MODEL_VERSION,
    trained: false,
    outcomeNames: OUTCOME_NAMES,
    featureNames: FEATURE_NAMES,
    mean: new Array(NUM_FEATURES).fill(0),
    std: new Array(NUM_FEATURES).fill(1),
    classifiers: OUTCOME_NAMES.map(() => ({
      weights: new Array(NUM_FEATURES).fill(0),
      bias: 0,
    })),
  };
}

/** Build fallback stats — used when training cannot proceed. */
function fallbackStats(totalSamples: number, reason: string): MLModelStats {
  return {
    trainSamples: 0,
    validationSamples: 0,
    totalSamples,
    trainAccuracy: 0,
    validationAccuracy: 0,
    trainLogLoss: 0,
    validationLogLoss: 0,
    perOutcomeValidationRecall: Object.fromEntries(OUTCOME_NAMES.map((n) => [n, 0])) as Record<
      string,
      number
    >,
    perOutcomeValidationPrecision: Object.fromEntries(OUTCOME_NAMES.map((n) => [n, 0])) as Record<
      string,
      number
    >,
    featureNames: FEATURE_NAMES,
    outcomeNames: OUTCOME_NAMES,
    trained: false,
    reason,
    hyperparameters: HYPERPARAMS,
    modelVersion: ML_MODEL_VERSION,
  };
}

// ============================================================
// LEAKAGE ASSERTION
// ============================================================

/**
 * Verify that a feature vector was built only from pre-lock data.
 * Returns true if the assert passed (i.e., no future timestamps found).
 *
 * This is a STRUCTURAL check on the input arrays (snapshots + history).
 * If `lockTimestamp` is provided and any snapshot.timestamp > lockTimestamp
 * OR any history.settledAt parses to a time > lockTimestamp, this returns false.
 */
export function assertNoLeakage(
  snapshots: PhysicsSnapshot[],
  history: SpinData[],
  lockTimestamp: number,
): { passed: boolean; violations: number; details: string } {
  let violations = 0;
  let firstViolationTs = 0;

  for (const s of snapshots) {
    if (s.timestamp > lockTimestamp) {
      violations++;
      if (firstViolationTs === 0) firstViolationTs = s.timestamp;
    }
  }

  for (const h of history) {
    const t = parseTimestamp(h.settledAt);
    if (!Number.isNaN(t) && t > lockTimestamp) {
      violations++;
      if (firstViolationTs === 0) firstViolationTs = t;
    }
  }

  return {
    passed: violations === 0,
    violations,
    details:
      violations === 0
        ? "PASS — no future timestamps found"
        : `FAIL — ${violations} future timestamps found (first: ${new Date(firstViolationTs).toISOString()})`,
  };
}
