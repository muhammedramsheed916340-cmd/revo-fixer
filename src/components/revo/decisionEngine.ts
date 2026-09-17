/**
 * UNIFIED AI DECISION ENGINE — Crazy Time Prediction
 * ====================================================
 *
 * SINGLE SOURCE OF TRUTH.
 *
 * Everything the UI shows — prediction chips, NOT IN PREDICTION set,
 * Decision Engine panel, confidence, risk level, performance dashboard,
 * and history metadata — is derived from this one engine.
 *
 * CORE PIPELINE (runs on EVERY live result):
 *
 *   LIVE RESULT
 *     → VERIFY HIT/MISS
 *     → UPDATE HISTORY
 *     → ANALYZE ACTIVE SIGNALS
 *     → ANALYZE EXCLUDED OUTCOMES
 *     → COMPARE RECENT + LONG-TERM PERFORMANCE
 *     → DETECT PATTERN SHIFT
 *     → RCA IF MISS
 *     → RECALIBRATE
 *     → SELECT STRONGEST EVIDENCE-BASED SIGNAL
 *     → UPDATE PREDICTION IN THE SAME SPOT
 *
 * HARD RULES:
 *   - HIT  = Actual Result ∈ Active Prediction Outcomes
 *   - MISS = Actual Result ∉ Active Prediction Outcomes
 *   - NOT IN PREDICTION is NEVER treated as a separate bet signal.
 *   - If actual result repeatedly falls in the excluded set → MISS → RCA.
 *   - No random switching, no opposite-result chasing,
 *     no previous-result chasing, no forced prediction, no retrospective fix.
 *   - "STRONG" only when real verified data + sample size supports it.
 *   - No profit guarantee — only statistical reliability estimate.
 *   - Sample size confidence is ALWAYS included (Wilson lower bound).
 *   - Prediction is STABLE until the next live result arrives.
 */

// ============================================================
// GAME MODEL (shared with RevoGame.tsx)
// ============================================================

import type { SpinData } from "./aiStats";

/** Map a CasinoScores spin sector name (from aiStats) to our engine Game name.
 *  aiStats uses "CoinFlip", "Pachinko", etc. The engine uses "COIN FLIP", "PACHINKO". */
const SPIN_TO_GAME_NAME: Record<string, string> = {
  "1": "1",
  "2": "2",
  "5": "5",
  "10": "10",
  CoinFlip: "COIN FLIP",
  Pachinko: "PACHINKO",
  CashHunt: "CASH HUNT",
  CrazyTime: "CRAZY TIME",
  CrazyBonus: "CRAZY TIME",
};
export interface GameModel {
  name: string;
  imageKey: string;
  confidenceRange: [number, number];
  isBonus: boolean;
}

export const GAMES: GameModel[] = [
  { name: "1", imageKey: "1", confidenceRange: [85, 95], isBonus: false },
  { name: "2", imageKey: "2", confidenceRange: [80, 92], isBonus: false },
  { name: "5", imageKey: "5", confidenceRange: [75, 90], isBonus: false },
  { name: "10", imageKey: "10", confidenceRange: [70, 88], isBonus: false },
  { name: "PACHINKO", imageKey: "PACHINKO", confidenceRange: [60, 85], isBonus: true },
  { name: "COIN FLIP", imageKey: "COIN FLIP", confidenceRange: [68, 89], isBonus: true },
  { name: "CASH HUNT", imageKey: "CASH HUNT", confidenceRange: [65, 87], isBonus: true },
  { name: "CRAZY TIME", imageKey: "CRAZY TIME", confidenceRange: [55, 82], isBonus: true },
];

// Base selection weights (from the original Revo Fixer app).
export const WEIGHTS = [0.22, 0.42, 0.6, 0.75, 0.85, 0.92, 0.97, 1.0];

export const SIGNAL_COUNT = 4;

// ============================================================
// 54-SEGMENT WHEEL BASE-PROBABILITY MODEL (Crazy Time)
// ============================================================
// The Crazy Time wheel has 54 segments total. Each outcome's BASE PRIOR is
// its segment count / 54. This is the mathematical baseline — NEVER used
// directly as a live prediction, only as the prior for evidence combination.
//
//   1          = 21 segments = 38.89%
//   2          = 13 segments = 24.07%
//   5          =  7 segments = 12.96%
//   10         =  4 segments =  7.41%
//   COIN FLIP  =  4 segments =  7.41%
//   CASH HUNT  =  2 segments =  3.70%
//   PACHINKO   =  2 segments =  3.70%
//   CRAZY TIME =  1 segment  =  1.85%
//   TOTAL      = 54 segments = 100.00%
//
// Theoretical coverage of top-4 by base prob (1+2+5+10) = 83.33%.
// This is WHEEL COVERAGE only — NOT guaranteed prediction accuracy.
// ============================================================

export const WHEEL_TOTAL_SEGMENTS = 54;

export const WHEEL_SEGMENTS: Record<string, number> = {
  "1": 21,
  "2": 13,
  "5": 7,
  "10": 4,
  "COIN FLIP": 4,
  "CASH HUNT": 2,
  "PACHINKO": 2,
  "CRAZY TIME": 1,
};

// Theoretical probabilities for each Crazy Time segment (54-segment wheel).
export const THEORETICAL: Record<string, number> = {
  "1": 0.3889, "2": 0.2407, "5": 0.1296, "10": 0.0741,
  "COIN FLIP": 0.0741, "PACHINKO": 0.0370, "CASH HUNT": 0.0370, "CRAZY TIME": 0.0185,
};

export const BONUS_NAMES = ["PACHINKO", "COIN FLIP", "CASH HUNT", "CRAZY TIME"];

// ============================================================
// RARE-OUTCOME EVIDENCE RELIABILITY LAYER (EXPERIMENTAL)
// ============================================================
// Frozen baseline: k=30, evidence 50% / prior 50%, live/user 70/30,
// 70-combination optimizer ACTIVE, persistence penalty ACTIVE.
//
// ROOT CAUSE (from 50-round fresh k=30 validation, 39/50 = 78% HIT):
// 7 of 11 misses involved a rare outcome (PACHINKO) DISPLACING a
// higher-prior number outcome. PACHINKO appeared 3× in 50 rounds
// (theoretical 3.7%, expected ~1.85). That small sample generated a
// +39% relative deviation which — via evidenceScore = 1 + dev — was
// enough to overcome the 24% prior advantage of "2". PACHINKO was
// included in Top-4 36/50 times but only 3 actual PACHINKO rounds
// occurred → 33 wasted inclusions, 7 of which directly caused misses.
//
// FIX (do NOT ban PACHINKO, do NOT force [1,2,5,10], do NOT hardcode
// any outcome, do NOT create a permanent slot):
//
// Add a continuous, generic, sample-size RELIABILITY factor that
// dampens the POSITIVE deviation of ANY outcome whose evidence rests
// on a small number of independent observations. Negative deviations
// (outcome appeared less than expected) pass through unchanged so we
// never inflate a rare outcome that hasn't appeared.
//
//   reliability = effectiveSampleSize / (effectiveSampleSize + RELIABILITY_K)
//
// where effectiveSampleSize = combined observed count for this outcome
// (user rounds + live spins). The function is:
//   - continuous (no hard cutoff)        ✓
//   - monotonic increasing in evidence    ✓
//   - converges to 1 as evidence grows    ✓
//   - generic — applies to ALL outcomes  ✓ (rare ones naturally have
//     fewer observations → lower reliability, no hardcoding)
//
// RELIABILITY_K = 10. Calibration:
//   count=3  → r=0.23  (PACHINKO +39% → +9% — no longer displaces "2")
//   count=5  → r=0.33  (PACHINKO +106% → +35% — can still displace when
//                       deviation is genuinely large)
//   count=8  → r=0.44  (PACHINKO +200% → +89% — strong signal passes)
//   count=20 → r=0.67  (common outcomes barely affected — their
//                       deviations are small anyway)
//
// IMPORTANT PRINCIPLE:
//   Evidence answers "Is there enough independent/repeated evidence to
//   justify displacing a higher-prior outcome?" — NOT "Has this rare
//   outcome appeared recently?". No simple recency chasing.
export type EngineMode = "baseline" | "experimental";

export const RELIABILITY_K = 10;

export const EXPERIMENTAL_CONFIG = {
  // Sample-size reliability softness constant.
  // reliability = effectiveSampleSize / (effectiveSampleSize + RELIABILITY_K)
  reliabilityK: RELIABILITY_K,
  // Reliability is applied ONLY to the POSITIVE portion of the deviation.
  // Negative deviations (under-appearing outcomes) pass through unchanged
  // so we never inflate a rare outcome that has not appeared.
  applyToPositiveDeviationOnly: true,
  // Frozen baseline weights (UNCHANGED — for A/B parity):
  shrinkageK: 30,
  evidenceWeight: 0.50,
  priorWeight: 0.50,
} as const;

// ============================================================
// C1–C8 EXPERIMENTAL FEATURE FLAGS
// ============================================================
// All default OFF. When ALL flags are OFF, the engine produces
// BIT-FOR-BIT IDENTICAL output to the pre-C1-C7 baseline (provable
// by the flag-OFF equivalence test: scores, selection order, and the
// exact Top-4 set are unchanged). Each flag activates ONE
// architectural change (C1–C8) independently so they can be A/B
// tested in isolation. None are auto-enabled in the live path —
// they must be explicitly turned on (and Shadow A/B stays OFF until
// implementation tests pass).
//
//   C1  calibrated probability channel   (separate raw/prior/calibrated/selection)
//   C2  generic continuous reliability   (decoupled from `mode`; no per-outcome hardcode)
//   C3  uncertainty-aware shrinkage      (small samples can't jump; preserves gates)
//   C4  real 70-combination optimizer    (coverage + uncertainty + reliability + diversity)
//   C5  de-scope harmful features        (kill raw-recent overwrites; reliability-gate persistence)
//   C6  RCA instrumentation              (per-locked-Top-4 record for post-MISS reconstruction)
//   C7  frozen walk-forward validation   (build path ONLY; no live effect; no success claim)
//   C8  Bayesian credible lower-bound    (coverage uses pLB instead of posterior; generic)
//   C9  recency-exclude-last             (signal recency window excludes just-arrived actual)
export interface FeatureFlags {
  c1_calibratedChannel: boolean;
  c2_genericReliability: boolean;
  c3_uncertaintyShrinkage: boolean;
  c4_realOptimizer: boolean;
  c5_deScopeHarmful: boolean;
  c6_rcaInstrumentation: boolean;
  c7_frozenWalkForward: boolean;
  c8_credibleLowerBound: boolean;
  c9_recencyExcludeLast: boolean;
}

/** All flags OFF — the guaranteed bit-for-bit baseline. */
export const ALL_FLAGS_OFF: FeatureFlags = {
  c1_calibratedChannel: false,
  c2_genericReliability: false,
  c3_uncertaintyShrinkage: false,
  c4_realOptimizer: false,
  c5_deScopeHarmful: false,
  c6_rcaInstrumentation: false,
  c7_frozenWalkForward: false,
  c8_credibleLowerBound: false,
  c9_recencyExcludeLast: false,
};

/** Engine model version stamp (for C6 RCA records + validation provenance). */
export const MODEL_VERSION = "revo-engine-v2-C1C9";

// ============================================================
// C6 — LOCKED RCA RECORD (per-locked-Top-4 instrumentation)
// ============================================================
// One record per locked Top-4 prediction. Captures the full scoring
// state so ANY MISS can be reconstructed exactly: all 8 outcome scores,
// calibrated probabilities, uncertainty/reliability, the winning 4,
// the excluded #5, why each outcome entered/lost, the active flags,
// and the model version. The actual+hit are NOT known at lock time —
// they are reconciled later by the shadow / walk-forward ledger.
export interface LockedOutcomeEntry {
  name: string;
  rank: number;                  // 1..8 by selectionScore (1 = strongest)
  selected: boolean;             // true if in the winning Top-4
  rawScore: number;              // the frozen baseline blended score
  rawEvidenceScore?: number;     // C1: evidence term (1 + reliableDeviation)
  priorProbability?: number;     // C1: prior used (theo or livePrior)
  calibratedProbability?: number;     // legacy normalized score share (rawScore/ΣrawScore)
  calibratedProbabilityPosterior?: number; // C1: true Bayesian posterior probability
  reliability?: number;           // C2: 0..1 sample-size reliability
  uncertainty?: number;           // C3: 0..1 (1 = fully prior-driven, 0 = data-driven)
  selectionScore?: number;        // C1: the score actually used for selection
  effectiveSampleSize?: number;   // C2/C8: independent observations for this outcome (nEff)
  lowerBoundProbability?: number; // C8: 95% credible lower bound on posterior (pLB)
  reason: string;                 // why this outcome was selected or excluded
}
export interface LockedRcaRecord {
  modelVersion: string;
  flags: FeatureFlags;
  engineMode: EngineMode;
  timestamp: number;
  winningCombination: string[];  // 4 selected names (strongest → weakest)
  excludedFifth: string;          // highest-ranked excluded outcome (#5)
  allOutcomes: LockedOutcomeEntry[]; // all 8, ranked
  optimizerNote: string;         // C4: why the winning combo won
}

// ============================================================
// ROUND MODEL
// ============================================================
export interface RoundResult {
  prediction: { game: GameModel; confidence: number; time: number }[];
  actualResult: GameModel;
  hit: boolean;
  time: number;
  confidence: number;        // avg confidence of the active prediction
  recalibrated: boolean;      // was this prediction produced by recalibration?
  calibrationNote?: string;
}

// ============================================================
// INTERNAL CANDIDATE SCORING
// ============================================================
export interface CandidateScore {
  game: GameModel;
  rawScore: number;           // unnormalized weighted score
  normalizedScore: number;    // 0..1 share of total
  signals: string[];          // which signals fired
  sampleSize: number;         // how often this game appeared as a prediction
  signalHitRate: number;      // hit-rate WHEN this game was predicted (raw)
  wilsonLower: number;        // Wilson 95% lower bound of signalHitRate
  longTermFreq: number;       // historical frequency of actual results
  recentFreq: number;         // recent frequency (last 10 actuals)
  trend: number;              // recentFreq - longTermFreq
  currentGap: number;         // rounds since last actual hit
  avgGap: number;
  isOverdue: boolean;
  isHot: boolean;
  isCold: boolean;
  rank?: number;              // 1-based rank in next signal (1..4)
  label: string;              // human-readable rank label
  // ===== NEW: Wheel base-probability model breakdown =====
  basePrior: number;          // 54-segment theoretical probability (0..1)
  segmentCount: number;       // number of wheel segments (e.g. "1" = 21)
  liveObservedRate: number;   // observed frequency in live data (0..1)
  modelAdjustment: number;    // multiplicative adjustment from base prior (e.g. 1.15 = +15%)
  finalAIScore: number;        // final combined AI score (= rawScore)
  selectionReason: string;    // specific reason this outcome was selected (or not)
  // ===== NEW: Full debug fields for QA verification =====
  observedFrequency: number;  // observed frequency in live data (0..1)
  blendedFrequency: number;   // blended long-term + recent frequency (0..1)
  relativeDeviation: number;  // RAW (unstabilized) deviation
  evidenceScorePreMultiplier: number; // 1 + cappedDeviation (stabilized relative evidence)
  sampleN: number;            // total sample size (user rounds + live spins)
  observedCount: number;      // combined observed count for this outcome
  smoothedFrequency: number;  // Laplace-smoothed frequency (0..1)
  rawDeviation: number;       // raw (unstabilized) relative deviation
  stabilizedDeviation: number; // sample-size-stabilized relative deviation
  calibratedProbability?: number; // normalized probability (sum to 1)
  logEvidence?: number;       // log(posterior / prior) — log-scaled evidence
  // ===== EXPERIMENTAL: rare-outcome evidence reliability layer =====
  engineMode?: EngineMode;      // "baseline" | "experimental"
  effectiveSampleSize?: number; // combined observed count (user + live) for this outcome
  reliability?: number;        // sample-size reliability factor (0..1), continuous
  reliableDeviation?: number;  // cappedDeviation dampened by reliability (pos only)
  // ===== C1–C7 EXPERIMENTAL CHANNEL (populated only when the relevant flag is ON;
  //      undefined otherwise so all-flags-OFF output is bit-for-bit identical) =====
  rawEvidenceScore?: number;             // C1: evidence term before prior blend (= 1 + reliableDeviation)
  priorProbability?: number;            // C1: the prior actually used (theo or livePrior)
  calibratedProbabilityPosterior?: number; // C1: true Bayesian posterior probability (normalized, sums to 1)
  uncertainty?: number;                  // C3: 0..1 (1 = fully prior-driven / data-starved, 0 = data-driven)
  selectionScore?: number;               // C1: the score the optimizer/selection actually uses
}

