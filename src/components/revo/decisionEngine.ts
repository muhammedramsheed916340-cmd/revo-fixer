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
function buildDashboard(rounds: RoundResult[]): PerformanceDashboard {
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
  if (totalRounds > 0) {
    const last = rounds[totalRounds - 1];
    streakType = last.hit ? "HIT" : "MISS";
    for (let i = totalRounds - 1; i >= 0; i--) {
      if ((rounds[i].hit ? "HIT" : "MISS") === streakType) streakLen++;
      else break;
    }
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
  };
}

// ============================================================
// CANDIDATE SCORING — STRONGEST EVIDENCE-BASED SIGNAL
// ============================================================
function scoreCandidates(
  rounds: RoundResult[],
  dashboard: PerformanceDashboard,
  prevPredNames: string[],
  lastHit: boolean | null,
): CandidateScore[] {
  const n = rounds.length;
  const hist = rounds.map((r) => r.actualResult);

  // Per-game frequency across ALL verified rounds (long-term)
  const freqAll = new Map<string, number>();
  for (const g of GAMES) freqAll.set(g.name, 0);
  for (const h of hist) freqAll.set(h.name, (freqAll.get(h.name) ?? 0) + 1);

  // Per-game frequency in recent 10 (short-term)
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

  const scores: CandidateScore[] = [];

  for (let i = 0; i < GAMES.length; i++) {
    const g = GAMES[i];
    const theo = THEORETICAL[g.name] ?? 0.1;
    const longFreq = n > 0 ? (freqAll.get(g.name) ?? 0) / n : 0;
    const recFreq = recentHist.length > 0 ? (recentFreq.get(g.name) ?? 0) / recentHist.length : 0;
    const trend = recFreq - longFreq;
    const gap = gaps[g.name];
    const gapHistory = gapHistories[g.name];
    const avgGap = gapHistory.length > 0
      ? gapHistory.reduce((s, x) => s + x, 0) / gapHistory.length
      : n / Math.max(freqAll.get(g.name) ?? 1, 1);
    const isOverdue = avgGap > 0 && gap > avgGap * 1.5;
    const isHot = longFreq > theo * 1.3 && n >= 5;
    const isCold = longFreq < theo * 0.5 && n >= 5;

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

    // ===== BASE SCORE =====
    // Adaptive blend of long-term + recent frequencies, anchored to theoretical.
    const blendedFreq = (longFreq * longW + recFreq * adaptW);
    let score = theo * 0.4 + blendedFreq * 0.6; // start with prior + observed blend
    if (n === 0) score = theo; // first prediction: pure prior

    // ===== SIGNAL 1: Recent active boost =====
    if (recFreq > theo * 0.8 && n >= 5) {
      score *= 1.15;
      signals.push("recent-active");
    }

    // ===== SIGNAL 2: Overdue (gap-filling) — MILD only =====
    if (isOverdue && avgGap > 0) {
      const overdueRatio = gap / avgGap;
      score *= 1 + Math.min(0.15, (overdueRatio - 1) * 0.1);
      signals.push("overdue");
    }

    // ===== SIGNAL 3: Trend alignment (adaptive weighting) =====
    if (trend > 0.05 && n >= 10) {
      score *= 1 + Math.min(0.2, trend * 2 * adaptW);
      signals.push("trending-up");
    } else if (trend < -0.05 && n >= 10) {
      score *= 1 + Math.max(-0.25, trend * 2 * adaptW);
      signals.push("trending-down");
    }

    // ===== SIGNAL 4: Pattern stability bonus =====
    if (stability === "STABLE" && longFreq >= theo * 0.8) {
      score *= 1.08;
      signals.push("pattern-stable");
    }

    // ===== SIGNAL 5: Wilson score confidence (sample-size-aware) =====
    // Games with verified good prediction history get a mild boost.
    // Wilson lower bound penalizes tiny samples automatically.
    if (sampleSize >= 3) {
      score *= 1 + wilsonLower * 0.3; // up to +30% for proven signals
      signals.push(`verified (${hitLabel(sampleSize, signalHitRate)})`);
    }

    // ===== SIGNAL 6: Volatility penalty =====
    if (volatility > avgGap * avgGap * 1.5 && avgGap > 0) {
      score *= 0.9;
      signals.push("high-volatility");
    }

    // ===== SIGNAL 7: Previous MISS dampening (no blind switching) =====
    // If the last round was a MISS and this game was in the prediction set,
    // dampen slightly — but never exclude. No opposite-result chasing.
    if (lastHit === false && prevPredNames.includes(g.name)) {
      score *= 0.85;
      signals.push("prev-miss-dampen");
    }

    // ===== SIGNAL 8: Previous HIT continuation =====
    // If the last round was a HIT and this game was correctly predicted,
    // mild boost — no blind HIT-repeat either, just evidence weighting.
    if (lastHit === true && prevPredNames.includes(g.name) && sw.rate >= 0.3) {
      score *= 1.05;
      signals.push("prev-hit-confirm");
    }

    // ===== SIGNAL 9: Anomaly handling =====
    // If anomaly detected, weight recent data even more.
    if (dashboard.anomalyDetected) {
      score = theo * 0.2 + blendedFreq * 0.8;
      if (!signals.includes("anomaly-weighted")) signals.push("anomaly-weighted");
    }

    // ===== SIGNAL 10: Pattern shift handling =====
    if (dashboard.patternShiftDetected) {
      // Trust recent more strongly when shift is detected.
      score = theo * 0.15 + recFreq * 0.7 + longFreq * 0.15;
      if (!signals.includes("shift-adaptive")) signals.push("shift-adaptive");
    }

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
    });
  }

  // Normalize scores (so they sum to 1)
  const totalRaw = scores.reduce((s, c) => s + c.rawScore, 0);
  for (const c of scores) c.normalizedScore = totalRaw > 0 ? c.rawScore / totalRaw : 0;

  // Sort by raw score (descending)
  scores.sort((a, b) => b.rawScore - a.rawScore);

  // Assign ranks + labels (top 4 → next signal)
  const rankLabels = [
    "strongest evidence",
    "second strongest",
    "alternative signal",
    "defensive / low-probability",
  ];
  for (let i = 0; i < scores.length; i++) {
    scores[i].rank = i + 1;
    if (i < 4) {
      scores[i].label = rankLabels[i];
    } else {
      scores[i].label = "excluded (not in prediction)";
    }
  }

  return scores;
}

