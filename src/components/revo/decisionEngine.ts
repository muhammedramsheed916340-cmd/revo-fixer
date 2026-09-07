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
    const mean = indicators.reduce((s, x) => s + x, 0) / indicators.length;
    const variance = indicators.reduce((s, x) => s + (x - mean) ** 2, 0) / indicators.length;
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
): CandidateScore[] {
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
  const recentHist = hist.slice(-10);
  const recentFreq = new Map<string, number>();
  for (const g of GAMES) recentFreq.set(g.name, 0);
  for (const h of recentHist) recentFreq.set(h.name, (recentFreq.get(h.name) ?? 0) + 1);

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
    const liveRecFreq = liveRecentN > 0 ? (liveRecentFreq.get(g.name) ?? 0) / liveRecentN : 0;
    const userRecFreq = recentHist.length > 0 ? (recentFreq.get(g.name) ?? 0) / recentHist.length : 0;
    const recFreq = useLivePrior
      ? liveRecFreq * 0.6 + userRecFreq * 0.4
      : userRecFreq;
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

    // ===== BASE SCORE — NORMALIZED RELATIVE EVIDENCE (no absolute-frequency bias) =====
    // CRITICAL: The base score must NOT use absolute frequency (which would
    // permanently lock 1,2,5,10 due to their high theoretical probability).
    // Instead, we compute how much the observed frequency DEVIATES from the
    // base prior, and use that RELATIVE deviation as the score.
    //
    // This ensures ALL 8 outcomes compete on the SAME scale:
    //   - "1" with 38.89% prior and 40% observed → mild positive deviation
    //   - "CASH HUNT" with 3.70% prior and 8% observed → strong positive deviation
    //   - "CRAZY TIME" with 1.85% prior and 5% observed → very strong positive deviation
    //
    // The base prior anchors the score (regression to mean), but the EVIDENCE
    // (observed deviation) determines the ranking. A rare outcome with strong
    // recent evidence CAN out-rank a common outcome with weak evidence.
    //
    // Formula: score = prior * (1 + relativeDeviation)
    //   where relativeDeviation = (blendedFreq - prior) / prior
    // This keeps the score anchored to the prior but scaled by evidence.
    const blendedFreq = (longFreq * longW + recFreq * adaptW);
    const deviation = livePrior > 0 ? (blendedFreq - livePrior) / livePrior : 0;
    // Score = prior × (1 + deviation). When deviation=0, score=prior (neutral).
    // When deviation=+0.5 (50% above prior), score = prior × 1.5.
    // When deviation=-0.5, score = prior × 0.5.
    // Cap deviation to prevent extreme swings: [-0.6, +2.0]
    const cappedDeviation = Math.max(-0.6, Math.min(2.0, deviation));
    let score = livePrior * (1 + cappedDeviation);
    if (!useLivePrior && n === 0) score = theo; // no data at all → pure theoretical

    // ===== FACTOR 1: Recent active (mild adaptive signal — NOT a chase) =====
    // Appearing more than 80% of theoretical recently → mild evidence the wheel
    // is currently favouring it (regime). Capped to prevent hot-number chasing.
    if (recFreq > livePrior * 0.8 && (n >= 5 || liveN >= 20)) {
      score *= 1.10;
      signals.push("recent-active");
    }

    // ===== FACTOR 2: Trend alignment (adaptive weighting) =====
    // Recent vs long-term delta — mild evidence of regime shift. NOT a chase.
    if (trend > 0.05 && (n >= 10 || liveN >= 20)) {
      score *= 1 + Math.min(0.12, trend * 1.5 * adaptW);
      signals.push("trending-up");
    } else if (trend < -0.05 && (n >= 10 || liveN >= 20)) {
      score *= 1 + Math.max(-0.20, trend * 1.5 * adaptW);
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
    // EXPLICITLY REMOVED (last-hit carryover bias):
    //   - NO prev-miss-dampen (previous MISS → automatic penalty)
    //   - NO prev-HIT continuation (previous HIT → automatic bonus)
    //   - NO overdue gap-filling boost (isOverdue → boost)
    //   - NO hot/cold z-score boost
    // Every round is a FRESH evidence-based ranking. Previous result is just
    // ONE historical data point — it only affects the score via the
    // Repeat-Pattern Analysis above (and only if statistically supported).
    // ===================================================================
    void isOverdue;
    void isHot;
    void isCold;
    void lastHit;
    void prevPredNames;

    // ===== SIGNAL 9: Anomaly handling (normalized relative — no absolute bias) =====
    // If anomaly detected, weight recent data even more (using relative deviation).
    if (dashboard.anomalyDetected) {
      const anomalyDeviation = livePrior > 0 ? (recFreq - livePrior) / livePrior : 0;
      const cappedAnomalyDev = Math.max(-0.6, Math.min(2.0, anomalyDeviation));
      score = livePrior * (1 + cappedAnomalyDev * 1.5); // amplify deviation signal
      if (!signals.includes("anomaly-weighted")) signals.push("anomaly-weighted");
    }

    // ===== SIGNAL 10: Pattern shift handling (normalized relative) =====
    if (dashboard.patternShiftDetected) {
      const shiftDeviation = livePrior > 0 ? (recFreq - livePrior) / livePrior : 0;
      const cappedShiftDev = Math.max(-0.6, Math.min(2.0, shiftDeviation));
      score = livePrior * (1 + cappedShiftDev * 1.3); // amplify recent deviation
      if (!signals.includes("shift-adaptive")) signals.push("shift-adaptive");
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
// EVIDENCE-RANKED TOP SELECTION (pure, no fixed slots)
// ============================================================
/**
 * Pick `count` candidates by ranking ALL candidates using the complete AI
 * evidence score, then selecting the top `count`.
 *
 * KEY RULES (per user spec — REVISED hybrid logic):
 *   - NO always-fixed top 2 (e.g., never lock "1" and "2")
 *   - NO weighted random sampling (deterministic rank instead)
 *   - NO last-hit repetition / HOT / OVERDUE bias
 *   - NO rare-number automatic suppression (rare outcomes CAN enter if
 *     multiple independent signals support them)
 *   - NO previous prediction carry-over
 *
 * The top 4 changes NATURALLY when the evidence changes. Every round is a
 * fresh, independent recalculation from the complete available evidence.
 *
 * Returns the top `count` candidates, sorted by evidence rank (strongest first).
 */
function selectTopByEvidence(candidates: CandidateScore[], count: number): CandidateScore[] {
  // Already sorted by rawScore descending in scoreCandidates(). Take top N.
  return candidates.slice(0, count);
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
  const candidates = scoreCandidates(rounds, dashboard, prevPredNames, lastHit, liveSpins);

  // ===== EVIDENCE-RANKED TOP-4 SELECTION (pure, no fixed slots) =====
  // Rank ALL 8 candidates by their complete AI evidence score (no fixed top-2,
  // no weighted random, no last-hit carry-over). Select the 4 strongest CURRENT
  // evidence combinations. The top 4 changes NATURALLY when the evidence changes.
  //
  // SSR SAFETY: When there is NO real data (no rounds AND no liveSpins), return
  // empty predictions — the client-side generatePrediction effect populates
  // them after mount (avoids hydration mismatch).
  const hasData = rounds.length > 0 || liveSpins.length > 0;
  const sampled = hasData ? selectTopByEvidence(candidates, SIGNAL_COUNT) : [];
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
export function recalibrate(rounds: RoundResult[], reason: string, liveSpins: SpinData[] = []): EngineOutput {
  const last = rounds[rounds.length - 1];
  const prevPredNames = last ? last.prediction.map((p) => p.game.name) : [];
  const lastHit = last ? last.hit : null;
  return runEngine(rounds, prevPredNames, lastHit, true, reason, liveSpins);
}

/**
 * Build the INITIAL engine output (no verified rounds yet, or after a HIT).
 * Used for GET SIGNAL. Pass REAL casino spins to drive data-driven predictions.
 */
export function buildInitial(rounds: RoundResult[], liveSpins: SpinData[] = []): EngineOutput {
  const last = rounds[rounds.length - 1];
  const prevPredNames = last ? last.prediction.map((p) => p.game.name) : [];
  const lastHit = last ? last.hit : null;
  return runEngine(rounds, prevPredNames, lastHit, false, "", liveSpins);
}