// ============================================================
// PERFORMANCE DASHBOARD
// ============================================================
export interface PerformanceDashboard {
  totalRounds: number;
  hits: number;
  misses: number;
  predictionHitRate: number;          // 0..1
  predictionMissRate: number;         // 0..1
  recentHitRate: number;              // last 5 rounds
  recentHitRateLong: number;         // last 10 rounds
  longTermHitRate: number;            // all rounds
  adaptiveWeight: number;             // 0..1 (how much to trust recent)
  excludedResultRate: number;         // fraction of results that landed in excluded set
  modelStability: number;             // 0..100 (consistency of recent hit-rate)
  sampleSize: number;                 // total verified rounds
  currentStreak: { type: "HIT" | "MISS"; length: number };
  signalWiseHitRate: Record<string, { predicted: number; hit: number; rate: number; wilsonLower: number }>;
  patternShiftDetected: boolean;
  anomalyDetected: boolean;
  patternShiftNote: string;
  anomalyNote: string;
  // ===== NEW: separate performance windows (5/10/20/50/100+) =====
  recent5HitRate: number;             // last 5 rounds hit-rate
  recent10HitRate: number;            // last 10 rounds hit-rate
  recent20HitRate: number;            // last 20 rounds hit-rate
  recent50HitRate: number;            // last 50 rounds hit-rate
  recent100HitRate: number;           // last 100 rounds hit-rate
  recent5Count: number;               // how many rounds in the 5-window
  recent10Count: number;
  recent20Count: number;
  recent50Count: number;
  recent100Count: number;
  hitStreak: number;                   // current consecutive HITs
  missStreak: number;                  // current consecutive MISSes
  predictionCoverage: number;         // theoretical coverage of active prediction (0..1)
  // ===== NEW: Bonus risk analysis =====
  normalOutcomeCoverage: number;       // theoretical coverage of number outcomes in active prediction
  bonusOutcomeCoverage: number;        // theoretical coverage of bonus outcomes in active prediction
  bonusOutcomeRisk: number;            // 0..1 — probability of a bonus MISS (excluded bonus prob)
  totalPredictionCoverage: number;     // total coverage (normal + bonus)
  bonusRecentRate: number;             // recent bonus frequency (last 10)
  bonusLongTermRate: number;           // long-term bonus frequency
  bonusTrend: number;                  // recent - long-term (positive = increasing)
  bonusBursts: number;                 // count of bonus clusters (2+ in 3 spins)
  bonusActive: boolean;                // bonus appeared in last 3 spins
  // ===== NEW: Normal vs Bonus result performance validation =====
  normalResultHitRate: number;         // HIT rate when actual result was a NUMBER
  bonusResultHitRate: number;          // HIT rate when actual result was a BONUS
  normalResultMissRate: number;        // MISS rate when actual result was a NUMBER
  bonusResultMissRate: number;         // MISS rate when actual result was a BONUS
  normalResultCount: number;           // count of number-result rounds
  bonusResultCount: number;            // count of bonus-result rounds
  // ===== NEW: Excluded risk breakdown =====
  excludedNormalRisk: number;          // theoretical prob of excluded number outcomes
  excludedBonusRisk: number;           // theoretical prob of excluded bonus outcomes (= bonusOutcomeRisk)
  totalMissExposure: number;            // total MISS exposure (excluded normal + excluded bonus)
  // ===== NEW: Per-bonus performance tracking =====
  // For each bonus outcome: how often was it predicted, how often did it
  // actually appear, HIT/MISS counts, and underrepresentation detection.
  perBonusPerformance: Record<string, {
    predictedCount: number;        // how many rounds this bonus was in the prediction
    actualCount: number;            // how many rounds this bonus was the actual result
    hitCount: number;               // how many times predicted AND was the actual result
    missCount: number;              // how many times it was the actual result but NOT predicted
    predictedRate: number;          // predictedCount / totalRounds
    actualRate: number;             // actualCount / totalRounds
    hitRate: number;                // hitCount / predictedCount
    underrepresented: boolean;      // actualRate > predictedRate * 1.5 (with sufficient sample)
  }>;
  // ===== NEW: Bonus underrepresentation detection =====
  bonusUnderrepresented: boolean;    // true if any bonus is significantly under-predicted
  bonusUnderrepresentationNote: string;
  // ===== NEW: Model-bias warning =====
  modelBiasWarning: boolean;         // true if bonuses repeatedly appear in actuals while excluded from predictions
  modelBiasNote: string;
  // ===== NEW: Per-bonus selection bias detection =====
  // Tracks each bonus's prediction inclusion rate vs its base probability.
  // If a bonus is selected far more than its evidence supports, flag it.
  perBonusSelectionBias: Record<string, {
    inclusionRate: number;          // how often this bonus is in the prediction (0..1)
    baseProbability: number;        // 54-segment base prior (0..1)
    observedRate: number;           // actual observed frequency (0..1)
    overSelected: boolean;          // inclusionRate > baseProbability * 2 (n>=50 only)
    underSelected: boolean;         // inclusionRate < observedRate * 0.3 (n>=50 only)
    calibrationTier: string;       // sample-size tier label
    hitContribution: number;      // HITs this bonus contributed
    missContribution: number;     // MISSes this bonus caused
  }>;
  selectionBiasWarning: boolean;    // true if any bonus is over-selected (n>=50)
  selectionBiasNote: string;
  // ===== NEW: MISS feedback & adaptive signal calibration =====
  // Per-signal adaptive weights (start at 1.0, adjust based on HIT/MISS history)
  signalWeights: Record<string, number>;
  // Last MISS analysis (null if last round was HIT or no rounds yet)
  lastMissAnalysis: {
    actualResult: string;
    actualRank: number;
    actualScore: number;
    predictedNames: string[];
    signalsSuppressedActual: string[];
    signalsBoostedFailed: string[];
  } | null;
}

// ============================================================
// RCA
// ============================================================
export interface RcaAnalysis {
  cause: string;
  note: string;
  patternFailure: boolean;
  predictionBias: boolean;
  trendReversal: boolean;
  modelDrift: boolean;
  anomaly: boolean;
  insufficientData: boolean;
}

// ============================================================
// FINAL UNIFIED ENGINE OUTPUT
// ============================================================
export interface EngineOutput {
  // Core prediction state (THE source of truth for the UI)
  predictions: { game: GameModel; confidence: number; time: number; rank: number; label: string; signals: string[] }[];
  excludedOutcomes: GameModel[];      // 4 NOT IN PREDICTION
  nextSignalNames: string[];          // prediction game names
  excludedNames: string[];             // excluded game names

  // Performance dashboard
  dashboard: PerformanceDashboard;

  // Candidate scoring breakdown
  candidateScores: CandidateScore[];

  // Decision engine fields
  status: "READY" | "WAIT" | "HOLD" | "RECALIBRATE";
  decision: "BET" | "WAIT" | "RECALIBRATE";
  confidence: number;                  // 0..100 (honest, sample-aware)
  confidenceLabel: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";

  // Last round context
  lastResult: string;
  lastHit: boolean | null;             // null = no rounds yet
  previousPrediction: string[];
  consecutiveMisses: number;
  consecutiveHits: number;

  // RCA (only on MISS, or null)
  rca: RcaAnalysis | null;

  // Excluded analysis (only on MISS, or null)
  excludedAnalysis: string | null;

  // Explanations
  whyThisMove: string;
  validationCriteria: string;

  // Recalibration flag
  recalibrated: boolean;               // was this prediction produced by recalibration?
  recalibrationReason: string;

  // ===== C1–C7 EXPERIMENTAL CHANNEL OUTPUT =====
  flags: FeatureFlags;                 // the flags this output was produced with
  modelVersion: string;                // engine model version stamp
  lockedRca?: LockedRcaRecord | null;   // C6: per-locked-Top-4 RCA record (null when c6 OFF)
}

// ============================================================
// HELPERS
// ============================================================

/** Wilson score 95% lower bound — sample-size-aware confidence.
 *  Returns 0..1.  With n=0 → 0.  With n=2, hits=2 → ~0.34 (NOT 1.0).
 *  This prevents overfitting: 2/2 is NOT better than 50/100. */
export function wilsonLowerBound(hits: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = Math.min(1, Math.max(0, hits / n));
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / n;
  return Math.max(0, (center - margin) / denom);
}

/** Adaptive weight for recent vs long-term data.
 *  Returns 0..1. Higher when recent window is more informative. */
function adaptiveWeight(recentRate: number, longRate: number, recentN: number): number {
  if (recentN < 3) return 0.3;
  const diff = Math.abs(recentRate - longRate);
  // Bigger divergence → trust recent more (but capped to avoid overreaction).
  const base = 0.5 + Math.min(0.3, diff * 0.6);
  return Math.max(0.3, Math.min(0.8, base));
}

// ============================================================
// C1 / C3 — TRUE CALIBRATED PROBABILITY + UNCERTAINTY
// ============================================================
/**
 * Compute a genuine Bayesian posterior probability per outcome via
 * Dirichlet/Laplace smoothing:
 *
 *   posterior_i = (count_i + k · prior_i) / (N + k)
 *
 * This is a REAL probability distribution: it sums to exactly 1 over
 * the 8 outcomes (because Σprior = 1 and Σcount = N). It is anchored to
 * the prior and SHRINKS toward the prior when the sample is small — this
 * is the calibrated probability channel (C1), NOT the legacy
 * `rawScore / ΣrawScore` score-share that `selectTopByEvidence` computes
 * for backward compatibility.
 *
 * Uncertainty (C3) = the fraction of the posterior mass contributed by
 * the prior (vs the data). When the sample is tiny, nearly all the mass
 * is prior → uncertainty ≈ 1 → the selection score must be shrunk toward
 * the prior so a small sample cannot create an aggressive jump.
 *
 * @param counts   per-outcome observed count (user + live combined)
 * @param priors   per-outcome prior (theoretical or live-blended)
 * @param sampleN  total sample size (Σcounts)
 * @param k        smoothing strength (default EXPERIMENTAL_CONFIG.shrinkageK = 30)
 */
function calibrateProbabilities(
  counts: Record<string, number>,
  priors: Record<string, number>,
  sampleN: number,
  k: number,
): { posterior: Record<string, number>; uncertainty: Record<string, number> } {
  const posterior: Record<string, number> = {};
  const uncertainty: Record<string, number> = {};
  let denom = sampleN + k;
  if (denom <= 0) denom = k > 0 ? k : 1;
  for (const g of GAMES) {
    const c = counts[g.name] ?? 0;
    const p = priors[g.name] ?? 1 / GAMES.length;
    posterior[g.name] = (c + k * p) / denom;
    // Fraction of posterior mass from the prior (not the data).
    // Higher = more uncertain. dataMassFrac = c / denom; uncertainty = 1 - dataMassFrac.
    uncertainty[g.name] = denom > 0 ? 1 - c / denom : 1;
  }
  // Normalize defensively (floating point; should already sum to ~1).
  const sum = GAMES.reduce((s, g) => s + (posterior[g.name] ?? 0), 0);
  if (sum > 0) {
    for (const g of GAMES) posterior[g.name] = (posterior[g.name] ?? 0) / sum;
  }
  return { posterior, uncertainty };
}

/** C3 uncertainty-aware shrinkage: pull a data estimate toward the prior
 *  proportional to uncertainty. Used to build `selectionScore` so a
 *  data-starved outcome cannot leap above a high-prior outcome.
 *    shrunk = dataEstimate · (1 - u) + prior · u
 *  where u = uncertainty ∈ [0,1]. Preserves all existing sample-size
 *  gates (k=30 Laplace, Wilson caps); adds NO HOT/OVERDUE/GAP rules. */
function shrinkTowardPrior(dataEstimate: number, prior: number, uncertainty: number): number {
  const u = Math.max(0, Math.min(1, uncertainty));
  return dataEstimate * (1 - u) + prior * u;
}

// ============================================================
// C8 — BAYESIAN CREDIBLE LOWER-BOUND (CLB)
// ============================================================
// PRINCIPLE: Replace the posterior point estimate in the C4 coverage term
// with its 95% credible LOWER bound. This is the standard "safe probability"
// from Bayesian decision theory — penalizes outcomes with high point
// estimates but low effective sample sizes (uncertainty drags the lower
// bound down). GENERIC: applies identically to all 8 outcomes (numbers and
// bonuses); no per-outcome threshold or hardcoded handling.
//
//   pLB_i = max(0, p_i - z * sqrt(p_i * (1 - p_i) / nEff_i))
//
// where:
//   p_i      = calibrated Bayesian posterior (C1)
//   nEff_i   = effective sample size (independent observations for outcome i)
//              derived from C2 reliability: reliability = nEff / (nEff + K)
//              → nEff = K * reliability / (1 - reliability)   (0 when reliability 0)
//   z        = 1.96 (95% two-sided credible level — the standard, NOT tuned
//              to any historical sample; per the C8 design directive §3).
//
// Behavior:
//   - nEff = 0        → pLB = 0 (no data → no safe probability)
//   - nEff small      → pLB ≪ posterior (wide CI → strong shrinkage)
//   - nEff → ∞        → pLB → posterior (CI narrows → no shrinkage)
//   - p near 0 or 1   → smaller SE → pLB closer to p (variance stabilizes)
//
// IMPORTANT: C8 does NOT overwrite the posterior, rawScore, or selectionScore.
// It ONLY changes the probability used in the C4 optimizer's COVERAGE term
// (and the diversity term, which is computed from the same probabilities).
// All other C1–C7 fields remain unchanged. When c8_credibleLowerBound is OFF,
// the optimizer uses the posterior directly (bit-for-bit C1–C7 behavior).
export const C8_Z = 1.96; // 95% credible lower bound (NOT tuned — standard)

/** Compute the 95% credible lower bound on a posterior probability given
 *  the effective sample size. Returns 0 when nEff <= 0. Generic — identical
 *  treatment for all outcomes. */
export function credibleLowerBound(
  posterior: number,
  effectiveSampleSize: number,
  z: number = C8_Z,
): number {
  if (!Number.isFinite(posterior) || !Number.isFinite(effectiveSampleSize)) return 0;
  const p = Math.max(0, Math.min(1, posterior));
  const n = Math.max(0, effectiveSampleSize);
  if (n <= 0) return 0;
  const se = Math.sqrt((p * (1 - p)) / n);
  return Math.max(0, p - z * se);
}

/** Derive the effective sample size (nEff) from C2 reliability.
 *  reliability = nEff / (nEff + K)  →  nEff = K * r / (1 - r).
 *  Returns 0 when reliability <= 0; returns a large number when reliability → 1. */
export function effectiveSampleSizeFromReliability(reliability: number, K: number = RELIABILITY_K): number {
  if (!Number.isFinite(reliability) || reliability <= 0) return 0;
  if (reliability >= 1) return 1e9;
  return K * reliability / (1 - reliability);
}

/** Chi-square-based anomaly detection: actual distribution vs theoretical.
 *  Returns { isAnomaly, statistic, threshold } */
function detectAnomaly(rounds: RoundResult[]): {
  isAnomaly: boolean;
  note: string;
  statistic: number;
} {
  const n = rounds.length;
  if (n < 10) return { isAnomaly: false, note: "Insufficient data for anomaly test", statistic: 0 };

  const counts: Record<string, number> = {};
  for (const g of GAMES) counts[g.name] = 0;
  for (const r of rounds) counts[r.actualResult.name] = (counts[r.actualResult.name] ?? 0) + 1;

  let chiSq = 0;
  for (const g of GAMES) {
    const expected = (THEORETICAL[g.name] ?? 0.1) * n;
    const observed = counts[g.name] ?? 0;
    if (expected > 0) {
      chiSq += ((observed - expected) ** 2) / expected;
    }
  }
  // 8 segments → 7 degrees of freedom. Critical value at p=0.01 ≈ 18.5.
  const isAnomaly = chiSq > 18.5;
  const note = isAnomaly
    ? `Distribution diverges significantly from theoretical (χ²=${chiSq.toFixed(1)} > 18.5). Possible model drift.`
    : `Distribution within normal bounds (χ²=${chiSq.toFixed(1)} ≤ 18.5).`;
  return { isAnomaly, note, statistic: chiSq };
}

/** Pattern-shift detection: compares last-10 distribution to long-term. */
function detectPatternShift(rounds: RoundResult[]): {
  detected: boolean;
  note: string;
  divergence: number;
} {
  const n = rounds.length;
  if (n < 15) return { detected: false, note: "Insufficient data for pattern shift test", divergence: 0 };

  const longSlice = rounds.slice(0, Math.max(0, n - 10));
  const recentSlice = rounds.slice(-10);

  const longFreq: Record<string, number> = {};
  const recentFreq: Record<string, number> = {};
  for (const g of GAMES) { longFreq[g.name] = 0; recentFreq[g.name] = 0; }
  for (const r of longSlice) longFreq[r.actualResult.name] = (longFreq[r.actualResult.name] ?? 0) + 1;
  for (const r of recentSlice) recentFreq[r.actualResult.name] = (recentFreq[r.actualResult.name] ?? 0) + 1;

  let divergence = 0;
  const longN = Math.max(1, longSlice.length);
  const recentN = Math.max(1, recentSlice.length);
  for (const g of GAMES) {
    const lf = longFreq[g.name] / longN;
    const rf = recentFreq[g.name] / recentN;
    divergence += Math.abs(rf - lf);
  }
  // Total variation distance. > 0.6 = significant shift.
  const detected = divergence > 0.6;
  const note = detected
    ? `Recent 10 rounds diverge from long-term baseline (TVD=${divergence.toFixed(2)} > 0.60). Pattern shift detected — recent data weighted higher.`
    : `Recent distribution consistent with long-term (TVD=${divergence.toFixed(2)} ≤ 0.60). No pattern shift.`;
  return { detected, note, divergence };
}

// ============================================================
// RCA — ROOT CAUSE ANALYSIS (only on MISS)
// ============================================================
function runRca(
  rounds: RoundResult[],
  last: RoundResult,
  consecutiveMisses: number,
  anomaly: { isAnomaly: boolean; note: string },
  patternShift: { detected: boolean; note: string },
): RcaAnalysis {
  const actualName = last.actualResult.name;
  const recentResults = rounds.slice(-8).map((r) => r.actualResult.name);
  let streak = 1;
  for (let i = recentResults.length - 2; i >= 0; i--) {
    if (recentResults[i] === actualName) streak++;
    else break;
  }

  const allActuals = rounds.map((r) => r.actualResult.name);
  const actualCount = allActuals.filter((a) => a === actualName).length;
  const actualFreq = actualCount / allActuals.length;
  const theo = THEORETICAL[actualName] ?? 0.1;

  const result: RcaAnalysis = {
    cause: "",
    note: "",
    patternFailure: false,
    predictionBias: false,
    trendReversal: false,
    modelDrift: false,
    anomaly: false,
    insufficientData: false,
  };

  if (rounds.length < 5) {
    result.cause = "INSUFFICIENT DATA";
    result.note = "Sample too small. Building baseline — prediction continues with available evidence.";
    result.insufficientData = true;
    return result;
  }

  if (anomaly.isAnomaly) {
    result.cause = "MODEL DRIFT / ANOMALY";
    result.note = `${anomaly.note} ${actualName} appeared outside prediction set. Recalibrating with recent data.`;
    result.modelDrift = true;
    result.anomaly = true;
    return result;
  }

  if (patternShift.detected) {
    result.cause = "PATTERN SHIFT";
    result.note = `${patternShift.note} Recent data now weighted higher in candidate scoring.`;
    result.patternFailure = true;
    result.trendReversal = true;
    return result;
  }

  if (consecutiveMisses >= 3) {
    result.cause = "PREDICTION BIAS";
    result.note = `${consecutiveMisses} consecutive misses. Prediction set may be biased — recalibrating with recent evidence.`;
    result.predictionBias = true;
    return result;
  }

  if (streak >= 3) {
    result.cause = "VOLATILITY / STREAK";
    result.note = `${actualName} appeared ${streak}× consecutively. Volatile streak detected — recalibration applied.`;
    return result;
  }

  if (actualFreq < theo * 0.5) {
    result.cause = "OUTLIER / ANOMALY";
    result.note = `${actualName} is rare (actual ${(actualFreq * 100).toFixed(1)}% vs theoretical ${(theo * 100).toFixed(1)}%). Random outlier — no pattern shift.`;
    result.anomaly = true;
    return result;
  }

  if (actualFreq > theo * 1.5) {
    result.cause = "TREND CHANGE";
    result.note = `${actualName} is overperforming (${(actualFreq * 100).toFixed(1)}% vs ${(theo * 100).toFixed(1)}% expected). Trend shift detected.`;
    result.trendReversal = true;
    return result;
  }

  result.cause = "NORMAL VARIANCE";
  result.note = `${actualName} was outside prediction set. Within normal variance — no anomaly detected. Recalibration applied as standard practice.`;
  return result;
}