function hitLabel(sampleSize: number, rate: number): string {
  if (sampleSize < 3) return "insufficient";
  if (rate >= 0.6) return "strong";
  if (rate >= 0.4) return "moderate";
  return "weak";
}

// ============================================================
// HONEST CONFIDENCE (sample-size-aware, never fake)
// ============================================================
function honestConfidence(dashboard: PerformanceDashboard, triggered: boolean): number {
  const n = dashboard.sampleSize;
  if (n < 3) {
    // Insufficient data — honestly low confidence.
    // Deterministic value (NO Math.random) to avoid SSR hydration mismatch.
    return 24;
  }
  // Use Wilson lower bound of long-term hit-rate as the honest base.
  // This naturally penalizes small samples.
  const wilson = wilsonLowerBound(dashboard.hits, n);
  // Blend with recent hit-rate (adaptive weighting).
  const adaptive = dashboard.adaptiveWeight;
  const blended = wilson * (1 - adaptive * 0.4) + dashboard.recentHitRate * (adaptive * 0.4);
  let conf = Math.round(blended * 100);
  // With 10+ verified rounds, allow higher confidence ceiling.
  const maxConf = n >= 10 ? 85 : 70;
  // After a MISS, dampen (model just failed, recalibrating).
  if (triggered) conf -= 10;
  // After a HIT streak (recentHitRate > 60%), mild boost.
  if (!triggered && dashboard.recentHitRate > 0.6) conf += 5;
  // Penalize instability.
  if (dashboard.modelStability < 40) conf -= 5;
  // Penalize anomaly/pattern shift.
  if (dashboard.anomalyDetected || dashboard.patternShiftDetected) conf -= 5;
  return Math.max(15, Math.min(maxConf, conf));
}