// ============================================================
// PERFORMANCE DASHBOARD
// ============================================================
function buildDashboard(rounds: RoundResult[], liveSpins: SpinData[] = []): PerformanceDashboard {
  const totalRounds = rounds.length;
  const hits = rounds.filter((r) => r.hit).length;
  const misses = totalRounds - hits;

  const predictionHitRate = totalRounds > 0 ? hits / totalRounds : 0;
  const predictionMissRate = totalRounds > 0 ? misses / totalRounds : 0;

  // Recent windows
  const recent5 = rounds.slice(-5);
  const recent10 = rounds.slice(-10);
  const recentHits5 = recent5.filter((r) => r.hit).length;
  const recentHits10 = recent10.filter((r) => r.hit).length;
  const recentHitRate = recent5.length > 0 ? recentHits5 / recent5.length : 0;
  const recentHitRateLong = recent10.length > 0 ? recentHits10 / recent10.length : 0;
  const longTermHitRate = predictionHitRate;

  // Adaptive weight (0..1) — how much to trust recent over long-term
  const adaptW = adaptiveWeight(recentHitRate, longTermHitRate, recent5.length);

  // Excluded-result rate = MISS rate by definition
  const excludedResultRate = predictionMissRate;

  // Model stability: 100 - (variance of last-N hit indicators * 100)
  // Lower variance → higher stability.
  let stability = 100;
  if (recent10.length >= 3) {
    const indicators = recent10.map((r) => (r.hit ? 1 : 0));
    const mean = indicators.reduce<number>((s, x) => s + x, 0) / indicators.length;
    const variance = indicators.reduce<number>((s, x) => s + (x - mean) ** 2, 0) / indicators.length;
    stability = Math.max(0, Math.round(100 - variance * 200));
  } else if (totalRounds > 0) {
    stability = 30; // low confidence in stability with tiny sample
  }

  // Current streak
  let streakType: "HIT" | "MISS" = "HIT";
  let streakLen = 0;
  let hitStreak = 0;
  let missStreak = 0;
  if (totalRounds > 0) {
    const last = rounds[totalRounds - 1];
    streakType = last.hit ? "HIT" : "MISS";
    for (let i = totalRounds - 1; i >= 0; i--) {
      if ((rounds[i].hit ? "HIT" : "MISS") === streakType) streakLen++;
      else break;
    }
    // Separate HIT streak and MISS streak
    if (last.hit) {
      for (let i = totalRounds - 1; i >= 0; i--) {
        if (rounds[i].hit) hitStreak++;
        else break;
      }
    } else {
      for (let i = totalRounds - 1; i >= 0; i--) {
        if (!rounds[i].hit) missStreak++;
        else break;
      }
    }
  }

  // ===== NEW: separate performance windows (5/10/20/50/100+) =====
  const calcWindowRate = (windowSize: number): { rate: number; count: number } => {
    const slice = rounds.slice(-windowSize);
    if (slice.length === 0) return { rate: 0, count: 0 };
    const h = slice.filter((r) => r.hit).length;
    return { rate: h / slice.length, count: slice.length };
  };
  const w5 = calcWindowRate(5);
  const w10 = calcWindowRate(10);
  const w20 = calcWindowRate(20);
  const w50 = calcWindowRate(50);
  const w100 = calcWindowRate(100);

  // ===== NEW: prediction coverage (theoretical % of wheel covered by active pred) =====
  // Computed from the last round's prediction (if any).
  let predictionCoverage = 0;
  const lastRoundForCov = rounds[totalRounds - 1];
  if (lastRoundForCov && lastRoundForCov.prediction.length > 0) {
    predictionCoverage = lastRoundForCov.prediction.reduce(
      (s, p) => s + (THEORETICAL[p.game.name] ?? 0),
      0,
    );
  }

  // Signal-wise hit rate: for each game, when it was in the prediction set,
  // how often was it the actual result?
  const signalWise: Record<string, { predicted: number; hit: number; rate: number; wilsonLower: number }> = {};
  for (const g of GAMES) {
    let predicted = 0;
    let hit = 0;
    for (const r of rounds) {
      if (r.prediction.some((p) => p.game.name === g.name)) {
        predicted++;
        if (r.actualResult.name === g.name) hit++;
      }
    }
    const rate = predicted > 0 ? hit / predicted : 0;
    signalWise[g.name] = {
      predicted,
      hit,
      rate,
      wilsonLower: wilsonLowerBound(hit, predicted),
    };
  }

  const anomaly = detectAnomaly(rounds);
  const patternShift = detectPatternShift(rounds);

  // ===== BONUS RISK ANALYSIS =====
  // Compute bonus coverage/risk from the active prediction (last round's pred).
  const lastRoundForBonus = rounds[totalRounds - 1];
  const activePredNames = lastRoundForBonus
    ? lastRoundForBonus.prediction.map((p) => p.game.name)
    : [];
  const activeBonusNames = activePredNames.filter((n) => BONUS_NAMES.includes(n));
  const activeNumberNames = activePredNames.filter((n) => !BONUS_NAMES.includes(n));
  const normalOutcomeCoverage = activeNumberNames.reduce(
    (s, n) => s + (THEORETICAL[n] ?? 0),
    0,
  );
  const bonusOutcomeCoverage = activeBonusNames.reduce(
    (s, n) => s + (THEORETICAL[n] ?? 0),
    0,
  );
  // Bonus risk = probability that a bonus outcome occurs but is NOT in the prediction.
  // = sum of theoretical probs of EXCLUDED bonus outcomes.
  const excludedBonusNames = BONUS_NAMES.filter((n) => !activePredNames.includes(n));
  const bonusOutcomeRisk = excludedBonusNames.reduce(
    (s, n) => s + (THEORETICAL[n] ?? 0),
    0,
  );
  const totalPredictionCoverage = normalOutcomeCoverage + bonusOutcomeCoverage;

  // Bonus frequency from combined sequence (user rounds + live spins)
  const combinedBonusSeq = [
    ...rounds.map((r) => r.actualResult.name),
    ...liveSpins.map((s) => SPIN_TO_GAME_NAME[s.sector] ?? "").filter((x) => x),
  ];
  const bonusLongTermRate = combinedBonusSeq.length > 0
    ? combinedBonusSeq.filter((n) => BONUS_NAMES.includes(n)).length / combinedBonusSeq.length
    : 0;
  const recent10Combined = combinedBonusSeq.slice(-10);
  const bonusRecentRate = recent10Combined.length > 0
    ? recent10Combined.filter((n) => BONUS_NAMES.includes(n)).length / recent10Combined.length
    : 0;
  const bonusTrend = bonusRecentRate - bonusLongTermRate;
  // Bonus bursts (2+ bonuses within 3 spins)
  let bonusBursts = 0;
  for (let i = 0; i < combinedBonusSeq.length - 2; i++) {
    const window = combinedBonusSeq.slice(i, i + 3);
    if (window.filter((n) => BONUS_NAMES.includes(n)).length >= 2) bonusBursts++;
  }
  const last3Combined = combinedBonusSeq.slice(-3);
  const bonusActive = last3Combined.some((n) => BONUS_NAMES.includes(n));

  // ===== NEW: Normal vs Bonus result performance validation =====
  // Track HIT/MISS rates separately for number-result rounds vs bonus-result rounds.
  // This reveals whether the model is genuinely improving or merely selecting
  // high-frequency number outcomes.
  let normalResultCount = 0;
  let bonusResultCount = 0;
  let normalResultHits = 0;
  let bonusResultHits = 0;
  for (const r of rounds) {
    const isBonusResult = BONUS_NAMES.includes(r.actualResult.name);
    if (isBonusResult) {
      bonusResultCount++;
      if (r.hit) bonusResultHits++;
    } else {
      normalResultCount++;
      if (r.hit) normalResultHits++;
    }
  }
  const normalResultHitRate = normalResultCount > 0 ? normalResultHits / normalResultCount : 0;
  const bonusResultHitRate = bonusResultCount > 0 ? bonusResultHits / bonusResultCount : 0;
  const normalResultMissRate = normalResultCount > 0 ? 1 - normalResultHitRate : 0;
  const bonusResultMissRate = bonusResultCount > 0 ? 1 - bonusResultHitRate : 0;

  // ===== NEW: Excluded risk breakdown =====
  // Excluded normal risk = theoretical prob of excluded NUMBER outcomes.
  // Excluded bonus risk = theoretical prob of excluded BONUS outcomes.
  // Total miss exposure = excluded normal + excluded bonus.
  const excludedNumberNames = GAMES
    .filter((g) => !BONUS_NAMES.includes(g.name) && !activePredNames.includes(g.name))
    .map((g) => g.name);
  const excludedNormalRisk = excludedNumberNames.reduce(
    (s, n) => s + (THEORETICAL[n] ?? 0),
    0,
  );
  const excludedBonusRisk = bonusOutcomeRisk; // already computed
  const totalMissExposure = excludedNormalRisk + excludedBonusRisk;

  // ===== NEW: Per-bonus performance tracking =====
  // For each bonus: predictedCount, actualCount, hitCount, missCount, rates, underrepresented.
  const perBonusPerformance: Record<string, {
    predictedCount: number;
    actualCount: number;
    hitCount: number;
    missCount: number;
    predictedRate: number;
    actualRate: number;
    hitRate: number;
    underrepresented: boolean;
  }> = {};
  for (const bonusName of BONUS_NAMES) {
    let predictedCount = 0;
    let actualCount = 0;
    let hitCount = 0;
    let missCount = 0;
    for (const r of rounds) {
      const wasPredicted = r.prediction.some((p) => p.game.name === bonusName);
      const wasActual = r.actualResult.name === bonusName;
      if (wasPredicted) predictedCount++;
      if (wasActual) actualCount++;
      if (wasPredicted && wasActual) hitCount++;
      if (!wasPredicted && wasActual) missCount++;
    }
    const predictedRate = totalRounds > 0 ? predictedCount / totalRounds : 0;
    const actualRate = totalRounds > 0 ? actualCount / totalRounds : 0;
    const hitRate = predictedCount > 0 ? hitCount / predictedCount : 0;
    // Underrepresented = actual appears 1.5× more than predicted (n>=50 only — meaningful)
    const underrepresented = totalRounds >= 50 && actualRate > predictedRate * 1.5 && actualCount >= 2;
    perBonusPerformance[bonusName] = {
      predictedCount,
      actualCount,
      hitCount,
      missCount,
      predictedRate,
      actualRate,
      hitRate,
      underrepresented,
    };
  }

  // ===== NEW: Bonus underrepresentation detection =====
  // True if ANY bonus is significantly under-predicted (actual > 1.5× predicted, 10+ sample).
  const underrepresentedBonuses = BONUS_NAMES.filter((b) => perBonusPerformance[b].underrepresented);
  const bonusUnderrepresented = underrepresentedBonuses.length > 0;
  const bonusUnderrepresentationNote = bonusUnderrepresented
    ? `Underrepresented: ${underrepresentedBonuses.map((b) => `${b} (pred ${Math.round(perBonusPerformance[b].predictedRate * 100)}% / actual ${Math.round(perBonusPerformance[b].actualRate * 100)}%)`).join(", ")}. Model may be under-selecting bonuses.`
    : "No bonus underrepresentation detected.";

  // ===== NEW: Model-bias warning (n>=50 only — meaningful) =====
  // True if 2+ bonuses repeatedly appear in actuals while being excluded from predictions.
  const biasBonuses = BONUS_NAMES.filter((b) => {
    const p = perBonusPerformance[b];
    return totalRounds >= 50 && p.missCount >= 2 && p.predictedRate < p.actualRate * 0.5;
  });
  const modelBiasWarning = biasBonuses.length >= 2;
  const modelBiasNote = modelBiasWarning
    ? `MODEL BIAS WARNING: ${biasBonuses.length} bonuses (${biasBonuses.join(", ")}) are repeatedly appearing in actual results while being excluded from predictions. Recalibration needed — do NOT keep selecting [1,2,5,10].`
    : "No model bias detected.";

  // ===== NEW: Per-bonus selection bias detection (calibration, NOT reactive) =====
  // Per user spec — MINIMUM SAMPLE REQUIREMENT:
  //   n < 10:  Do NOT declare over/under-selected.
  //   n < 20:  Show "EARLY DATA" — no bias declaration.
  //   n >= 20: Begin preliminary calibration analysis (info only, no flag).
  //   n >= 50: Allow meaningful selection-bias detection (flag).
  //   n >= 100: Allow mature calibration assessment.
  //
  // NO REACTIVE CORRECTION: bias detection does NOT immediately boost/penalty
  // any outcome. It only flags for diagnostic purposes.
  const perBonusSelectionBias: Record<string, {
    inclusionRate: number;
    baseProbability: number;
    observedRate: number;
    overSelected: boolean;
    underSelected: boolean;
    calibrationTier: string;      // sample-size tier label
    hitContribution: number;     // how many HITs this bonus contributed
    missContribution: number;    // how many MISSes this bonus caused
  }> = {};
  const overSelectedBonuses: string[] = [];
  for (const bonusName of BONUS_NAMES) {
    const p = perBonusPerformance[bonusName];
    const baseProb = THEORETICAL[bonusName] ?? 0.05;
    const inclusionRate = totalRounds > 0 ? p.predictedCount / totalRounds : 0;
    const observedRate = totalRounds > 0 ? p.actualCount / totalRounds : 0;
    // Calibration tier (sample-size based)
    const calibrationTier = totalRounds < 10
      ? "INSUFFICIENT (<10)"
      : totalRounds < 20
        ? "EARLY DATA (<20)"
        : totalRounds < 50
          ? "PRELIMINARY (<50)"
          : totalRounds < 100
            ? "MEANINGFUL (<100)"
            : "MATURE (100+)";
    // Over-selected: only flag at n >= 50 (meaningful), inclusion > 2× base
    const overSelected = totalRounds >= 50 && inclusionRate > baseProb * 2;
    // Under-selected: only flag at n >= 50, inclusion < 30% of observed
    const underSelected = totalRounds >= 50 && observedRate > 0 && inclusionRate < observedRate * 0.3;
    perBonusSelectionBias[bonusName] = {
      inclusionRate,
      baseProbability: baseProb,
      observedRate,
      overSelected,
      underSelected,
      calibrationTier,
      hitContribution: p.hitCount,
      missContribution: p.missCount,
    };
    if (overSelected) overSelectedBonuses.push(bonusName);
  }
  const selectionBiasWarning = overSelectedBonuses.length > 0;
  const selectionBiasNote = selectionBiasWarning
    ? `SELECTION BIAS (n>=50): ${overSelectedBonuses.map((b) => `${b} (incl ${Math.round(perBonusSelectionBias[b].inclusionRate * 100)}% vs base ${Math.round(perBonusSelectionBias[b].baseProbability * 100)}%)`).join(", ")} — over-selected. Diagnostic only — NO reactive correction.`
    : totalRounds < 50
      ? `Calibration: ${totalRounds < 10 ? "INSUFFICIENT" : totalRounds < 20 ? "EARLY DATA" : "PRELIMINARY"} — need 50+ rounds for meaningful bias detection.`
      : "No selection bias detected.";

  return {
    totalRounds,
    hits,
    misses,
    predictionHitRate,
    predictionMissRate,
    recentHitRate,
    recentHitRateLong,
    longTermHitRate,
    adaptiveWeight: adaptW,
    excludedResultRate,
    modelStability: stability,
    sampleSize: totalRounds,
    currentStreak: { type: streakType, length: streakLen },
    signalWiseHitRate: signalWise,
    patternShiftDetected: patternShift.detected,
    anomalyDetected: anomaly.isAnomaly,
    patternShiftNote: patternShift.note,
    anomalyNote: anomaly.note,
    // NEW performance windows:
    recent5HitRate: w5.rate,
    recent10HitRate: w10.rate,
    recent20HitRate: w20.rate,
    recent50HitRate: w50.rate,
    recent100HitRate: w100.rate,
    recent5Count: w5.count,
    recent10Count: w10.count,
    recent20Count: w20.count,
    recent50Count: w50.count,
    recent100Count: w100.count,
    hitStreak,
    missStreak,
    predictionCoverage,
    // NEW bonus risk analysis:
    normalOutcomeCoverage,
    bonusOutcomeCoverage,
    bonusOutcomeRisk,
    totalPredictionCoverage,
    bonusRecentRate,
    bonusLongTermRate,
    bonusTrend,
    bonusBursts,
    bonusActive,
    // NEW normal vs bonus result performance:
    normalResultHitRate,
    bonusResultHitRate,
    normalResultMissRate,
    bonusResultMissRate,
    normalResultCount,
    bonusResultCount,
    // NEW excluded risk breakdown:
    excludedNormalRisk,
    excludedBonusRisk,
    totalMissExposure,
    // NEW per-bonus performance:
    perBonusPerformance,
    bonusUnderrepresented,
    bonusUnderrepresentationNote,
    modelBiasWarning,
    modelBiasNote,
    // NEW selection bias detection:
    perBonusSelectionBias,
    selectionBiasWarning,
    selectionBiasNote,
    // NEW MISS feedback & adaptive signal calibration:
    signalWeights: getAdaptiveSignalWeights(rounds),
    lastMissAnalysis: getLastMissAnalysis(rounds),
  };
}

// ============================================================
// ADAPTIVE SIGNAL WEIGHTS — learn from MISSes without overreacting
// ============================================================
/**
 * Per-signal adaptive weights. Start at 1.0.
 * After a MISS: if a signal was active on the FAILED prediction but NOT on the
 * actual result, reduce its weight by 2% (bounded [0.5, 1.5]).
 * After a HIT: if a signal was active on the CORRECT prediction, increase by 1%.
 * Capped to prevent any single signal from dominating or disappearing.
 */
function getAdaptiveSignalWeights(rounds: RoundResult[]): Record<string, number> {
  const weights: Record<string, number> = {};
  const SIGNAL_NAMES = [
    "recent-active", "trending-up", "trending-down", "pattern-stable",
    "verified", "high-volatility", "repeat-supported", "repeat-unlikely",
    "bonus-phase-risk", "persistence-penalty", "anomaly-weighted", "shift-adaptive",
  ];
  for (const s of SIGNAL_NAMES) weights[s] = 1.0;

  if (rounds.length < 5) return weights; // need minimum data

  // Track signal presence per round (from stored round metadata — we approximate
  // by checking if the actual result was predicted and had signals)
  // Since we don't store per-signal history, we use a simplified heuristic:
  // Count how many MISSes vs HITs occurred, and adjust weights gradually.
  const recent20 = rounds.slice(-20);
  const recentHits = recent20.filter((r) => r.hit).length;
  const recentMisses = recent20.length - recentHits;
  const hitRate = recentHits / recent20.length;

  // If hit rate is low, slightly reduce reliance on trend/recent signals
  // (they may be chasing noise). If hit rate is high, keep them strong.
  if (recentMisses > recentHits * 1.5) {
    // More misses than hits → reduce trend/recent signal weights slightly
    weights["trending-up"] = Math.max(0.7, 1.0 - recentMisses * 0.01);
    weights["trending-down"] = Math.max(0.7, 1.0 - recentMisses * 0.01);
    weights["recent-active"] = Math.max(0.7, 1.0 - recentMisses * 0.005);
  } else if (recentHits > recentMisses * 1.5) {
    // More hits → slightly boost
    weights["trending-up"] = Math.min(1.2, 1.0 + recentHits * 0.005);
    weights["recent-active"] = Math.min(1.2, 1.0 + recentHits * 0.005);
  }

  return weights;
}

/**
 * Analyze the last MISS: what was the actual result, what rank was it,
 * and which signals may have suppressed it.
 */
function getLastMissAnalysis(rounds: RoundResult[]): {
  actualResult: string;
  actualRank: number;
  actualScore: number;
  predictedNames: string[];
  signalsSuppressedActual: string[];
  signalsBoostedFailed: string[];
} | null {
  if (rounds.length === 0) return null;
  const last = rounds[rounds.length - 1];
  if (last.hit) return null; // last round was HIT, no MISS analysis

  const actualName = last.actualResult.name;
  const predictedNames = last.prediction.map((p) => p.game.name);

  // The actual result was NOT in the prediction set (it was a MISS).
  // Analyze why: which signals may have suppressed it?
  const suppressed: string[] = [];
  const boosted: string[] = [];

  // Check if the actual result had low recent frequency (suppressed by recency)
  const actualRecentCount = rounds.slice(-10).filter((r) => r.actualResult.name === actualName).length;
  if (actualRecentCount <= 1) suppressed.push("low-recent-frequency");

  // Check if the actual result had high volatility (suppressed by volatility penalty)
  if (last.recalibrated) suppressed.push("recalibration-applied");

  // Check if the actual result was a bonus (suppressed by base prior)
  if (BONUS_NAMES.includes(actualName)) suppressed.push("low-base-prior");

  // Check if predicted outcomes had high recent frequency (boosted by recency)
  for (const name of predictedNames) {
    const count = rounds.slice(-10).filter((r) => r.actualResult.name === name).length;
    if (count >= 3) boosted.push(`${name}-recent-active`);
  }

  // Approximate rank: actual result was not in top-4, so rank > 4
  const actualRank = predictedNames.includes(actualName) ? 1 : 5; // simplified

  return {
    actualResult: actualName,
    actualRank,
    actualScore: 0, // not stored per-round; would need re-computation
    predictedNames,
    signalsSuppressedActual: suppressed,
    signalsBoostedFailed: boosted,
  };
}

// ============================================================
// CANDIDATE SCORING — STRONGEST EVIDENCE-BASED SIGNAL
// ============================================================
/**
 * Score all 8 game candidates using a multi-signal evidence engine.
 *
 * NEW: When `liveSpins` (REAL casino spins from CasinoScores API) is available
 * with 20+ spins, the long-term frequency is computed from REAL casino data —
 * NOT just the tiny user-verified round history. This produces data-driven,
 * VARIED predictions instead of always picking the theoretical top-4 [1,2,5,10].
 */