function confidenceLabelOf(confidence: number, n: number): { label: string; color: string } {
  if (n < 3) return { label: "INSUFFICIENT DATA", color: "#5a6a99" };
  if (confidence >= 70) return { label: "STRONG", color: "#2ed573" };
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
 */
export function runEngine(
  rounds: RoundResult[],
  prevPredNames: string[] = [],
  lastHit: boolean | null = null,
  recalibrated = false,
  recalibrationReason = "",
): EngineOutput {
  const dashboard = buildDashboard(rounds);
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
  const candidates = scoreCandidates(rounds, dashboard, prevPredNames, lastHit);

  // Pick top 4 → NEXT SIGNAL.
  const top4 = candidates.slice(0, SIGNAL_COUNT);
  const excluded = candidates.slice(SIGNAL_COUNT);

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
  const whyParts: string[] = [];
  if (rounds.length === 0) {
    whyParts.push("No verified rounds yet — predicting with theoretical priors + base weights.");
  } else if (rounds.length < 3) {
    whyParts.push(`Building baseline data (${rounds.length} round${rounds.length !== 1 ? "s" : ""}) — theoretical + observed blend.`);
  } else {
    if (lastHit === true) {
      whyParts.push(`Previous HIT — continuing with confirmed signals. Streak: ${consecutiveHits}× HIT.`);
    } else if (lastHit === false) {
      whyParts.push(`Previous MISS — RCA completed (${rca?.cause ?? "unknown"}), multi-signal recalibration applied.`);
    }
    whyParts.push(`Hit-rate: ${Math.round(dashboard.predictionHitRate * 100)}% (${dashboard.hits}/${dashboard.totalRounds})`);
    whyParts.push(`Recent (5): ${Math.round(dashboard.recentHitRate * 100)}% • Recent (10): ${Math.round(dashboard.recentHitRateLong * 100)}%`);
    whyParts.push(`Stability: ${dashboard.modelStability}% • Adaptive weight (recent): ${Math.round(dashboard.adaptiveWeight * 100)}%`);
    whyParts.push(`Top signal evidence: ${top4[0]?.signals.join("+") || "theoretical"}`);
    if (dashboard.anomalyDetected) whyParts.push(`⚠ Anomaly detected — χ²=${anomaly.statistic.toFixed(1)}`);
    if (dashboard.patternShiftDetected) whyParts.push(`⚠ Pattern shift — recent data weighted higher`);
  }

  // VALIDATION CRITERIA
  const validationCriteria =
    `Next actual result must match one of [${top4.map((c) => c.game.name).join(", ")}] for HIT. ` +
    `Any other result = MISS → triggers RCA + recalibration. ` +
    `Prediction is STABLE until the next live result arrives — no mid-round changes.`;

  // Build final prediction objects (THE source of truth).
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
export function recalibrate(rounds: RoundResult[], reason: string): EngineOutput {
  const last = rounds[rounds.length - 1];
  const prevPredNames = last ? last.prediction.map((p) => p.game.name) : [];
  const lastHit = last ? last.hit : null;
  return runEngine(rounds, prevPredNames, lastHit, true, reason);
}

/**
 * Build the INITIAL engine output (no verified rounds yet, or after a HIT).
 * Used for GET SIGNAL.
 */
export function buildInitial(rounds: RoundResult[]): EngineOutput {
  const last = rounds[rounds.length - 1];
  const prevPredNames = last ? last.prediction.map((p) => p.game.name) : [];
  const lastHit = last ? last.hit : null;
  return runEngine(rounds, prevPredNames, lastHit, false, "");
}