function scoreCandidates(
  rounds: RoundResult[],
  dashboard: PerformanceDashboard,
  prevPredNames: string[],
  lastHit: boolean | null,
  liveSpins: SpinData[] = [],
  mode: EngineMode = "baseline",
  flags: FeatureFlags = ALL_FLAGS_OFF,
): CandidateScore[] {
  // Get adaptive signal weights (learn from HIT/MISS history)
  const sigWeights = dashboard.signalWeights ?? {};
  const n = rounds.length;
  const hist = rounds.map((r) => r.actualResult);

  // Per-game frequency across ALL verified rounds (user history)
  const freqAll = new Map<string, number>();
  for (const g of GAMES) freqAll.set(g.name, 0);
  for (const h of hist) freqAll.set(h.name, (freqAll.get(h.name) ?? 0) + 1);

  // ===== REAL CASINO SPIN FREQUENCY (long-term prior from live data) =====
  // Map live spins (aiStats sector names) to engine game names + count.
  const liveN = liveSpins.length;
  const liveFreqAll = new Map<string, number>();
  for (const g of GAMES) liveFreqAll.set(g.name, 0);
  for (const s of liveSpins) {
    const gameName = SPIN_TO_GAME_NAME[s.sector] ?? s.sector;
    if (liveFreqAll.has(gameName)) {
      liveFreqAll.set(gameName, (liveFreqAll.get(gameName) ?? 0) + 1);
    }
  }
  // Use real casino frequency as long-term prior when we have 20+ real spins.
  // Otherwise fall back to theoretical probability.
  const useLivePrior = liveN >= 20;
  const livePriorFor = (gameName: string): number => {
    if (!useLivePrior) return THEORETICAL[gameName] ?? 0.1;
    return liveN > 0 ? (liveFreqAll.get(gameName) ?? 0) / liveN : (THEORETICAL[gameName] ?? 0.1);
  };

  // ===== RECENT LIVE SPIN FREQUENCY (last 10 real spins) =====
  const liveRecent = liveSpins.slice(0, 10); // newest first in API response
  const liveRecentN = liveRecent.length;
  const liveRecentFreq = new Map<string, number>();
  for (const g of GAMES) liveRecentFreq.set(g.name, 0);
  for (const s of liveRecent) {
    const gameName = SPIN_TO_GAME_NAME[s.sector] ?? s.sector;
    if (liveRecentFreq.has(gameName)) {
      liveRecentFreq.set(gameName, (liveRecentFreq.get(gameName) ?? 0) + 1);
    }
  }

  // Per-game frequency in recent 10 USER-VERIFIED rounds (short-term)
  // C9: when c9_recencyExcludeLast is ON, the SIGNAL recency window excludes
  // the just-arrived actual (the last element of hist). This prevents the
  // self-referential boost where the just-arrived result inflates its own
  // recent-frequency signal (recent-active, trending, shift-adaptive).
  // The Bayesian count (freqAll / smoothedFreq below) is UNCHANGED — it still
  // includes the just-arrived actual, which is correct for the posterior.
  // When C9 OFF: signalRecentHist === recentHist (bit-for-bit baseline).
  const recentHist = hist.slice(-10);
  const recentFreq = new Map<string, number>();
  for (const g of GAMES) recentFreq.set(g.name, 0);
  for (const h of recentHist) recentFreq.set(h.name, (recentFreq.get(h.name) ?? 0) + 1);

  // C9: signal recency window = last 10 EXCLUDING the most recent (just-arrived) actual.
  // hist.slice(-11, -1) takes elements [n-11 .. n-2], i.e. the 10 BEFORE the last.
  // When hist has ≤ 1 element, this is empty (no signal recency) — correct.
  const signalRecentHist = flags.c9_recencyExcludeLast ? hist.slice(-11, -1) : recentHist;
  const signalRecentFreq = new Map<string, number>();
  for (const g of GAMES) signalRecentFreq.set(g.name, 0);
  for (const h of signalRecentHist) signalRecentFreq.set(h.name, (signalRecentFreq.get(h.name) ?? 0) + 1);

  // Gap analysis per game
  const gaps: Record<string, number> = {};
  const gapHistories: Record<string, number[]> = {};
  for (const g of GAMES) { gaps[g.name] = n; gapHistories[g.name] = []; }
  let lastHitIdx: Record<string, number> = {};
  for (const g of GAMES) lastHitIdx[g.name] = -1;
  for (let i = 0; i < n; i++) {
    const name = hist[i].name;
    if (lastHitIdx[name] >= 0) {
      gapHistories[name].push(i - lastHitIdx[name]);
    }
    lastHitIdx[name] = i;
  }
  for (const g of GAMES) {
    gaps[g.name] = lastHitIdx[g.name] >= 0 ? n - 1 - lastHitIdx[g.name] : n;
  }

  // Adaptive weighting between long-term and recent
  const adaptW = dashboard.adaptiveWeight;
  const longW = 1 - adaptW;

  // Per-game stability (variance of recent gaps → inverse)
  const recentUnique = new Set(recentHist.map((g) => g.name)).size;
  const stability = recentUnique >= 4 ? "STABLE" : recentUnique >= 2 ? "VOLATILE" : "STREAK";

  // ===== REPEAT-PATTERN ANALYSIS (data-based, NOT blind carryover) =====
  // Analyze the historical tendency of each outcome to REPEAT in the next
  // round. This is NOT "last hit → predict same again". Instead, we measure:
  //   P(next = X | current = X)  from ALL historical consecutive pairs.
  // If the last actual result was X, and X has a historically HIGH repeat
  // rate, then X gets a MILD evidence boost (capped). If X has a LOW repeat
  // rate, no penalty — we just don't boost. This is pure statistical
  // evidence, not a "last hit shortcut".
  //
  // We use BOTH the user-verified round history AND the live casino spins
  // (mapped to game names) for a larger, more reliable sample.
  const lastActualName = n > 0 ? hist[n - 1].name : null;
  const lastLiveSpinName = liveN > 0
    ? (SPIN_TO_GAME_NAME[liveSpins[0].sector] ?? null)
    : null;
  // Prefer the most recent data point (live spins are newer than user rounds).
  const lastResultName = lastLiveSpinName ?? lastActualName;

  // Build a combined consecutive-pair sequence from both sources.
  // Live spins are newest-first; reverse to oldest-first for pair analysis.
  const liveGameSeq = liveSpins
    .map((s) => SPIN_TO_GAME_NAME[s.sector] ?? null)
    .filter((x): x is string => x !== null)
    .reverse(); // oldest-first
  const userGameSeq = hist.map((h) => h.name);
  const combinedSeq = [...userGameSeq, ...liveGameSeq];

  // Count repeat pairs: P(next = X | current = X)
  const repeatStats: Record<string, { currentCount: number; repeatCount: number; rate: number }> = {};
  for (const g of GAMES) repeatStats[g.name] = { currentCount: 0, repeatCount: 0, rate: 0 };
  for (let i = 0; i < combinedSeq.length - 1; i++) {
    const cur = combinedSeq[i];
    const next = combinedSeq[i + 1];
    if (repeatStats[cur]) {
      repeatStats[cur].currentCount++;
      if (next === cur) repeatStats[cur].repeatCount++;
    }
  }
  for (const g of GAMES) {
    const rs = repeatStats[g.name];
    rs.rate = rs.currentCount >= 3 ? rs.repeatCount / rs.currentCount : 0;
  }
  // Overall average repeat rate (for comparison baseline).
  const totalRepeatCur = Object.values(repeatStats).reduce((s, r) => s + r.currentCount, 0);
  const totalRepeatCount = Object.values(repeatStats).reduce((s, r) => s + r.repeatCount, 0);
  const baselineRepeatRate = totalRepeatCur >= 5 ? totalRepeatCount / totalRepeatCur : 0;

  // ===== BONUS CLUSTER DETECTION (bonus-aware scoring) =====
  // Analyze whether bonus outcomes are: increasing, decreasing, clustering,
  // appearing after specific sequences, repeating, or showing unusual recent
  // frequency. This is NOT "bonus appeared → predict bonus next". Instead,
  // we measure the CURRENT bonus activity level vs the long-term baseline.
  // If bonus activity is elevated, bonus outcomes get a mild evidence boost
  // (capped). This ensures the engine does NOT have a bonus blind spot.
  const isBonusGame = (name: string): boolean => BONUS_NAMES.includes(name);

  // Bonus frequency in combined sequence (long-term)
  const combinedBonusCount = combinedSeq.filter(isBonusGame).length;
  const combinedBonusRate = combinedSeq.length > 0 ? combinedBonusCount / combinedSeq.length : 0;
  // Bonus frequency in recent 10 of combined sequence (short-term)
  const recentCombined = combinedSeq.slice(-10);
  const recentBonusCount = recentCombined.filter(isBonusGame).length;
  const recentBonusRate = recentCombined.length > 0 ? recentBonusCount / recentCombined.length : 0;
  // Bonus activity trend: recent vs long-term
  const bonusTrend = recentBonusRate - combinedBonusRate; // positive = increasing
  // Bonus clustering: count bonus "bursts" (2+ bonuses within 3 spins)
  let bonusBursts = 0;
  for (let i = 0; i < combinedSeq.length - 2; i++) {
    const window = combinedSeq.slice(i, i + 3);
    const bonusInWindow = window.filter(isBonusGame).length;
    if (bonusInWindow >= 2) bonusBursts++;
  }
  // Is a bonus currently "active" (appeared in last 3 spins)?
  const last3 = combinedSeq.slice(-3);
  const bonusInLast3 = last3.filter(isBonusGame).length;
  const bonusActive = bonusInLast3 > 0;
  // Per-bonus-game recent frequency (last 10 combined)
  const bonusRecentFreq: Record<string, number> = {};
  for (const b of BONUS_NAMES) bonusRecentFreq[b] = 0;
  for (const name of recentCombined) {
    if (isBonusGame(name)) bonusRecentFreq[name] = (bonusRecentFreq[name] ?? 0) + 1;
  }

  const scores: CandidateScore[] = [];

  for (let i = 0; i < GAMES.length; i++) {
    const g = GAMES[i];
    const theo = THEORETICAL[g.name] ?? 0.1;
    // LONG-TERM PRIOR: prefer REAL casino spin frequency when available (20+
    // real spins), else theoretical probability, else tiny user history.
    const livePrior = livePriorFor(g.name);
    const userLongFreq = n > 0 ? (freqAll.get(g.name) ?? 0) / n : 0;
    // Blend user-verified long-term with live-prior when both exist.
    // Live prior dominates (real casino data) but user history adds weight.
    const longFreq = useLivePrior
      ? livePrior * 0.7 + userLongFreq * 0.3
      : userLongFreq;
    // RECENT frequency: prefer live recent (last 10 real spins) when available;
    // it's far more responsive than the tiny user recent slice.
    // C9: when c9_recencyExcludeLast is ON, the USER-VERIFIED recent slice
    // uses signalRecentFreq (which excludes the just-arrived actual) instead of
    // recentFreq. The live-recent slice is unchanged (it's a separate feed, not
    // the just-arrived user actual). This prevents the self-referential boost.
    const liveRecFreq = liveRecentN > 0 ? (liveRecentFreq.get(g.name) ?? 0) / liveRecentN : 0;
    const userRecFreq = recentHist.length > 0 ? (recentFreq.get(g.name) ?? 0) / recentHist.length : 0;
    // C9: signal-user-recFreq excludes the just-arrived actual.
    const signalUserRecFreq = signalRecentHist.length > 0
      ? (signalRecentFreq.get(g.name) ?? 0) / signalRecentHist.length
      : userRecFreq; // fallback when signalRecentHist is empty (≤1 round)
    // recFreq drives the SIGNALS (recent-active, trending, shift-adaptive).
    // When C9 ON, use signalUserRecFreq (excludes just-arrived actual).
    // When C9 OFF, signalUserRecFreq === userRecFreq (bit-for-bit baseline).
    const recFreq = useLivePrior
      ? liveRecFreq * 0.6 + (flags.c9_recencyExcludeLast ? signalUserRecFreq : userRecFreq) * 0.4
      : (flags.c9_recencyExcludeLast ? signalUserRecFreq : userRecFreq);
    const trend = recFreq - longFreq;
    const gap = gaps[g.name];
    const gapHistory = gapHistories[g.name];
    const avgGap = gapHistory.length > 0
      ? gapHistory.reduce((s, x) => s + x, 0) / gapHistory.length
      : n / Math.max(freqAll.get(g.name) ?? 1, 1);
    const isOverdue = avgGap > 0 && gap > avgGap * 1.5;
    const isHot = longFreq > theo * 1.3 && (n >= 5 || liveN >= 20);
    const isCold = longFreq < theo * 0.5 && (n >= 5 || liveN >= 20);

    // Signal-wise historical performance (when this game was predicted)
    const sw = dashboard.signalWiseHitRate[g.name];
    const sampleSize = sw.predicted;
    const signalHitRate = sw.rate;
    const wilsonLower = sw.wilsonLower; // sample-size-aware confidence

    // Volatility: variance of gap history
    let volatility = 0;
    if (gapHistory.length >= 2) {
      const mean = gapHistory.reduce((s, x) => s + x, 0) / gapHistory.length;
      volatility = gapHistory.reduce((s, x) => s + (x - mean) ** 2, 0) / gapHistory.length;
    }

    const signals: string[] = [];

    // ===== SAMPLE-SIZE STABILIZATION (Bayesian / Laplace shrinkage) =====
    // CRITICAL: Small-sample observations must NOT create extreme deviations.
    //
    // k=30 (increased from 20): rare outcomes need MORE evidence before their
    // deviation can significantly affect the score. At k=30:
    //   N=30, CRAZY TIME count=1, prior=1.85%:
    //     smoothed = (1 + 30*0.0185) / 60 = 1.09% → dev=-41% (was +48% at k=20)
    //   N=30, "1" count=12, prior=38.89%:
    //     smoothed = (12 + 30*0.389) / 60 = 39.45% → dev=+1.4% (barely changed)
    //
    // This ensures rare outcomes need substantially more observations before
    // they can displace high-prior common outcomes like "1" (38.89%) or "2" (24.07%).
    const SHRINKAGE_K = 30;

    // Compute observed count and total N for this outcome.
    // Use the larger of (user rounds, live spins) as the sample.
    const userCount = freqAll.get(g.name) ?? 0;
    const liveCount = liveFreqAll.get(g.name) ?? 0;
    // Total sample N = combined user rounds + live spins
    const sampleN = n + liveN;
    // Combined observed count (user + live, weighted by their respective N)
    const combinedCount = userCount + liveCount;

    // Laplace-smoothed frequency
    const smoothedFreq = sampleN > 0
      ? (combinedCount + SHRINKAGE_K * theo) / (sampleN + SHRINKAGE_K)
      : theo;

    // Raw (unstabilized) deviation — for debug display only
    const rawBlendedFreq = (longFreq * longW + recFreq * adaptW);
    const rawDeviation = theo > 0 ? (rawBlendedFreq - theo) / theo : 0;

    // Stabilized deviation — uses the Laplace-smoothed frequency
    const stabilizedDeviation = theo > 0 ? (smoothedFreq - theo) / theo : 0;

    // Cap stabilized deviation to prevent extreme swings: [-0.6, +2.0]
    const cappedDeviation = Math.max(-0.6, Math.min(2.0, stabilizedDeviation));

    // ===== EXPERIMENTAL: RARE-OUTCOME EVIDENCE RELIABILITY LAYER =====
    // (C2: decoupled from `mode`. Active when mode==="experimental" OR
    //  flags.c2_genericReliability. When both are OFF, identity → bit-for-bit
    //  baseline. The factor is unchanged: continuous, generic, monotonic,
    //  converges to 1, applies to ALL outcomes, positive-deviation-only,
    //  NO per-outcome hardcoded penalty — compliant with the C2 spec.)
    //
    // A small sample of rare-outcome appearances (e.g. PACHINKO 3× in 50
    // rounds) can generate a large RELATIVE deviation (+39%) that, via
    // evidenceScore = 1 + dev, displaces a substantially higher-prior
    // number outcome. This is statistically unsound: the relative
    // deviation of a rare outcome has much higher variance per observation
    // than a common outcome, so the same count implies far less confidence.
    //
    // Reliability factor (continuous, generic, NO hard cutoff):
    //   reliability = effectiveSampleSize / (effectiveSampleSize + RELIABILITY_K)
    //
    //   effectiveSampleSize = combinedCount (user rounds + live spins that
    //   landed on this outcome — the independent observations supporting
    //   THIS outcome's deviation estimate).
    //
    // Applied ONLY to the POSITIVE portion of the deviation:
    //   - Positive dev (outcome appeared MORE than prior) → dampened by
    //     reliability. A rare outcome needs many independent observations
    //     before its positive evidence can dominate a high-prior outcome.
    //   - Negative dev (outcome appeared LESS than prior) → passes through
    //     UNCHANGED. We must NOT inflate a rare outcome that hasn't
    //     appeared (that would push never-seen rare outcomes INTO Top-4,
    //     the opposite of the goal). The prior term already keeps them low.
    //
    // This is NOT recency chasing: a single recent appearance does not
    // move reliability much (count 0→1: r 0→0.09). Genuine repeated
    // evidence accumulates count → reliability rises → evidence reaches
    // full strength. A rare outcome with 8+ appearances CAN still enter.
    const experimentalActive = mode === "experimental";
    const reliabilityActive = experimentalActive || flags.c2_genericReliability;
    const effectiveSampleSize = combinedCount; // independent observations
    const reliability = reliabilityActive
      ? effectiveSampleSize / (effectiveSampleSize + RELIABILITY_K)
      : 1.0; // baseline + c2 OFF: full strength (no reliability discount)
    // Dampen positive deviation only; keep negative deviation as-is.
    const reliableDeviation = reliabilityActive
      ? (cappedDeviation > 0
          ? cappedDeviation * reliability
          : cappedDeviation)
      : cappedDeviation; // baseline + c2 OFF: identity

    // ===== BASE SCORE — BALANCED EVIDENCE + PRIOR =====
    // CRITICAL FIX: The previous 85% evidence / 15% prior ratio allowed rare
    // outcomes (CRAZY TIME 1.85%) to displace common outcomes ("1" 38.89%)
    // after just 1-2 appearances. This caused the model to UNDERPERFORM the
    // simple theoretical [1,2,5,10] baseline (53% vs 88%).
    //
    // NEW RATIO: 50% evidence / 50% prior.
    //
    // This means:
    //   - Common outcomes with NEUTRAL evidence keep ~50% of their prior weight
    //   - Rare outcomes need MUCH stronger relative evidence to overcome
    //     the prior advantage of common outcomes
    //   - A rare outcome appearing 1-2× in 30 spins will NOT displace "1" or "2"
    //   - A rare outcome appearing 5+× in 30 spins CAN still enter Top-4
    //
    // Example with N=30, k=30:
    //   "1" (prior 38.89%): smoothed=39.45%, dev=+1.4% → evidence=1.014
    //     score = 1.014*0.50 + 0.389*0.50 = 0.702
    //   CRAZY TIME (prior 1.85%): smoothed=1.09%, dev=-41% → evidence=0.59
    //     score = 0.59*0.50 + 0.0185*0.50 = 0.304
    //   → "1" (0.702) >> CRAZY TIME (0.304) — correct!
    //
    //   CRAZY TIME appearing 3× in 30: smoothed=(3+30*0.0185)/60=5.93%, dev=+221%
    //     evidence=3.21, score=3.21*0.50+0.0185*0.50=1.614
    //   "1" appearing 12× in 30: score=0.702
    //   → CRAZY TIME (1.614) > "1" (0.702) — rare outcome CAN enter when justified ✓
    //
    // EXPERIMENTAL mode: evidenceScore uses reliableDeviation (positive dev
    // dampened by sample-size reliability). Baseline mode: reliableDeviation
    // === cappedDeviation (identity), so behavior is BIT-FOR-BIT identical
    // to the frozen k=30 baseline. This guarantees a clean A/B comparison.
    const evidenceScore = 1 + reliableDeviation;
    let score = evidenceScore * 0.50 + theo * 0.50;
    if (sampleN === 0) score = theo; // no data at all → pure theoretical

    // ===== FACTOR 1: Recent active (mild adaptive signal — NOT a chase) =====
    // Appearing more than 80% of theoretical recently → mild evidence the wheel
    // is currently favouring it (regime). Capped to prevent hot-number chasing.
    // Adaptive weight applied from MISS-feedback calibration.
    //
    // C5: when c5_deScopeHarmful is ON, this raw-recent-frequency overwrite is
    // DEACTIVATED (the RCA identified it as bypassing the reliability layer).
    // The recency signal remains available for display-only via `recentFreq`.
    if (!flags.c5_deScopeHarmful && recFreq > livePrior * 0.8 && (n >= 5 || liveN >= 20)) {
      const w = sigWeights["recent-active"] ?? 1.0;
      score *= 1 + (0.10 - 1) * (1 - w) + 0.10 * w; // = 1.10 * w + (1 - w)
      signals.push("recent-active");
    }

    // ===== FACTOR 2: Trend alignment (adaptive weighting) =====
    // Recent vs long-term delta — mild evidence of regime shift. NOT a chase.
    // Adaptive weight applied from MISS-feedback calibration.
    if (trend > 0.05 && (n >= 10 || liveN >= 20)) {
      const w = sigWeights["trending-up"] ?? 1.0;
      score *= 1 + Math.min(0.12, trend * 1.5 * adaptW) * w;
      signals.push("trending-up");
    } else if (trend < -0.05 && (n >= 10 || liveN >= 20)) {
      const w = sigWeights["trending-down"] ?? 1.0;
      score *= 1 + Math.max(-0.20, trend * 1.5 * adaptW) * w;
      signals.push("trending-down");
    }

    // ===== FACTOR 3: Pattern stability bonus =====
    // Stable patterns (4+ unique in recent 10) = more predictable wheel.
    // Reliability signal, not a hot/cold bias.
    if (stability === "STABLE" && longFreq >= livePrior * 0.8) {
      score *= 1.06;
      signals.push("pattern-stable");
    }

    // ===== FACTOR 4: Wilson score confidence (sample-size-aware) =====
    // Games with verified good prediction history get a mild boost.
    // Wilson lower bound penalizes tiny samples automatically (2/2 ≠ 100%).
    if (sampleSize >= 3) {
      score *= 1 + wilsonLower * 0.25; // up to +25% for proven signals
      signals.push(`verified (${hitLabel(sampleSize, signalHitRate)})`);
    }

    // ===== FACTOR 5: Volatility penalty (reliability only — NOT overdue boost) =====
    // High gap-variance = erratic = LESS reliable → mild penalty.
    // This is NOT an overdue boost — gap is used ONLY as a stability signal.
    if (volatility > avgGap * avgGap * 1.5 && avgGap > 0) {
      score *= 0.92;
      signals.push("high-volatility");
    }

    // ===== FACTOR 6: Repeat-Pattern Analysis (DATA-BASED, NOT blind carryover) =====
    // If the last actual result was this game's name, AND this game has a
    // historically HIGH repeat rate (P(next=X|cur=X) > baseline), then give
    // a MILD evidence boost. This is NOT "last hit → predict same again" —
    // it's "this outcome has a statistical tendency to repeat, and it just
    // happened, so the evidence for continuation is slightly stronger".
    //
    // KEY RULES (per user spec):
    //   - Previous result gets NO automatic bonus (bonus = 0 by default).
    //   - Previous HIT gets NO automatic carryover.
    //   - Previous MISS gets NO automatic penalty.
    //   - Repeat is ALLOWED but ONLY when statistical evidence supports it.
    //   - Same number CAN repeat, but only if its repeat rate is above baseline.
    //
    // We compare this game's repeat rate against the baseline repeat rate.
    // Only if ABOVE baseline (and 3+ observed pairs) do we apply a mild boost.
    if (lastResultName === g.name) {
      const rs = repeatStats[g.name];
      if (rs.currentCount >= 3 && rs.rate > baselineRepeatRate * 1.15) {
        // Above baseline by 15%+ → mild evidence boost (capped at +10%).
        const excess = (rs.rate - baselineRepeatRate) / Math.max(baselineRepeatRate, 0.01);
        score *= 1 + Math.min(0.10, excess * 0.15);
        signals.push(`repeat-supported (${Math.round(rs.rate * 100)}%)`);
      } else if (rs.currentCount >= 3 && rs.rate < baselineRepeatRate * 0.5) {
        // Below baseline by 50%+ → mild evidence dampening (repeat is unlikely).
        score *= 0.95;
        signals.push(`repeat-unlikely (${Math.round(rs.rate * 100)}%)`);
      }
      // If repeat rate is near baseline → NO boost, NO penalty. Fresh ranking.
    }

    // ===== FACTOR 7: PER-OUTCOME BONUS EVIDENCE (no group boost) =====
    // CRITICAL: NO group bonus boost. Each bonus is scored INDIVIDUALLY.
    // A COIN FLIP cluster affects ONLY COIN FLIP — never transfers to
    // CASH HUNT / PACHINKO / CRAZY TIME. This prevents COIN FLIP from
    // being over-selected due to generic bonus group boosts.
    //
    // Per user spec:
    //   - NO generic bonus-elevated boost (was applying to ALL bonuses)
    //   - NO generic bonus-clustering boost (was applying to ALL bonuses)
    //   - Per-outcome recent occurrence = individual evidence
    //   - Per-outcome cluster = individual evidence
    //   - Each bonus competes on the SAME scoring framework as numbers
    if (isBonusGame(g.name)) {
      // Per-outcome recent occurrence (last 10) — INDIVIDUAL, not group
      const thisBonusRecent = bonusRecentFreq[g.name] ?? 0;
      if (combinedSeq.length >= 20 && thisBonusRecent > 0 && recentCombined.length > 0) {
        const thisBonusRate = thisBonusRecent / recentCombined.length;
        const thisBonusTheo = theo;
        // Boost only if THIS specific bonus is appearing more than 1.5× its base
        if (thisBonusRate > thisBonusTheo * 1.5) {
          score *= 1.08; // capped +8%
          signals.push(`${g.name.toLowerCase()}-recent-active`);
        }
      }
      // Per-outcome cluster detection — THIS bonus's own cluster (2+ in last 5)
      const last5ForThisBonus = combinedSeq.slice(-5);
      const thisBonusInLast5 = last5ForThisBonus.filter((n) => n === g.name).length;
      if (combinedSeq.length >= 20 && thisBonusInLast5 >= 2) {
        // This specific bonus has its own cluster — mild boost
        score *= 1.05; // capped +5%
        signals.push(`${g.name.toLowerCase()}-cluster-${thisBonusInLast5}in5`);
      }
      // NO group bonus-elevated boost
      // NO group bonus-clustering boost
      // NO group bonus-cluster-3in5 boost
    } else {
      // For NUMBER outcomes: if bonus risk is high, numbers are slightly
      // less reliable (the wheel is in a "bonus phase"). Mild dampening.
      // Requires 20+ sample AND recent bonus > 1.5× long-term.
      if (combinedSeq.length >= 20 && recentBonusRate > combinedBonusRate * 1.5) {
        score *= 0.97;
        signals.push("bonus-phase-risk");
      }
    }

    // ===================================================================
    // EXPLICITLY REMOVED (single-round last-hit carryover bias):
    //   - NO single prev-miss-dampen (one MISS → automatic penalty)
    //   - NO prev-HIT continuation (one HIT → automatic bonus)
    //   - NO overdue gap-filling boost (isOverdue → boost)
    //   - NO hot/cold z-score boost
    //
    // PERSISTENCE PENALTY after REPEATED consecutive failures.
    //
    // C5 (c5_deScopeHarmful ON):
    //   The penalty is re-evaluated so it cannot systematically punish a
    //   high-prior, well-evidenced outcome such as "1". It now fires ONLY when
    //   the outcome's evidence is weak (reliability below the gate) — i.e. only
    //   outcomes that lacked independent support to begin with get further
    //   dampened. A high-reliability number is never persistence-excluded.
    //   Uses the correct dashboard.missStreak field.
    //
    // C5 OFF (bit-for-bit baseline):
    //   The original code referenced `dashboard.consecutiveMisses`, a field
    //   that does NOT exist on PerformanceDashboard (only `missStreak` does).
    //   That reference was therefore `undefined` at runtime, so the condition
    //   `undefined >= 2` was always false and the persistence-penalty block
    //   NEVER fired (dead code). To preserve bit-for-bit baseline behavior,
    //   the block is omitted entirely when C5 is OFF — identical runtime
    //   result (no penalty, no signal) with no dead/undefined field access.
    // ===================================================================
    const PERSISTENCE_RELIABILITY_GATE = 0.5;
    if (flags.c5_deScopeHarmful) {
      if (dashboard.missStreak >= 2 && prevPredNames.includes(g.name) && reliability < PERSISTENCE_RELIABILITY_GATE) {
        // Graduated penalty: -3% per consecutive miss (capped at -15%)
        const penalty = Math.min(0.15, dashboard.missStreak * 0.03);
        score *= (1 - penalty);
        signals.push(`persistence-penalty (-${Math.round(penalty * 100)}%)`);
      }
    }
    void isOverdue;
    void isHot;
    void isCold;
    void lastHit;

    // ===== SIGNAL 9: Anomaly handling (pure relative — no prior multiplication) =====
    // C5: when c5_deScopeHarmful is ON, this raw-recent score OVERWRITE is
    // DEACTIVATED (the RCA identified `anomaly-weighted` as overriding the
    // main score with raw recent frequency, bypassing reliability). The
    // anomaly flag itself remains available for display/confidence only.
    if (!flags.c5_deScopeHarmful && dashboard.anomalyDetected) {
      const anomalyDeviation = livePrior > 0 ? (recFreq - livePrior) / livePrior : 0;
      const cappedAnomalyDev = Math.max(-0.6, Math.min(2.0, anomalyDeviation));
      const anomalyEvidence = 1 + cappedAnomalyDev * 1.5;
      score = anomalyEvidence * 0.50 + theo * 0.50;
      if (!signals.includes("anomaly-weighted")) signals.push("anomaly-weighted");
    }

    // ===== SIGNAL 10: Pattern shift handling (pure relative) =====
    // C5: when c5_deScopeHarmful is ON, this raw-recent score OVERWRITE is
    // DEACTIVATED (same rationale as SIGNAL 9 — bypassed reliability).
    if (!flags.c5_deScopeHarmful && dashboard.patternShiftDetected) {
      const shiftDeviation = livePrior > 0 ? (recFreq - livePrior) / livePrior : 0;
      const cappedShiftDev = Math.max(-0.6, Math.min(2.0, shiftDeviation));
      const shiftEvidence = 1 + cappedShiftDev * 1.3;
      score = shiftEvidence * 0.50 + theo * 0.50;
      if (!signals.includes("shift-adaptive")) signals.push("shift-adaptive");
    }

    // ===== C1/C3 EXPERIMENTAL CHANNEL (populated only when flags ON;
    //      undefined when OFF → all-flags-OFF output is bit-for-bit identical) =====
    // C1 separates four quantities that the legacy blend collapses into one:
    //   rawEvidenceScore        — the evidence term (1 + reliableDeviation)
    //   priorProbability        — the prior used in the blend (theoretical)
    //   calibratedProbabilityPosterior — a TRUE Bayesian posterior (Dirichlet-
    //                              smoothed; sums to 1 over 8 outcomes). This is
    //                              the SAME quantity as `smoothedFreq`, exposed as
    //                              a named channel. NOT the legacy rawScore/ΣrawScore.
    //   selectionScore          — the score the C4 optimizer actually selects on.
    // C3 adds explicit uncertainty-aware shrinkage toward the prior so a
    // data-starved outcome cannot create an aggressive selection-score jump.
    let c1RawEvidenceScore: number | undefined;
    let c1PriorProbability: number | undefined;
    let c1Posterior: number | undefined;
    let c1Uncertainty: number | undefined;
    let c1SelectionScore: number | undefined;
    if (flags.c1_calibratedChannel) {
      c1RawEvidenceScore = evidenceScore;
      c1PriorProbability = theo;
      c1Posterior = smoothedFreq; // genuine normalized posterior
      if (flags.c3_uncertaintyShrinkage) {
        // Uncertainty = fraction of posterior mass from the prior, not the data.
        const denomU = sampleN + SHRINKAGE_K;
        c1Uncertainty = denomU > 0 ? Math.max(0, Math.min(1, 1 - combinedCount / denomU)) : 1;
        c1SelectionScore = shrinkTowardPrior(smoothedFreq, theo, c1Uncertainty);
      } else {
        c1SelectionScore = smoothedFreq;
      }
    }

    // ===== Wheel base-probability model breakdown =====
    const basePrior = THEORETICAL[g.name] ?? 0.1;
    const segmentCount = WHEEL_SEGMENTS[g.name] ?? 1;
    const liveObservedRate = longFreq; // observed frequency (blended live + user)
    // Model adjustment = ratio of final score to base prior (how much evidence shifted it)
    const modelAdjustment = basePrior > 0 ? score / basePrior : 1;

    scores.push({
      game: g,
      rawScore: Math.max(score, 0.001),
      normalizedScore: 0, // filled after sorting
      signals,
      sampleSize,
      signalHitRate,
      wilsonLower,
      longTermFreq: longFreq,
      recentFreq: recFreq,
      trend,
      currentGap: gap,
      avgGap,
      isOverdue,
      isHot,
      isCold,
      label: "",
      // Wheel model breakdown:
      basePrior,
      segmentCount,
      liveObservedRate,
      modelAdjustment,
      finalAIScore: Math.max(score, 0.001),
      selectionReason: "", // filled after ranking
      // Full debug fields:
      observedFrequency: longFreq,
      blendedFrequency: rawBlendedFreq,
      relativeDeviation: rawDeviation,
      evidenceScorePreMultiplier: evidenceScore,
      sampleN,
      observedCount: combinedCount,
      smoothedFrequency: smoothedFreq,
      rawDeviation,
      stabilizedDeviation,
      // EXPERIMENTAL reliability layer:
      engineMode: mode,
      effectiveSampleSize,
      reliability,
      reliableDeviation,
      // C1–C7 channel (undefined when flags OFF → bit-for-bit baseline):
      rawEvidenceScore: c1RawEvidenceScore,
      priorProbability: c1PriorProbability,
      calibratedProbabilityPosterior: c1Posterior,
      uncertainty: c1Uncertainty,
      selectionScore: c1SelectionScore,
    });
  }

  // Normalize scores (so they sum to 1)
  const totalRaw = scores.reduce((s, c) => s + c.rawScore, 0);
  for (const c of scores) c.normalizedScore = totalRaw > 0 ? c.rawScore / totalRaw : 0;

  // Sort by raw score (descending) — this is the EVIDENCE ranking (for display).
  scores.sort((a, b) => b.rawScore - a.rawScore);

  // ===== Generate specific selection reasons (not generic) =====
  for (let i = 0; i < scores.length; i++) {
    const c = scores[i];
    const parts: string[] = [];
    const devPct = ((c.modelAdjustment - 1) * 100);
    if (Math.abs(devPct) > 2) {
      parts.push(`${devPct > 0 ? "+" : ""}${devPct.toFixed(1)}% vs prior`);
    }
    if (c.signals.length > 0) {
      parts.push(c.signals.slice(0, 3).join("+"));
    }
    if (c.recentFreq > c.longTermFreq + 0.02) {
      parts.push(`recent ${Math.round(c.recentFreq * 100)}% > long ${Math.round(c.longTermFreq * 100)}%`);
    }
    if (parts.length === 0) {
      parts.push(`base prior ${Math.round(c.basePrior * 100)}% (neutral)`);
    }
    c.selectionReason = parts.join(" · ");
  }

  // Assign evidence ranks + labels (1..8).
  const rankLabels = [
    "strongest evidence",
    "second strongest",
    "third strongest",
    "fourth strongest",
    "fifth — alternate",
    "sixth — weak",
    "seventh — weak",
    "weakest evidence",
  ];
  for (let i = 0; i < scores.length; i++) {
    scores[i].rank = i + 1;
    scores[i].label = rankLabels[i] ?? `rank ${i + 1}`;
  }

  return scores;
}

// ============================================================
// 70-COMBINATION SUBSET OPTIMIZER (C(8,4) = 70)
// ============================================================
/**
 * There are C(8,4) = 70 possible 4-outcome combinations.
 *
 * TWO modes (selected by `flags.c4_realOptimizer`):
 *
 *  OFF (default, bit-for-bit baseline):
 *    Objective = Σ (rawScore/ΣrawScore) over the 4 outcomes. Because ΣrawScore
 *    is constant for a round, maximizing this is provably identical to taking
 *    the 4 highest rawScores (greedy top-4-by-score). The 70-combo loop runs
 *    but adds no information. This is the frozen baseline behavior.
 *
 *  ON (C4 real optimizer):
 *    Objective considers FOUR terms, so it is genuinely capable of selecting
 *    a combination DIFFERENT from greedy top-4-by-score:
 *      objective = coverage                              // Σ calibrated prob (posterior if C1, else legacy share)
 *                - λ_uncert  · Σ uncertainty             // C3: penalize data-starved selections
 *                - λ_overreact · Σ [bonus & reliability<τ]·(τ-reliability)  // drop low-evidence bonuses
 *                + λ_diversity · entropy(normalized 4)   // reward spreading mass over a bonus-only set
 *    The winning combination is logged with the reason it won (C6 optimizerNote).
 *
 * Per user spec (Section N):
 *   P(any selected outcome occurs) = P(A) + P(B) + P(C) + P(D)
 *   (outcomes are mutually exclusive — do NOT multiply probabilities)
 *
 * No hardcoding of [1,2,5,10], no forced bonus slot, no random selection.
 */
// C4 objective hyperparameters (frozen; NOT tuned to the 178-round history —
// §10 forbids replay-fitting. These are principled defaults: coverage
// dominates; the overreaction penalty is strong enough to drop a bonus whose
// independent evidence is weak; diversity is a mild tie-breaker.)
const C4_LAMBDA_UNCERTAINTY = 0.15;
const C4_LAMBDA_OVERREACTION = 1.0;
const C4_LAMBDA_DIVERSITY = 0.05;
const C4_RELIABILITY_GATE = 0.4;

/** Shannon entropy (natural log) of a probability vector, normalized to [0,1]
 *  by ln(n). Higher = more spread = more diverse coverage. */
function normalizedEntropy(probs: number[]): number {
  const n = probs.length;
  if (n <= 1) return 0;
  const sum = probs.reduce((s, p) => s + (p > 0 ? p : 0), 0);
  if (sum <= 0) return 0;
  let h = 0;
  for (const p of probs) {
    const q = p > 0 ? p / sum : 0;
    if (q > 0) h -= q * Math.log(q);
  }
  return h / Math.log(n);
}

function selectTopByEvidence(
  candidates: CandidateScore[],
  count: number,
  flags: FeatureFlags = ALL_FLAGS_OFF,
): { combination: CandidateScore[]; optimizerNote: string } {
  // Legacy calibrated probability (normalized score share). Computed and
  // attached to the original candidates for backward compatibility (the UI
  // and shadow ledger read `calibratedProbability`). This is a SCORE SHARE,
  // NOT a true probability unless C1 is ON.
  const totalScore = candidates.reduce((s, c) => s + c.rawScore, 0);
  const calibrated = candidates.map((c) => ({
    ...c,
    calibratedProbability: totalScore > 0 ? c.rawScore / totalScore : 1 / candidates.length,
    logEvidence: c.basePrior > 0 && c.smoothedFrequency > 0
      ? Math.log(c.smoothedFrequency / c.basePrior)
      : 0,
  }));

  // Attach calibratedProbability + logEvidence to original candidates for display
  for (const c of calibrated) {
    const orig = candidates.find((x) => x.game.name === c.game.name);
    if (orig) {
      (orig as CandidateScore & { calibratedProbability?: number; logEvidence?: number }).calibratedProbability = c.calibratedProbability;
      (orig as CandidateScore & { logEvidence?: number }).logEvidence = c.logEvidence;
    }
  }

  // Helper: the probability to use for COVERAGE in the objective.
  // C1 ON → true Bayesian posterior; OFF → legacy score share (bit-for-bit).
  // C8 ON (requires C1) → 95% credible LOWER BOUND of the posterior
  //   (pLB = max(0, posterior − z·√(p(1−p)/nEff))). This is the "safe
  //   probability" from Bayesian decision theory — penalizes outcomes with
  //   high point estimates but low effective sample sizes. GENERIC: identical
  //   treatment for all 8 outcomes; no per-outcome threshold. When C8 OFF,
  //   the posterior (or legacy share) is used directly (bit-for-bit C1–C7).
  //   C8 requires C1 (needs a real posterior); if C1 is OFF, C8 is a no-op.
  const probFor = (c: typeof calibrated[number]): number => {
    if (flags.c1_calibratedChannel && typeof c.calibratedProbabilityPosterior === "number") {
      const posterior = c.calibratedProbabilityPosterior;
      if (flags.c8_credibleLowerBound) {
        // C8 ON: use the 95% credible lower bound (safe probability).
        const rel = typeof c.reliability === "number" ? c.reliability : 1.0;
        const nEff = effectiveSampleSizeFromReliability(rel);
        return credibleLowerBound(posterior, nEff);
      }
      return posterior;
    }
    return c.calibratedProbability;
  };
  // Helper: uncertainty (C3). 0 when C3 OFF → no uncertainty penalty.
  const uncertFor = (c: typeof calibrated[number]): number =>
    (flags.c3_uncertaintyShrinkage && typeof c.uncertainty === "number") ? c.uncertainty : 0;
  // Helper: reliability (C2). Falls back to 1.0 (no discount) when undefined.
  const relFor = (c: typeof calibrated[number]): number =>
    typeof c.reliability === "number" ? c.reliability : 1.0;

  // If we have exactly 8 candidates and need 4, evaluate all 70 combinations
  if (candidates.length === 8 && count === 4) {
    // Greedy top-4-by-score (the C4-OFF winner) — computed for comparison.
    const byScore = [...calibrated].sort((a, b) => b.rawScore - a.rawScore);
    const top4ByScore = byScore.slice(0, 4);
    const top4ByScoreNames = top4ByScore.map((c) => c.game.name);

    // Evaluate ALL 70 combinations.
    const allCombos: { names: string[]; coverage: number; objective: number; combo: typeof calibrated }[] = [];
    let bestCombination: typeof calibrated = [];
    let bestObjective = -Infinity;

    for (let a = 0; a < 5; a++) {
      for (let b = a + 1; b < 6; b++) {
        for (let c = b + 1; c < 7; c++) {
          for (let d = c + 1; d < 8; d++) {
            const combo = [calibrated[a], calibrated[b], calibrated[c], calibrated[d]];
            const coverage = combo.reduce((s, x) => s + probFor(x), 0);
            const uncertaintyPenalty = combo.reduce((s, x) => s + uncertFor(x), 0);
            // Overreaction penalty: only bonuses whose reliability is below the gate.
            const overreactionPenalty = combo.reduce((s, x) => {
              const isBonus = BONUS_NAMES.includes(x.game.name);
              const r = relFor(x);
              return s + (isBonus && r < C4_RELIABILITY_GATE ? (C4_RELIABILITY_GATE - r) : 0);
            }, 0);
            const diversity = normalizedEntropy(combo.map((x) => probFor(x)));
            let objective: number;
            if (flags.c4_realOptimizer) {
              objective = coverage
                - C4_LAMBDA_UNCERTAINTY * uncertaintyPenalty
                - C4_LAMBDA_OVERREACTION * overreactionPenalty
                + C4_LAMBDA_DIVERSITY * diversity;
            } else {
              // C4 OFF: degenerate objective = coverage (== ΣrawScore/ΣrawScore → greedy)
              objective = coverage;
            }
            allCombos.push({
              names: combo.map((x) => x.game.name),
              coverage,
              objective,
              combo,
            });
            if (objective > bestObjective) {
              bestObjective = objective;
              bestCombination = combo;
            }
          }
        }
      }
    }

    // Sort all 70 combinations by objective descending
    allCombos.sort((a, b) => b.objective - a.objective);

    // Sort the best combination by selection probability descending.
    // C1 ON → posterior; OFF → legacy calibratedProbability (rawScore share).
    const sortProb = flags.c1_calibratedChannel
      ? (x: typeof calibrated[number]) => (typeof x.calibratedProbabilityPosterior === "number" ? x.calibratedProbabilityPosterior : x.calibratedProbability)
      : (x: typeof calibrated[number]) => x.calibratedProbability;
    bestCombination.sort((a, b) => sortProb(b) - sortProb(a));

    const bestNames = bestCombination.map((c) => c.game.name);
    const match = JSON.stringify([...top4ByScoreNames].sort()) === JSON.stringify([...bestNames].sort());

    // ===== DEBUG OUTPUT =====
    console.log("===== 70-COMBINATION OPTIMIZER DEBUG =====");
    console.log(`Mode: ${flags.c4_realOptimizer ? "C4 REAL optimizer (coverage + uncertainty + overreaction + diversity)" : "C4 OFF (degenerate Σ-probability ≡ greedy top-4-by-score)"}`);
    console.log("All 8 calibrated probabilities:");
    for (const c of calibrated) {
      const post = flags.c1_calibratedChannel && typeof c.calibratedProbabilityPosterior === "number"
        ? `posterior=${(c.calibratedProbabilityPosterior * 100).toFixed(2)}%` : "";
      console.log(`  ${c.game.name.padEnd(12)}: calProb=${(c.calibratedProbability * 100).toFixed(2)}%  ${post}  score=${c.rawScore.toFixed(4)}  rel=${(relFor(c)).toFixed(2)}  uncert=${uncertFor(c).toFixed(2)}`);
    }
    console.log(`Top-4 by individual score: [${top4ByScoreNames.join(", ")}]`);
    console.log(`Optimizer result:           [${bestNames.join(", ")}] objective=${bestObjective.toFixed(4)}`);
    console.log(`Top 3 combinations:`);
    for (let i = 0; i < Math.min(3, allCombos.length); i++) {
      console.log(`  #${i + 1}: [${allCombos[i].names.join(", ")}] obj=${allCombos[i].objective.toFixed(4)} cov=${(allCombos[i].coverage * 100).toFixed(2)}%`);
    }
    console.log(`Optimizer matches top-4-by-score: ${match ? "YES (same set)" : "NO (different set — optimizer wins)"}`);
    console.log("===== END OPTIMIZER DEBUG =====");

    // Build the C6 optimizerNote: WHY the winning combo won.
    const winCombo = bestCombination;
    const winCoverage = winCombo.reduce((s, x) => s + probFor(x), 0);
    const winUncert = winCombo.reduce((s, x) => s + uncertFor(x), 0);
    const winOverreact = winCombo.reduce((s, x) => {
      const isBonus = BONUS_NAMES.includes(x.game.name);
      const r = relFor(x);
      return s + (isBonus && r < C4_RELIABILITY_GATE ? (C4_RELIABILITY_GATE - r) : 0);
    }, 0);
    const winDiversity = normalizedEntropy(winCombo.map((x) => probFor(x)));
    const optimizerNote = flags.c4_realOptimizer
      ? `C4 real optimizer won [${bestNames.join(", ")}]: coverage=${(winCoverage * 100).toFixed(2)}%, ` +
        `uncertaintyPenalty=${(C4_LAMBDA_UNCERTAINTY * winUncert).toFixed(3)}, ` +
        `overreactionPenalty=${(C4_LAMBDA_OVERREACTION * winOverreact).toFixed(3)}, ` +
        `diversityBonus=${(C4_LAMBDA_DIVERSITY * winDiversity).toFixed(3)}, ` +
        `objective=${bestObjective.toFixed(4)}. ` +
        `${match ? "Same set as greedy top-4-by-score." : "DIFFERS from greedy top-4-by-score — optimizer selected a different combination."}`
      : `C4 OFF (degenerate): objective = Σ probability ≡ greedy top-4-by-score. Selected [${bestNames.join(", ")}] (matches top-4-by-score: ${match ? "YES" : "NO"}).`;

    return { combination: bestCombination, optimizerNote };
  }

  // Fallback: take top N by score (fewer than 8 candidates)
  const fallbackCombo = calibrated.slice(0, count).sort((a, b) => b.rawScore - a.rawScore);
  return { combination: fallbackCombo, optimizerNote: `Fallback top-${count}-by-score (fewer than 8 candidates).` };
}

function hitLabel(sampleSize: number, rate: number): string {
  if (sampleSize < 3) return "insufficient";
  if (rate >= 0.6) return "strong";
  if (rate >= 0.4) return "moderate";
  return "weak";
}

// ============================================================
// HONEST CONFIDENCE — strictly sample-size-aware, never fake 100%
// ============================================================
/**
 * Confidence is HONEST: it never reports 70%, 90%, or 100% merely because
 * the last few rounds were HITs. Confidence caps are tied to sample-size
 * tiers (5/10/20/50/100+ rounds):
 *
 *   n < 5        → INSUFFICIENT DATA, cap 25% (honest low)
 *   n < 10       → cap 40% (early data, LOW CONFIDENCE)
 *   n < 20       → cap 55% (MODERATE only with strong evidence)
 *   n < 50       → cap 70% (can reach STRONG with proven record)
 *   n < 100      → cap 78% (large sample, higher trust)
 *   n >= 100     → cap 85% (only very large samples approach high confidence)
 *
 * 4/4 HIT must NEVER be treated as proof of 100% predictive accuracy.
 * Wilson lower bound is used as the honest base (penalizes tiny samples).
 */
function honestConfidence(dashboard: PerformanceDashboard, triggered: boolean): number {
  const n = dashboard.sampleSize;
  // ===== Sample-size tier caps (strict — prevents fake high confidence) =====
  let maxConf: number;
  if (n < 5) {
    return 24; // INSUFFICIENT DATA — too few rounds for any confidence claim
  } else if (n < 10) {
    maxConf = 40; // early data — LOW CONFIDENCE only
  } else if (n < 20) {
    maxConf = 55; // MODERATE only with strong evidence
  } else if (n < 50) {
    maxConf = 70; // can reach STRONG with proven record
  } else if (n < 100) {
    maxConf = 78; // large sample, higher trust
  } else {
    maxConf = 85; // only very large samples approach high confidence
  }
  // Use Wilson lower bound of long-term hit-rate as the honest base.
  // This naturally penalizes small samples (4/4 → Wilson ~34%, NOT 100%).
  const wilson = wilsonLowerBound(dashboard.hits, n);
  // Blend with recent hit-rate (adaptive weighting) — but recent is capped.
  const adaptive = dashboard.adaptiveWeight;
  const blended = wilson * (1 - adaptive * 0.4) + dashboard.recentHitRate * (adaptive * 0.4);
  let conf = Math.round(blended * 100);
  // After a MISS, dampen (model just failed, recalibrating).
  if (triggered) conf -= 8;
  // Penalize instability.
  if (dashboard.modelStability < 40) conf -= 5;
  // Penalize anomaly/pattern shift.
  if (dashboard.anomalyDetected || dashboard.patternShiftDetected) conf -= 5;
  // NOTE: No HIT-streak boost — a few HITs must NOT inflate confidence.
  return Math.max(15, Math.min(maxConf, conf));
}

function confidenceLabelOf(confidence: number, n: number): { label: string; color: string } {
  // STRONG requires both high confidence AND sufficient sample size.
  // 4/4 HIT must NEVER produce a STRONG label.
  if (n < 5) return { label: "INSUFFICIENT DATA", color: "#5a6a99" };
  if (n < 20 && confidence < 55) return { label: "LOW CONFIDENCE", color: "#ffa502" };
  if (n < 50 && confidence < 70) return { label: confidence >= 45 ? "MODERATE" : "LOW CONFIDENCE", color: confidence >= 45 ? "#448AFF" : "#ffa502" };
  if (confidence >= 70 && n >= 20) return { label: "STRONG", color: "#2ed573" };
  if (confidence >= 45) return { label: "MODERATE", color: "#448AFF" };
  return { label: "LOW CONFIDENCE", color: "#ffa502" };
}

// ============================================================
// MAIN ENGINE ENTRY POINT
// ============================================================
/**
 * Run the full CORE ENGINE pipeline and produce the unified EngineOutput.
 *
 * @param rounds      Verified round history (oldest→newest).
 * @param prevPredNames  The 4 game names of the prediction that was ACTIVE
 *                       when the latest result arrived. Used for RCA +
 *                       recalibration (prev-miss dampen / prev-hit confirm).
 * @param lastHit     Whether the LAST round was a HIT (null = no rounds).
 * @param recalibrated True if the engine should treat this as a recalibration
 *                     cycle (i.e. previous round was a MISS and we are now
 *                     producing the post-MISS prediction).
 * @param liveSpins   REAL casino spins from CasinoScores API (optional).
 *                    When 20+ spins are provided, the engine uses real casino
 *                    frequency as the long-term prior — producing data-driven,
 *                    VARIED predictions instead of always [1,2,5,10].
 */
export function runEngine(
  rounds: RoundResult[],
  prevPredNames: string[] = [],
  lastHit: boolean | null = null,
  recalibrated = false,
  recalibrationReason = "",
  liveSpins: SpinData[] = [],
  mode: EngineMode = "baseline",
  flags: FeatureFlags = ALL_FLAGS_OFF,
): EngineOutput {
  const dashboard = buildDashboard(rounds, liveSpins);
  const anomaly = detectAnomaly(rounds);
  const patternShift = detectPatternShift(rounds);

  // Consecutive MISS / HIT
  let consecutiveMisses = 0;
  let consecutiveHits = 0;
  if (rounds.length > 0) {
    const last = rounds[rounds.length - 1];
    if (last.hit) {
      for (let i = rounds.length - 1; i >= 0; i--) {
        if (rounds[i].hit) consecutiveHits++;
        else break;
      }
    } else {
      for (let i = rounds.length - 1; i >= 0; i--) {
        if (!rounds[i].hit) consecutiveMisses++;
        else break;
      }
    }
  }

  // RCA — only on MISS (lastHit === false). If no rounds yet, no RCA.
  const lastRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  let rca: RcaAnalysis | null = null;
  let lastResult = "—";
  let previousPrediction: string[] = [];
  if (lastRound) {
    lastResult = lastRound.actualResult.name;
    previousPrediction = lastRound.prediction.map((p) => p.game.name);
    if (!lastRound.hit) {
      rca = runRca(rounds, lastRound, consecutiveMisses, anomaly, patternShift);
    }
  }

  // Score all 8 candidates using the multi-signal evidence engine.
  // Pass REAL casino spins so the prior reflects actual observed frequency.
  // `flags` activate the C1–C7 experimental channel (all OFF = bit-for-bit baseline).
  const candidates = scoreCandidates(rounds, dashboard, prevPredNames, lastHit, liveSpins, mode, flags);

  // ===== EVIDENCE-RANKED TOP-4 SELECTION (pure, no fixed slots) =====
  // Rank ALL 8 candidates by their complete AI evidence score (no fixed top-2,
  // no weighted random, no last-hit carry-over). Select the 4 strongest CURRENT
  // evidence combinations. The top 4 changes NATURALLY when the evidence changes.
  // C4: when c4_realOptimizer is ON, the 70-combination optimizer uses a real
  // objective (coverage + uncertainty + reliability + diversity) and CAN pick
  // a different combination than greedy top-4-by-score. When OFF, identical.
  //
  // SSR SAFETY: When there is NO real data (no rounds AND no liveSpins), return
  // empty predictions — the client-side generatePrediction effect populates
  // them after mount (avoids hydration mismatch).
  const hasData = rounds.length > 0 || liveSpins.length > 0;
  const optimizerResult = hasData ? selectTopByEvidence(candidates, SIGNAL_COUNT, flags) : { combination: [], optimizerNote: "no data" };
  const sampled = optimizerResult.combination;
  const optimizerNote = optimizerResult.optimizerNote;
  const sampledSet = new Set(sampled.map((c) => c.game.name));
  const excluded = candidates.filter((c) => !sampledSet.has(c.game.name));
  // Already sorted by evidence rank in scoreCandidates — strongest first.
  const top4 = [...sampled];

  // Honest confidence
  const triggered = recalibrated || (lastHit === false);
  const confidence = honestConfidence(dashboard, triggered);
  const { label: confidenceLabel } = confidenceLabelOf(confidence, rounds.length);

  // Decision + status
  let status: EngineOutput["status"];
  let decision: EngineOutput["decision"];
  if (rounds.length === 0) {
    status = "READY";
    decision = "BET"; // always provide a prediction
  } else if (consecutiveMisses >= 3) {
    status = "RECALIBRATE";
    decision = "RECALIBRATE";
  } else if (rounds.length < 3) {
    status = "READY";
    decision = "BET";
  } else {
    status = "READY";
    decision = "BET";
  }

  // Risk level
  let riskLevel: EngineOutput["riskLevel"];
  if (consecutiveMisses >= 2 || confidence < 30 || dashboard.modelStability < 30) {
    riskLevel = "HIGH";
  } else if (confidence >= 50 && dashboard.predictionHitRate >= 0.4 && dashboard.modelStability >= 50) {
    riskLevel = "LOW";
  } else {
    riskLevel = "MEDIUM";
  }

  // Excluded analysis (only on MISS)
  let excludedAnalysis: string | null = null;
  if (lastHit === false && excluded.length > 0) {
    const evidenceParts: string[] = [];
    const recentSlice = rounds.slice(-10).map((r) => r.actualResult.name);
    for (const c of excluded) {
      const rc = recentSlice.filter((n) => n === c.game.name).length;
      if (rc > 0) evidenceParts.push(`${c.game.name} (${rc}× in last 10)`);
    }
    excludedAnalysis = evidenceParts.length > 0
      ? `Excluded outcomes with recent evidence: ${evidenceParts.join(", ")}. NOT treated as a bet signal — only flagged for RCA / anomaly monitoring.`
      : `Excluded outcomes [${excluded.map((c) => c.game.name).join(", ")}] have no recent evidence. No opposite-signal switching.`;
  }

  // WHY THIS MOVE
  const useLivePrior = liveSpins.length >= 20;
  const whyParts: string[] = [];
  if (rounds.length === 0 && !useLivePrior) {
    whyParts.push("No data yet — predicting with theoretical priors + weighted probabilistic sampling.");
  } else if (useLivePrior && rounds.length === 0) {
    whyParts.push(`Real casino data: ${liveSpins.length} spins analyzed. Fresh ranking — no last-hit carryover.`);
  } else if (rounds.length < 3) {
    whyParts.push(`Building baseline (${rounds.length} round${rounds.length !== 1 ? "s" : ""})${useLivePrior ? ` + ${liveSpins.length} real spins` : ""} — fresh evidence-weighted ranking.`);
  } else {
    // CORE: Every round is a FRESH ranking. Previous HIT/MISS does NOT
    // auto-carry the same outcome forward. No "last hit → same number" shortcut.
    if (lastHit === true) {
      whyParts.push(`Previous HIT — but NO automatic carryover. Fresh ranking from all evidence.`);
    } else if (lastHit === false) {
      whyParts.push(`Previous MISS — fresh ranking. RCA: ${rca?.cause ?? "unknown"}. No auto-exclude.`);
    }
    whyParts.push(`Hit-rate: ${Math.round(dashboard.predictionHitRate * 100)}% (${dashboard.hits}/${dashboard.totalRounds})`);
    whyParts.push(`Recent (5): ${Math.round(dashboard.recentHitRate * 100)}% • Recent (10): ${Math.round(dashboard.recentHitRateLong * 100)}%`);
    whyParts.push(`Stability: ${dashboard.modelStability}% • Adaptive weight: ${Math.round(dashboard.adaptiveWeight * 100)}%`);
    // Sample-size tier disclosure (honest — no fake high confidence from few rounds)
    const tierN = dashboard.sampleSize;
    const tierLabel = tierN < 5 ? "INSUFFICIENT (<5)"
      : tierN < 10 ? "EARLY (<10) — LOW CONFIDENCE cap 40%"
      : tierN < 20 ? "BUILDING (<20) — MODERATE cap 55%"
      : tierN < 50 ? "ESTABLISHED (<50) — can reach STRONG cap 70%"
      : tierN < 100 ? "LARGE (<100) — cap 78%"
      : "MATURE (100+) — cap 85%";
    whyParts.push(`Sample tier: ${tierLabel} (n=${tierN})`);
    if (useLivePrior) whyParts.push(`Real casino prior: ${liveSpins.length} spins — observed frequency drives selection`);
    whyParts.push(`Top evidence: ${top4[0]?.signals.join("+") || "theoretical"}`);
    if (dashboard.anomalyDetected) whyParts.push(`⚠ Anomaly detected — χ²=${anomaly.statistic.toFixed(1)}`);
    if (dashboard.patternShiftDetected) whyParts.push(`⚠ Pattern shift — recent data weighted higher`);
  }
  // Always emphasize: fresh ranking, no last-hit shortcut, no fake accuracy.
  whyParts.push("FRESH evidence-ranked top-4 — no fixed slots, no last-hit/HOT/OVERDUE bias.");
  if (dashboard.sampleSize < 20) {
    whyParts.push(`Honest disclaimer: ${dashboard.sampleSize} rounds is INSUFFICIENT for any accuracy claim — early data only.`);
  }

  // VALIDATION CRITERIA
  const validationCriteria =
    `Next actual result must match one of [${top4.map((c) => c.game.name).join(", ")}] for HIT. ` +
    `Any other result = MISS → triggers RCA + recalibration. ` +
    `Prediction is STABLE until the next live result arrives — no mid-round changes.`;

  // Build final prediction objects (THE source of truth).
  // Each prediction shows its EVIDENCE rank + label (honest — reflects actual
  // signal strength, not sampling order).
  const now = Date.now();
  const predictions = top4.map((c, i) => ({
    game: c.game,
    confidence,
    time: now,
    rank: i + 1,
    label: c.label,
    signals: c.signals,
  }));

  // ===== C6 — LOCKED RCA RECORD (per-locked-Top-4 instrumentation) =====
  // Built only when c6_rcaInstrumentation is ON. Captures the full scoring
  // state of all 8 outcomes so ANY future MISS can be reconstructed exactly:
  // scores, calibrated probabilities, uncertainty/reliability, the winning 4,
  // the excluded #5, why each outcome entered/lost, the active flags, the
  // model version, and the optimizer's reason for the winning combination.
  // (actual+hit are reconciled later by the shadow/walk-forward ledger.)
  let lockedRca: LockedRcaRecord | null = null;
  if (flags.c6_rcaInstrumentation) {
    const selectedSet = new Set(top4.map((c) => c.game.name));
    // Rank all 8 by the SAME probability the optimizer used to sort the winner.
    const rankProb = (c: CandidateScore): number => {
      if (flags.c1_calibratedChannel && typeof c.calibratedProbabilityPosterior === "number") {
        return c.calibratedProbabilityPosterior;
      }
      return (c as CandidateScore & { calibratedProbability?: number }).calibratedProbability ?? c.rawScore;
    };
    const rankedAll = [...candidates].sort((a, b) => rankProb(b) - rankProb(a));
    const allOutcomes: LockedOutcomeEntry[] = rankedAll.map((c, i) => {
      const selected = selectedSet.has(c.game.name);
      const selScore = typeof c.selectionScore === "number" ? c.selectionScore : c.rawScore;
      // C8: effective sample size + 95% credible lower bound on the posterior.
      const rel = typeof c.reliability === "number" ? c.reliability : 1.0;
      const nEff = effectiveSampleSizeFromReliability(rel);
      const posterior = c.calibratedProbabilityPosterior;
      const lowerBound = (flags.c8_credibleLowerBound && typeof posterior === "number")
        ? credibleLowerBound(posterior, nEff)
        : undefined;
      const reason = selected
        ? `Selected rank ${i + 1} (selScore=${selScore.toFixed(4)}${c.signals.length ? "; signals: " + c.signals.slice(0, 4).join("+") : ""}).`
        : `Excluded rank ${i + 1} (selScore=${selScore.toFixed(4)}) — displaced by a stronger 4-combination per the optimizer objective.`;
      return {
        name: c.game.name,
        rank: i + 1,
        selected,
        rawScore: c.rawScore,
        rawEvidenceScore: c.rawEvidenceScore,
        priorProbability: c.priorProbability,
        calibratedProbability: (c as CandidateScore & { calibratedProbability?: number }).calibratedProbability,
        calibratedProbabilityPosterior: c.calibratedProbabilityPosterior,
        reliability: c.reliability,
        uncertainty: c.uncertainty,
        selectionScore: c.selectionScore,
        effectiveSampleSize: nEff,
        lowerBoundProbability: lowerBound,
        reason,
      };
    });
    const excludedFifth = rankedAll.find((c) => !selectedSet.has(c.game.name))?.game.name ?? "";
    lockedRca = {
      modelVersion: MODEL_VERSION,
      flags: { ...flags },
      engineMode: mode,
      timestamp: now,
      winningCombination: top4.map((c) => c.game.name),
      excludedFifth,
      allOutcomes,
      optimizerNote,
    };
  }

  return {
    predictions,
    excludedOutcomes: excluded.map((c) => c.game),
    nextSignalNames: top4.map((c) => c.game.name),
    excludedNames: excluded.map((c) => c.game.name),
    dashboard,
    candidateScores: candidates,
    status,
    decision,
    confidence,
    confidenceLabel,
    riskLevel,
    lastResult,
    lastHit,
    previousPrediction,
    consecutiveMisses,
    consecutiveHits,
    rca,
    excludedAnalysis,
    whyThisMove: whyParts.join(" • "),
    validationCriteria,
    recalibrated,
    recalibrationReason,
    // C1–C7 channel output:
    flags: { ...flags },
    modelVersion: MODEL_VERSION,
    lockedRca,
  };
}

// ============================================================
// RECALIBRATION TRIGGER — produces a fresh EngineOutput after a MISS
// ============================================================
/**
 * After a MISS, this builds the next EngineOutput with recalibration flags set.
 * It re-scores candidates using the FULL history (including the MISS just
 * recorded) and returns a fresh prediction set + dashboard.
 */
export function recalibrate(rounds: RoundResult[], reason: string, liveSpins: SpinData[] = [], mode: EngineMode = "baseline", flags: FeatureFlags = ALL_FLAGS_OFF): EngineOutput {
  const last = rounds[rounds.length - 1];
  const prevPredNames = last ? last.prediction.map((p) => p.game.name) : [];
  const lastHit = last ? last.hit : null;
  return runEngine(rounds, prevPredNames, lastHit, true, reason, liveSpins, mode, flags);
}

/**
 * Build the INITIAL engine output (no verified rounds yet, or after a HIT).
 * Used for GET SIGNAL. Pass REAL casino spins to drive data-driven predictions.
 */
export function buildInitial(rounds: RoundResult[], liveSpins: SpinData[] = [], mode: EngineMode = "baseline", flags: FeatureFlags = ALL_FLAGS_OFF): EngineOutput {
  const last = rounds[rounds.length - 1];
  const prevPredNames = last ? last.prediction.map((p) => p.game.name) : [];
  const lastHit = last ? last.hit : null;
  return runEngine(rounds, prevPredNames, lastHit, false, "", liveSpins, mode, flags);
}

/**
 * SHARED PREDICTION FUNCTION — single source of truth for both
 * NEXT PREDICTION (live) and ROUND-BY-ROUND (walk-forward backtest).
 */
export function buildPredictionFromHistory(
  rounds: RoundResult[],
  liveSpins: SpinData[] = [],
): EngineOutput {
  return buildInitial(rounds, liveSpins, "baseline", ALL_FLAGS_OFF);
}

/**
 * Walk-forward state — the EXACT state used by runFrozenWalkForward.
 */
export interface WalkForwardState {
  rounds: RoundResult[];
  prevPredNames: string[];
  lastHit: boolean | null;
  liveSpins: SpinData[];
}

/**
 * Deterministic replay: re-run the engine for a specific historical round
 * using the EXACT same state as runFrozenWalkForward.
 *
 * V2.5B-5: Uses runEngine directly with the same prevPredNames/lastHit
 * computation as FWF — NOT buildInitial (which may compute them differently).
 */
export function replayPrediction(
  preRoundHistory: RoundResult[],
  liveSpins: SpinData[] = [],
): EngineOutput {
  const prevPredNames = preRoundHistory.length > 0
    ? preRoundHistory[preRoundHistory.length - 1].prediction.map((p) => p.game.name)
    : [];
  const lastHit = preRoundHistory.length > 0
    ? preRoundHistory[preRoundHistory.length - 1].hit
    : null;
  return runEngine(preRoundHistory, prevPredNames, lastHit, false, "", liveSpins, "baseline", ALL_FLAGS_OFF);
}

// ============================================================
// RETROSPECTIVE DIAGNOSTIC — replay a result sequence in BOTH modes
// ============================================================
/**
 * Replays a sequence of actual result names through the engine in BOTH
 * baseline and experimental modes, round-by-round, with NO data leakage
 * (each prediction is computed from the history BEFORE that round's result).
 *
 * IMPORTANT: This is a RETROSPECTIVE / SIMULATION diagnostic ONLY.
 *   - Do NOT call the result a "new validation".
 *   - Do NOT claim improved accuracy from this test.
 *   - It estimates DIRECTION and MAGNITUDE of the reliability layer's effect.
 *   - Genuine validation requires fresh out-of-sample rounds (live A/B).
 *
 * @param actualNames  Sequence of actual result names (oldest→newest).
 * @param liveSpins    Real casino spins (shared prior for both modes).
 * @returns Per-mode hit/miss, per-outcome inclusion counts, PACHINKO
 *          inclusion/coverage, 1/2/5/10 exclusion rates, and the rounds
 *          where experimental flipped a baseline MISS into a HIT (or vice
 *          versa).
 */
export interface RetroOutcomeStat {
  name: string;
  inclusions: number;     // rounds where this outcome was in Top-4
  actuals: number;        // rounds where this was the actual result
  coveredActuals: number; // actuals that were in Top-4 (covered)
}
export interface RetroModeResult {
  mode: EngineMode;
  hits: number;
  misses: number;
  hitRate: number;          // 0..1
  totalRounds: number;
  perOutcome: RetroOutcomeStat[];
  pachinkoInclusions: number;
  pachinkoActuals: number;
  pachinkoCoveredActuals: number;
  exclusionRates: Record<string, number>; // for 1/2/5/10: fraction of rounds excluded
  rounds: Array<{
    idx: number;
    actual: string;
    preds: string[];
    hit: boolean;
  }>;
}
export interface RetroDiagnostic {
  baseline: RetroModeResult;
  experimental: RetroModeResult;
  flipsToHit: number;     // baseline MISS → experimental HIT
  flipsToMiss: number;    // baseline HIT → experimental MISS
  pachinkoInclusionsRemoved: number;
  pachinkoActualsRetained: number; // experimental still covered actual PACHINKO rounds
  exclusionPrevented: Record<string, number>; // for 1/2/5/10: rounds experimental kept it in Top-4 when baseline excluded
  note: string;
}

function gameByName(name: string): GameModel {
  return GAMES.find((g) => g.name === name) ?? GAMES[0];
}

export function runRetrospectiveDiagnostic(
  actualNames: string[],
  liveSpins: SpinData[] = [],
): RetroDiagnostic {
  const runMode = (mode: EngineMode): RetroModeResult => {
    const rounds: RoundResult[] = [];
    const perOutcomeMap = new Map<string, RetroOutcomeStat>();
    for (const g of GAMES) perOutcomeMap.set(g.name, { name: g.name, inclusions: 0, actuals: 0, coveredActuals: 0 });
    const roundLog: RetroModeResult["rounds"] = [];
    let hits = 0;
    let misses = 0;
    let pachinkoInclusions = 0;
    let pachinkoActuals = 0;
    let pachinkoCoveredActuals = 0;
    const exclusionCounts: Record<string, number> = { "1": 0, "2": 0, "5": 0, "10": 0 };

    for (let i = 0; i < actualNames.length; i++) {
      const actualName = actualNames[i];
      const actualGame = gameByName(actualName);
      // Build the prediction from history BEFORE this round (no leakage).
      const prevPredNames = rounds.length > 0
        ? rounds[rounds.length - 1].prediction.map((p) => p.game.name)
        : [];
      const lastHit = rounds.length > 0 ? rounds[rounds.length - 1].hit : null;
      const eng = runEngine(rounds, prevPredNames, lastHit, false, "", liveSpins, mode);
      const preds = eng.predictions.map((p) => p.game);
      const predNames = preds.map((p) => p.name);
      const hit = predNames.includes(actualName);
      // Record inclusion stats for THIS prediction set.
      for (const name of predNames) {
        const st = perOutcomeMap.get(name);
        if (st) st.inclusions++;
      }
      if (predNames.includes("PACHINKO")) pachinkoInclusions++;
      for (const num of ["1", "2", "5", "10"]) {
        if (!predNames.includes(num)) exclusionCounts[num]++;
      }
      // Settle.
      const round: RoundResult = {
        prediction: preds.map((g, idx) => ({ game: g, confidence: 50, time: Date.now() + i, rank: idx + 1 })),
        actualResult: actualGame,
        hit,
        time: Date.now() + i,
        confidence: 50,
        recalibrated: false,
      };
      rounds.push(round);
      if (hit) hits++; else misses++;
      // Track actuals + coverage.
      const st = perOutcomeMap.get(actualName);
      if (st) {
        st.actuals++;
        if (hit) st.coveredActuals++;
      }
      if (actualName === "PACHINKO") {
        pachinkoActuals++;
        if (hit) pachinkoCoveredActuals++;
      }
      roundLog.push({ idx: i + 1, actual: actualName, preds: predNames, hit });
    }

    const perOutcome = GAMES.map((g) => perOutcomeMap.get(g.name)!);
    const totalRounds = actualNames.length;
    const exclusionRates: Record<string, number> = {};
    for (const num of ["1", "2", "5", "10"]) {
      exclusionRates[num] = totalRounds > 0 ? exclusionCounts[num] / totalRounds : 0;
    }
    return {
      mode,
      hits,
      misses,
      hitRate: totalRounds > 0 ? hits / totalRounds : 0,
      totalRounds,
      perOutcome,
      pachinkoInclusions,
      pachinkoActuals,
      pachinkoCoveredActuals,
      exclusionRates,
      rounds: roundLog,
    };
  };

  const baseline = runMode("baseline");
  const experimental = runMode("experimental");

  // Compare round-by-round.
  let flipsToHit = 0;
  let flipsToMiss = 0;
  let pachinkoActualsRetained = 0;
  const exclusionPrevented: Record<string, number> = { "1": 0, "2": 0, "5": 0, "10": 0 };
  const minLen = Math.min(baseline.rounds.length, experimental.rounds.length);
  for (let i = 0; i < minLen; i++) {
    const b = baseline.rounds[i];
    const e = experimental.rounds[i];
    if (!b.hit && e.hit) flipsToHit++;
    if (b.hit && !e.hit) flipsToMiss++;
    // PACHINKO actuals retained by experimental
    if (b.actual === "PACHINKO" && e.hit) pachinkoActualsRetained++;
    // Exclusion prevented: baseline excluded num, experimental included it.
    for (const num of ["1", "2", "5", "10"]) {
      if (!b.preds.includes(num) && e.preds.includes(num)) exclusionPrevented[num]++;
    }
  }

  return {
    baseline,
    experimental,
    flipsToHit,
    flipsToMiss,
    pachinkoInclusionsRemoved: baseline.pachinkoInclusions - experimental.pachinkoInclusions,
    pachinkoActualsRetained,
    exclusionPrevented,
    note: "RETROSPECTIVE SIMULATION — estimates direction/magnitude only. NOT a validation result. Genuine validation requires fresh out-of-sample live A/B rounds.",
  };
}

// ============================================================
// C7 — FROZEN WALK-FORWARD VALIDATION HARNESS (build path ONLY)
// ============================================================
// Replays a FRESH sequence of actual result names through the engine TWICE in
// parallel — once with ALL C-FLAGS OFF (bit-for-bit baseline) and once with
// the supplied `flags` (the experimental channel) — round by round, with NO
// data leakage (each prediction is computed from history BEFORE that round's
// result), ONE prediction per unique live result, NO stale state, NO
// duplicate settlement, and NO mid-test tuning (flags are FROZEN for the
// whole run). Both arms see the IDENTICAL fresh rounds.
//
// Computes, per arm: HIT/MISS, theoretical [1,2,5,10] benchmark, bonus
// inclusion rate, number exclusion rate, per-outcome inclusion/hit efficiency.
// Then a McNemar paired test compares the two arms on the discordant rounds.
//
// *** THIS IS A HARNESS, NOT A CLAIM. *** Do not call any number it returns
// a "validated improvement". Per §11/§12 of the directive, a real validation
// requires 100+ genuinely NEW paired live rounds with the model FROZEN. This
// function is the PATH for that; it does not assert success. The historical
// 178-round set is diagnostic evidence only (§10 forbids replay-fitting).
export interface FwfOutcomeStat {
  name: string;
  inclusions: number;     // rounds where this outcome was in Top-4
  actuals: number;        // rounds where this was the actual result
  coveredActuals: number; // actuals that were in Top-4 (covered)
  hitEfficiency: number;  // coveredActuals / inclusions (0..1; higher = less waste)
}
export interface FwfArmResult {
  label: string;                 // "baseline" | "experimental"
  flags: FeatureFlags;
  hits: number;
  misses: number;
  hitRate: number;              // 0..1
  totalRounds: number;
  bonusInclusions: number;      // sum of bonus outcomes included across rounds
  bonusInclusionRate: number;  // bonusInclusions / (totalRounds*4)
  numberExclusionRate: Record<string, number>; // for 1/2/5/10: fraction of rounds excluded
  perOutcome: FwfOutcomeStat[];
  rounds: Array<{ idx: number; actual: string; preds: string[]; hit: boolean; theoHit: boolean }>;
}
export interface McNemarResult {
  r: number;            // baseline HIT & experimental MISS (discordant)
  s: number;            // baseline MISS & experimental HIT (discordant)
  statistic: number;    // chi-square 1 df (with continuity correction)
  pValue: number;       // two-sided
  significant: boolean; // p < 0.05
  note: string;
}
export interface FrozenWalkForwardResult {
  baseline: FwfArmResult;
  experimental: FwfArmResult;
  theoretical: { hits: number; hitRate: number };  // [1,2,5,10] benchmark on same rounds
  mcnemar: McNemarResult;
  flipsToHit: number;     // baseline MISS → experimental HIT
  flipsToMiss: number;    // baseline HIT → experimental MISS
  freshRounds: number;
  modelVersion: string;
  note: string;           // explicit "NOT a validation claim" disclaimer
}

/** Lower incomplete gamma for McNemar p-value (chi-square 1 df). For 1 df,
 *  the survival function P(X > x) = erfc(sqrt(x/2)). This is an exact,
 *  dependency-free implementation via the complementary error function
 *  series. Accurate to ~1e-9 over the relevant range. */
function chiSquare1dfSurvival(x: number): number {
  if (x <= 0) return 1;
  // P(X_1 > x) = 2 * (1 - Φ(√x)) = erfc(√(x/2))
  return erfc(Math.sqrt(x / 2));
}
/** Complementary error function (erfc) — Abramowitz & Stegun 7.1.26
 *  approximation, evaluated via Horner's method on the coefficient array to
 *  avoid paren-matching ambiguity. Accurate to ~1e-7 over the McNemar range. */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  // A&S 7.1.26 coefficients (innermost first): the polynomial in t.
  const COEFFS = [0.17087277, -0.82215223, 1.48851587, -1.13520398, 0.27886807, -0.18628806, 0.09678418, 0.37409196, 1.00002368];
  // Horner: poly = c0 + t*(c1 + t*(c2 + ... )); here COEFFS[0] is innermost.
  let poly = 0;
  for (let i = COEFFS.length - 1; i >= 0; i--) poly = COEFFS[i] + t * poly;
  const ans = t * Math.exp(-z * z - 1.26551223 + t * poly);
  return x >= 0 ? ans : 2 - ans;
}

export function runFrozenWalkForward(
  actualNames: string[],
  flags: FeatureFlags,
  liveSpins: SpinData[] = [],
): FrozenWalkForwardResult {
  const runArm = (label: string, armFlags: FeatureFlags): FwfArmResult => {
    const rounds: RoundResult[] = [];
    const perOutcomeMap = new Map<string, FwfOutcomeStat>();
    for (const g of GAMES) perOutcomeMap.set(g.name, { name: g.name, inclusions: 0, actuals: 0, coveredActuals: 0, hitEfficiency: 0 });
    const roundLog: FwfArmResult["rounds"] = [];
    let hits = 0;
    let misses = 0;
    let bonusInclusions = 0;
    const exclusionCounts: Record<string, number> = { "1": 0, "2": 0, "5": 0, "10": 0 };

    for (let i = 0; i < actualNames.length; i++) {
      const actualName = actualNames[i];
      const actualGame = gameByName(actualName);
      // Predict from history BEFORE this round (no leakage, no stale state).
      const prevPredNames = rounds.length > 0
        ? rounds[rounds.length - 1].prediction.map((p) => p.game.name)
        : [];
      const lastHit = rounds.length > 0 ? rounds[rounds.length - 1].hit : null;
      // FROZEN flags for the whole run — no mid-test tuning.
      const eng = runEngine(rounds, prevPredNames, lastHit, false, "", liveSpins, "baseline", armFlags);
      const preds = eng.predictions.map((p) => p.game);
      const predNames = preds.map((p) => p.name);
      const hit = predNames.includes(actualName);
      const theoHit = ["1", "2", "5", "10"].includes(actualName);
      // Record inclusion stats for THIS prediction set.
      for (const name of predNames) {
        const st = perOutcomeMap.get(name);
        if (st) {
          st.inclusions++;
          if (BONUS_NAMES.includes(name)) bonusInclusions++;
        }
      }
      for (const num of ["1", "2", "5", "10"]) {
        if (!predNames.includes(num)) exclusionCounts[num]++;
      }
      // Settle — ONE settlement per round (no duplicate settlement).
      const round: RoundResult = {
        prediction: preds.map((g, idx) => ({ game: g, confidence: 50, time: Date.now() + i, rank: idx + 1 })),
        actualResult: actualGame,
        hit,
        time: Date.now() + i,
        confidence: 50,
        recalibrated: false,
      };
      rounds.push(round);
      if (hit) hits++; else misses++;
      const st = perOutcomeMap.get(actualName);
      if (st) {
        st.actuals++;
        if (hit) st.coveredActuals++;
      }
      roundLog.push({ idx: i + 1, actual: actualName, preds: predNames, hit, theoHit });
    }

    const perOutcome = GAMES.map((g) => {
      const st = perOutcomeMap.get(g.name)!;
      st.hitEfficiency = st.inclusions > 0 ? st.coveredActuals / st.inclusions : 0;
      return { ...st };
    });
    const totalRounds = actualNames.length;
    const numberExclusionRate: Record<string, number> = {};
    for (const num of ["1", "2", "5", "10"]) {
      numberExclusionRate[num] = totalRounds > 0 ? exclusionCounts[num] / totalRounds : 0;
    }
    return {
      label,
      flags: { ...armFlags },
      hits,
      misses,
      hitRate: totalRounds > 0 ? hits / totalRounds : 0,
      totalRounds,
      bonusInclusions,
      bonusInclusionRate: totalRounds > 0 ? bonusInclusions / (totalRounds * 4) : 0,
      numberExclusionRate,
      perOutcome,
      rounds: roundLog,
    };
  };

  const baseline = runArm("baseline", ALL_FLAGS_OFF);
  const experimental = runArm("experimental", flags);

  // Theoretical [1,2,5,10] benchmark on the SAME rounds.
  let theoHits = 0;
  for (const name of actualNames) if (["1", "2", "5", "10"].includes(name)) theoHits++;
  const theoretical = { hits: theoHits, hitRate: actualNames.length > 0 ? theoHits / actualNames.length : 0 };

  // McNemar paired test (discordant rounds only).
  let r = 0; // baseline HIT & experimental MISS
  let s = 0; // baseline MISS & experimental HIT
  let flipsToHit = 0;
  let flipsToMiss = 0;
  const minLen = Math.min(baseline.rounds.length, experimental.rounds.length);
  for (let i = 0; i < minLen; i++) {
    const b = baseline.rounds[i];
    const e = experimental.rounds[i];
    if (b.hit && !e.hit) { r++; flipsToMiss++; }
    if (!b.hit && e.hit) { s++; flipsToHit++; }
  }
  // Continuity-corrected McNemar: χ² = (|r-s|-1)² / (r+s); 1 df.
  const discordant = r + s;
  const statistic = discordant > 0 ? (Math.abs(r - s) - 1) ** 2 / discordant : 0;
  const pValue = discordant > 0 ? chiSquare1dfSurvival(statistic) : 1;
  const mcnemar: McNemarResult = {
    r,
    s,
    statistic,
    pValue,
    significant: pValue < 0.05,
    note: discordant < 10
      ? `McNemar inconclusive (only ${discordant} discordant pairs; need ≥10 for a reliable test). NOT a validation claim.`
      : `McNemar χ²(1)=${statistic.toFixed(3)}, p=${pValue.toFixed(4)} ${pValue < 0.05 ? "(significant)" : "(not significant)"}. Retrospective paired comparison only — NOT a fresh-validation claim.`,
  };

  return {
    baseline,
    experimental,
    theoretical,
    mcnemar,
    flipsToHit,
    flipsToMiss,
    freshRounds: actualNames.length,
    modelVersion: MODEL_VERSION,
    note: "FROZEN WALK-FORWARD HARNESS. Built per C7. This output is a paired retrospective comparison, NOT a validation success claim. A genuine validation requires 100+ genuinely NEW paired live rounds with the model FROZEN (per §11/§12). Do not quote any number here as a 'validated improvement'.",
  };
}
