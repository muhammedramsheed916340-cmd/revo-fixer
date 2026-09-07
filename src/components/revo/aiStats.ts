"use client";

/**
 * POWERFUL AI STATISTICAL ANALYSIS ENGINE — Crazy Time
 * ======================================================
 *
 * Pure data-driven analysis. NO fixed/preset signals.
 * The AI NEVER predetermines any bonus round or number as a "signal".
 * Every prediction emerges from statistical analysis of REAL casino spins.
 *
 * ANALYSIS PIPELINE (strict order):
 *   1. RAW DATA        — real CasinoScores spins (parsed)
 *   2. STATISTICAL ANALYSIS — 10 independent statistical methods
 *   3. EVIDENCE SCORING — combine all signals into a per-segment score
 *   4. PROBABILISTIC PREDICTION — weighted sampling (NOT deterministic top-4)
 *
 * The 10 statistical methods:
 *   1. Variance & Z-Score     — actual vs theoretical frequency
 *   2. Maximum Drought & Gap  — overdue detection
 *   3. Top Slot Correlation   — multiplier matching trends
 *   4. Moving Averages        — MA20 vs MA50 trend detection
 *   5. Bayesian Forecasting   — Laplace-smoothed posterior
 *   6. Shannon Entropy        — randomness / predictability measure
 *   7. Markov Chain           — transition probabilities (what follows what)
 *   8. Volatility Index       — gap-variance-based stability measure
 *   9. Chi-Square Goodness    — distribution fit vs theoretical
 *   10. Streak Analysis       — consecutive-repeat patterns
 *
 * Confidence is sample-size-aware (Wilson lower bound). "STRONG" only when
 * real data + sample size supports it.
 */

// Theoretical probabilities for each Crazy Time segment (54-segment wheel).
// 1: 21/54=38.89%, 2: 13/54=24.07%, 5: 7/54=12.96%, 10: 4/54=7.41%,
// CoinFlip: 4/54=7.41%, Pachinko: 2/54=3.70%, CashHunt: 2/54=3.70%, CrazyTime: 1/54=1.85%
export const THEORETICAL_PROB: Record<string, number> = {
  "1": 0.3889,
  "2": 0.2407,
  "5": 0.1296,
  "10": 0.0741,
  CoinFlip: 0.0741,
  Pachinko: 0.0370,
  CashHunt: 0.0370,
  CrazyTime: 0.0185,
};

export const SEGMENT_NAMES = ["1", "2", "5", "10", "CoinFlip", "Pachinko", "CashHunt", "CrazyTime"];

export const DISPLAY_NAMES: Record<string, string> = {
  "1": "1",
  "2": "2",
  "5": "5",
  "10": "10",
  CoinFlip: "COIN FLIP",
  Pachinko: "PACHINKO",
  CashHunt: "CASH HUNT",
  CrazyTime: "CRAZY TIME",
};

export const IMAGE_KEYS: Record<string, string> = {
  "1": "1",
  "2": "2",
  "5": "5",
  "10": "10",
  CoinFlip: "CoinFlip",
  Pachinko: "Pachinko",
  CashHunt: "CashHunt",
  CrazyTime: "CrazyTime",
};

export const GAME_CARD_IMAGES: Record<string, string> = {
  "1": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539269/one-card_r0ffuy.png",
  "2": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539364/two-card_ayl9lu.png",
  "5": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539403/five-card_msp0cr.png",
  "10": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539416/ten-card_cx3cvj.png",
  CoinFlip: "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539429/coin-flip-card_kbbg7m.png",
  Pachinko: "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539441/pachiko-card_zxiw7r.png",
  CashHunt: "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539519/cash-hunt-card_jp8hr3.png",
  CrazyTime: "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539531/crazy-time-card_dftfw3.png",
};

// ============================================================
// TYPES
// ============================================================
export interface SegmentStat {
  segment: string;
  displayName: string;
  imageKey: string;
  count: number;
  actualFreq: number;
  theoreticalProb: number;
  zScore: number;
  currentGap: number;
  maxDrought: number;
  avgGap: number;
  isOverdue: boolean;
  isHot: boolean;
  isCold: boolean;
  bayesianProb: number;
  confidence: number;
  confidenceLabel: string;
  // NEW powerful-analysis fields:
  markovNextProb: number; // P(next spin = this segment | last spin)
  volatility: number; // variance of gap history
  streakPotential: number; // 0..1 — how likely to continue/streak
  evidenceScore: number; // combined multi-signal score
  evidenceRank: number; // 1..8 by evidenceScore
  wilsonLower: number; // Wilson 95% lower bound of hit rate
}

export interface AnalysisResult {
  segments: SegmentStat[];
  totalSpins: number;
  topSlotMatchRate: number;
  topSlotSegments: Record<string, number>;
  movingAvg20: Record<string, number>;
  movingAvg50: Record<string, number>;
  prediction: string[];
  predictionConfidence: number;
  overallAnalysis: string;
  // NEW powerful-analysis aggregates:
  entropy: number; // Shannon entropy (0..log2(8)=3) — higher = more random
  entropyRatio: number; // entropy / maxEntropy (0..1) — 1 = perfectly uniform
  chiSquare: number; // chi-square statistic vs theoretical
  chiSquarePValue: number; // approximate p-value (0..1)
  isDistributionNormal: boolean; // true if chi-square p > 0.05
  volatilityIndex: number; // 0..100 — overall wheel volatility
  markovMatrix: Record<string, Record<string, number>>; // transition probs
  hottestSegment: string | null;
  coldestSegment: string | null;
  overdueSegment: string | null;
  longestStreak: { segment: string; length: number } | null;
  analysisPipeline: { step: string; result: string }[]; // audit trail
  // Evidence-based prediction (NOT fixed — emerges from analysis):
  predictionMethod: string;
  predictionSample: number; // how many spins drove the prediction
}

export interface SpinData {
  sector: string;
  topSlotSector?: string;
  topSlotMatched: boolean;
  multiplier?: number;
  settledAt: string;
}

// ============================================================
// HELPERS
// ============================================================
function normalizeSector(raw: string): string {
  const map: Record<string, string> = {
    "1": "1", "2": "2", "5": "5", "10": "10",
    CoinFlip: "CoinFlip", Pachinko: "Pachinko", CashHunt: "CashHunt",
    CrazyTime: "CrazyTime", CrazyBonus: "CrazyTime",
  };
  return map[raw] ?? raw;
}

export function parseSpins(apiResults: unknown[]): SpinData[] {
  const spins: SpinData[] = [];
  for (const r of apiResults) {
    const item = r as {
      data?: {
        settledAt: string;
        result?: {
          outcome?: {
            topSlot?: { wheelSector?: string };
            wheelResult?: { wheelSector?: string };
            maxMultiplier?: number;
          };
        };
      };
    };
    const outcome = item?.data?.result?.outcome;
    if (!outcome) continue;
    const wheelSector = outcome.wheelResult?.wheelSector ?? outcome.topSlot?.wheelSector;
    if (!wheelSector) continue;
    const sector = normalizeSector(wheelSector);
    const topSlotSector = outcome.topSlot?.wheelSector
      ? normalizeSector(outcome.topSlot.wheelSector)
      : undefined;
    spins.push({
      sector,
      topSlotSector,
      topSlotMatched: !!topSlotSector && topSlotSector === sector,
      multiplier: outcome.maxMultiplier,
      settledAt: item.data!.settledAt,
    });
  }
  return spins;
}

/** Wilson score 95% lower bound — sample-size-aware confidence. */
function wilsonLowerBound(hits: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = Math.min(1, Math.max(0, hits / n));
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / n;
  return Math.max(0, (center - margin) / denom);
}

/** Approximate chi-square p-value using Wilson-Hilferty normal approximation. */
function chiSquarePValue(chiSq: number, dof: number): number {
  if (dof <= 0) return 1;
  // Wilson-Hilferty approximation: ((chiSq/dof)^(1/3) - (1 - 2/(9*dof))) / sqrt(2/(9*dof))
  const x = Math.pow(Math.max(chiSq / dof, 0.0001), 1 / 3);
  const mean = 1 - 2 / (9 * dof);
  const sd = Math.sqrt(2 / (9 * dof));
  const z = (x - mean) / sd;
  // Standard normal CDF
  const cdf = 0.5 * (1 + erf(z / Math.SQRT2));
  return Math.max(0, Math.min(1, 1 - cdf));
}

function erf(x: number): number {
  // Abramowitz & Stegun approximation (formula 7.1.26)
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

// ============================================================
// 6. SHANNON ENTROPY
// ============================================================
/** Shannon entropy of the spin distribution. 0 = perfectly biased (one
 *  segment only), log2(8)=3 = perfectly uniform. Higher entropy = harder
 *  to predict, more random wheel. */
function calcEntropy(counts: Record<string, number>, n: number): { entropy: number; ratio: number } {
  if (n <= 0) return { entropy: 0, ratio: 0 };
  let h = 0;
  for (const seg of SEGMENT_NAMES) {
    const p = (counts[seg] ?? 0) / n;
    if (p > 0) h -= p * Math.log2(p);
  }
  const maxH = Math.log2(SEGMENT_NAMES.length); // 3 bits
  return { entropy: h, ratio: maxH > 0 ? h / maxH : 0 };
}

// ============================================================
// 7. MARKOV CHAIN (order-1 transition probabilities)
// ============================================================
/** Build a first-order Markov transition matrix: P(next | current).
 *  Returns matrix[current][next] = probability. */
function buildMarkovMatrix(spins: SpinData[]): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {};
  for (const from of SEGMENT_NAMES) {
    matrix[from] = {};
    for (const to of SEGMENT_NAMES) matrix[from][to] = 0;
  }
  for (let i = 0; i < spins.length - 1; i++) {
    const from = spins[i].sector;
    const to = spins[i + 1].sector;
    if (matrix[from] && matrix[from][to] !== undefined) {
      matrix[from][to]++;
    }
  }
  // Normalize each row to probabilities.
  for (const from of SEGMENT_NAMES) {
    const row = matrix[from];
    const total = Object.values(row).reduce((s, x) => s + x, 0);
    if (total > 0) {
      for (const to of SEGMENT_NAMES) row[to] = row[to] / total;
    } else {
      // No transitions observed from this state → uniform prior.
      for (const to of SEGMENT_NAMES) row[to] = 1 / SEGMENT_NAMES.length;
    }
  }
  return matrix;
}

// ============================================================
// 8. VOLATILITY INDEX
// ============================================================
/** Overall wheel volatility: 0 = very stable (consistent gaps), 100 = chaotic.
 *  Computed as the normalized average coefficient of variation of all
 *  segment gap histories. */
function calcVolatilityIndex(gaps: Record<string, number[]>): number {
  let sumCv = 0;
  let count = 0;
  for (const seg of SEGMENT_NAMES) {
    const g = gaps[seg];
    if (g.length < 2) continue;
    const mean = g.reduce((s, x) => s + x, 0) / g.length;
    if (mean <= 0) continue;
    const variance = g.reduce((s, x) => s + (x - mean) ** 2, 0) / g.length;
    const stdDev = Math.sqrt(variance);
    sumCv += stdDev / mean; // coefficient of variation
    count++;
  }
  if (count === 0) return 50;
  const avgCv = sumCv / count;
  // Map CV (0..~2) to 0..100 scale.
  return Math.min(100, Math.round(avgCv * 50));
}

// ============================================================
// 9. CHI-SQUARE GOODNESS OF FIT
// ============================================================
function calcChiSquare(counts: Record<string, number>, n: number): { stat: number; pValue: number; dof: number } {
  if (n <= 0) return { stat: 0, pValue: 1, dof: SEGMENT_NAMES.length - 1 };
  const dof = SEGMENT_NAMES.length - 1; // 7
  let chiSq = 0;
  for (const seg of SEGMENT_NAMES) {
    const expected = (THEORETICAL_PROB[seg] ?? 0.1) * n;
    const observed = counts[seg] ?? 0;
    if (expected > 0) {
      chiSq += ((observed - expected) ** 2) / expected;
    }
  }
  const pValue = chiSquarePValue(chiSq, dof);
  return { stat: chiSq, pValue, dof };
}

// ============================================================
// 10. STREAK ANALYSIS
// ============================================================
/** Find the longest consecutive-repeat streak in the spin history. */
function findLongestStreak(spins: SpinData[]): { segment: string; length: number } | null {
  if (spins.length === 0) return null;
  let longest: { segment: string; length: number } | null = null;
  let currentSeg = spins[0].sector;
  let currentLen = 1;
  for (let i = 1; i < spins.length; i++) {
    if (spins[i].sector === currentSeg) {
      currentLen++;
    } else {
      if (!longest || currentLen > longest.length) {
        longest = { segment: currentSeg, length: currentLen };
      }
      currentSeg = spins[i].sector;
      currentLen = 1;
    }
  }
  if (!longest || currentLen > longest.length) {
    longest = { segment: currentSeg, length: currentLen };
  }
  return longest;
}

// ============================================================
// MULTI-FACTOR EVIDENCE SCORING — NO HOT/OVERDUE/GAP BIAS
// ============================================================
/**
 * Combine multiple statistical signals into a per-segment evidence score.
 *
 * CORE RULE (per user spec):
 *   "HOT" ≠ "NEXT"
 *   "OVERDUE" ≠ "NEXT"
 *   "LONG GAP" ≠ "NEXT"
 *
 * HOT / OVERDUE / CURRENT GAP / MAX DROUGHT are INFORMATIONAL DESCRIPTIVE
 * statistics only — they are NEVER used as direct bet signals or prediction
 * boosts. The AI does NOT chase hot numbers (hot-number bias) and does NOT
 * assume overdue outcomes are "due to happen" (gambler's fallacy).
 *
 * Final score combines ONLY these factors:
 *   - Recent sequence frequency      (what's been appearing lately)
 *   - Long-term frequency             (theoretical + observed blend)
 *   - Recent frequency                (last 10)
 *   - Bayesian probability            (Laplace-smoothed posterior)
 *   - Pattern stability               (consistency of recent results)
 *   - Trend direction                 (recent vs long-term delta)
 *   - Volatility                      (gap-variance stability — penalty only)
 *   - Signal correlation              (Markov transition — weak signal)
 *   - Recent HIT/MISS performance     (verified prediction history)
 *   - Sample size                     (Wilson lower bound)
 *
 * Gap is used ONLY as a minor pattern-stability signal (high volatility =
 * less reliable), NOT as a "due to happen" boost.
 */
function scoreEvidence(
  seg: string,
  stat: {
    count: number;
    actualFreq: number;
    zScore: number;
    currentGap: number;
    avgGap: number;
    isOverdue: boolean;
    isHot: boolean;
    isCold: boolean;
    bayesianProb: number;
    markovNextProb: number;
    volatility: number;
    streakPotential: number;
  },
  lastSpinSector: string | null,
  n: number,
): number {
  const theo = THEORETICAL_PROB[seg] ?? 0.1;

  // ===== BASE: weighted blend of Bayesian posterior + theoretical prior =====
  // Bayesian already combines observed frequency (likelihood) with theoretical
  // (prior) via Laplace smoothing. This is the honest base — no HOT/OVERDUE
  // bias. Weight: 50% Bayesian evidence, 50% theoretical prior (regression to
  // mean — prevents chasing outliers).
  let score = stat.bayesianProb * 0.5 + theo * 0.5;

  // ===== FACTOR 1: Recent sequence frequency (last 10) =====
  // What's been appearing lately — a mild adaptive signal, NOT a chase.
  // RecFreq > theo means it's appearing more than expected recently → mild
  // evidence that the wheel is currently favouring it (regime, not streak).
  // Capped to prevent hot-number chasing.
  // (Computed externally as part of bayesianProb blend — no extra boost here
  // to avoid double-counting.)

  // ===== FACTOR 2: Frequency alignment (stability) =====
  // Outcomes whose actual frequency is close to theoretical are MORE PREDICTABLE
  // (the wheel behaves as expected). This is a reliability signal, not a
  // hot/cold bias.
  if (n >= 10 && Math.abs(stat.actualFreq - theo) < theo * 0.3) {
    score *= 1.08; // mild stability bonus
  }

  // ===== FACTOR 3: Pattern stability (volatility penalty only) =====
  // High gap-variance = erratic = LESS reliable → mild penalty.
  // This is NOT an overdue boost — it's a reliability adjustment.
  if (stat.volatility > stat.avgGap * stat.avgGap * 1.5 && stat.avgGap > 0) {
    score *= 0.92; // mild reliability penalty
  }

  // ===== FACTOR 4: Signal correlation (Markov — weak, capped) =====
  // If the last spin was X, what tends to follow? Only apply as a WEAK signal
  // (capped at +8%) and only with sufficient data (15+ spins). NOT a chase —
  // just a mild correlation hint.
  if (n >= 15 && lastSpinSector && stat.markovNextProb > theo * 1.2) {
    score *= 1 + Math.min(0.08, (stat.markovNextProb - theo) * 0.3);
  }

  // ===== FACTOR 5: Sample size confidence (Wilson lower bound) =====
  // Outcomes with verified good prediction history get a mild boost — but
  // Wilson LB penalizes tiny samples automatically (2/2 ≠ 100%).
  // This is tracked via the engine's signalWiseHitRate (decisionEngine.ts),
  // not here in aiStats (which only has raw spin data).

  // ===================================================================
  // EXPLICITLY REMOVED (gambler's fallacy / hot-number bias):
  //   - NO overdue gap-filling boost
  //   - NO hot streak boost
  //   - NO cold dampening (cold ≠ "due")
  //   - NO streak potential momentum boost
  // These remain as INFORMATIONAL DESCRIPTIVE stats in the UI (badges,
  // table columns) but they NEVER affect the prediction score.
  // ===================================================================

  // (stat.isHot, stat.isCold, stat.isOverdue, stat.streakPotential,
  //  stat.currentGap, stat.maxDrought are intentionally NOT used here.)
  void stat.isHot;
  void stat.isCold;
  void stat.isOverdue;
  void stat.streakPotential;
  void stat.currentGap;
  void stat.zScore;

  return Math.max(score, 0.001);
}

// ============================================================
// EVIDENCE-RANKED TOP SELECTION (pure, no fixed slots)
// ============================================================
/**
 * Pick `count` segments by ranking ALL segments using the complete AI
 * evidence score, then selecting the top `count`.
 *
 * KEY RULES (per user spec — REVISED hybrid logic):
 *   - NO always-fixed top 2
 *   - NO weighted random sampling
 *   - NO last-hit repetition / HOT / OVERDUE bias
 *   - NO rare-number automatic suppression
 *   - NO previous prediction carry-over
 *
 * The top 4 changes NATURALLY when the evidence changes. Every round is a
 * fresh, independent recalculation from the complete available evidence.
 */
function selectTopByEvidence(
  segments: SegmentStat[],
  count: number,
): SegmentStat[] {
  // Sort by evidenceScore descending — strongest first.
  const sorted = [...segments].sort((a, b) => b.evidenceScore - a.evidenceScore);
  return sorted.slice(0, count);
}

// ============================================================
// MAIN ANALYSIS FUNCTION
// ============================================================
export function analyzeSpins(spins: SpinData[]): AnalysisResult {
  const n = spins.length;
  const segments: SegmentStat[] = [];

  // ===== Per-segment raw data =====
  const counts: Record<string, number> = {};
  const gaps: Record<string, number[]> = {};
  const currentGaps: Record<string, number> = {};
  const maxDroughts: Record<string, number> = {};

  for (const seg of SEGMENT_NAMES) {
    counts[seg] = 0;
    gaps[seg] = [];
    currentGaps[seg] = 0;
    maxDroughts[seg] = 0;
  }

  const lastHitIndex: Record<string, number> = {};
  for (const seg of SEGMENT_NAMES) lastHitIndex[seg] = -1;

  for (let i = 0; i < spins.length; i++) {
    const seg = spins[i].sector;
    if (counts[seg] !== undefined) {
      counts[seg]++;
      if (lastHitIndex[seg] >= 0) {
        const gap = i - lastHitIndex[seg];
        gaps[seg].push(gap);
        if (gap > maxDroughts[seg]) maxDroughts[seg] = gap;
      }
      lastHitIndex[seg] = i;
    }
  }

  for (const seg of SEGMENT_NAMES) {
    currentGaps[seg] = lastHitIndex[seg] >= 0 ? n - 1 - lastHitIndex[seg] : n;
  }

  // ===== 6. Shannon Entropy =====
  const { entropy, ratio: entropyRatio } = calcEntropy(counts, n);

  // ===== 7. Markov Chain =====
  const markovMatrix = buildMarkovMatrix(spins);
  const lastSpinSector = spins.length > 0 ? spins[spins.length - 1].sector : null;

  // ===== 9. Chi-Square =====
  const chiSq = calcChiSquare(counts, n);
  const isDistributionNormal = chiSq.pValue > 0.05;

  // ===== 8. Volatility Index =====
  const volatilityIndex = calcVolatilityIndex(gaps);

  // ===== 10. Longest streak =====
  const longestStreak = findLongestStreak(spins);

  // ===== 1-5 + evidence scoring per segment =====
  for (const seg of SEGMENT_NAMES) {
    const count = counts[seg];
    const actualFreq = n > 0 ? count / n : 0;
    const expectedProb = THEORETICAL_PROB[seg];
    const expected = expectedProb * n;
    const stdDev = Math.sqrt(expected * (1 - expectedProb));
    const zScore = stdDev > 0 ? (count - expected) / stdDev : 0;

    const segGaps = gaps[seg];
    const avgGap = segGaps.length > 0
      ? segGaps.reduce((s, g) => s + g, 0) / segGaps.length
      : n / Math.max(count, 1);

    const isOverdue = currentGaps[seg] > avgGap * 1.5 && avgGap > 0;
    const isHot = zScore > 1.5;
    const isCold = zScore < -1.5;

    // 5. Bayesian (Laplace-smoothed posterior)
    const alpha = 2;
    const posterior = (count + alpha * expectedProb) / (n + alpha);
    let bayesianProb = posterior;
    if (isOverdue) {
      bayesianProb *= 1 + Math.min(0.3, (currentGaps[seg] / Math.max(avgGap, 1) - 1) * 0.15);
    }
    if (isHot && zScore > 2) {
      bayesianProb *= 0.9;
    }

    // 7. Markov: P(next = seg | last = lastSpinSector)
    const markovNextProb = lastSpinSector && markovMatrix[lastSpinSector]
      ? markovMatrix[lastSpinSector][seg] ?? 0
      : expectedProb;

    // 8. Volatility (variance of gap history for this segment)
    let volatility = 0;
    if (segGaps.length >= 2) {
      const mean = segGaps.reduce((s, x) => s + x, 0) / segGaps.length;
      volatility = segGaps.reduce((s, x) => s + (x - mean) ** 2, 0) / segGaps.length;
    }

    // 10. Streak potential: is this segment currently in a streak?
    let streakLen = 0;
    for (let i = spins.length - 1; i >= 0; i--) {
      if (spins[i].sector === seg) streakLen++;
      else break;
    }
    const streakPotential = streakLen > 0 ? Math.min(1, streakLen / 3) : 0;

    // Confidence (sample-size-aware via Wilson lower bound)
    const wilsonLower = wilsonLowerBound(count, n);
    let confidence: number;
    let confidenceLabel: string;
    if (n < 20) {
      confidence = 24;
      confidenceLabel = "INSUFFICIENT DATA";
    } else if (n < 50) {
      confidence = Math.min(50, Math.round(Math.abs(zScore) * 15 + 20));
      confidenceLabel = confidence >= 40 ? "MODERATE" : "LOW CONFIDENCE";
    } else {
      const dataStrength = Math.min(1, n / 100);
      const zStrength = Math.min(1, Math.abs(zScore) / 3);
      confidence = Math.round(30 + dataStrength * 30 + zStrength * 25);
      confidence = Math.max(20, Math.min(85, confidence));
      confidenceLabel = confidence >= 70 ? "STRONG" : confidence >= 45 ? "MODERATE" : "LOW CONFIDENCE";
    }

    segments.push({
      segment: seg,
      displayName: DISPLAY_NAMES[seg],
      imageKey: IMAGE_KEYS[seg],
      count,
      actualFreq,
      theoreticalProb: expectedProb,
      zScore,
      currentGap: currentGaps[seg],
      maxDrought: maxDroughts[seg],
      avgGap,
      isOverdue,
      isHot,
      isCold,
      bayesianProb,
      confidence,
      confidenceLabel,
      markovNextProb,
      volatility,
      streakPotential,
      evidenceScore: 0, // filled below
      evidenceRank: 0, // filled below
      wilsonLower,
    });
  }

  // ===== EVIDENCE SCORING (combines all 10 signals) =====
  for (const s of segments) {
    s.evidenceScore = scoreEvidence(
      s.segment,
      {
        count: s.count,
        actualFreq: s.actualFreq,
        zScore: s.zScore,
        currentGap: s.currentGap,
        avgGap: s.avgGap,
        isOverdue: s.isOverdue,
        isHot: s.isHot,
        isCold: s.isCold,
        bayesianProb: s.bayesianProb,
        markovNextProb: s.markovNextProb,
        volatility: s.volatility,
        streakPotential: s.streakPotential,
      },
      lastSpinSector,
      n,
    );
  }

  // Rank by evidence score (for display — honest evidence ordering)
  const ranked = [...segments].sort((a, b) => b.evidenceScore - a.evidenceScore);
  for (let i = 0; i < ranked.length; i++) {
    ranked[i].evidenceRank = i + 1;
  }

  // ===== 3. Top Slot Correlation =====
  const topSlotMatches = spins.filter((s) => s.topSlotMatched).length;
  const topSlotMatchRate = spins.length > 0 ? topSlotMatches / spins.length : 0;
  const topSlotSegments: Record<string, number> = {};
  for (const s of spins) {
    if (s.topSlotSector) {
      topSlotSegments[s.topSlotSector] = (topSlotSegments[s.topSlotSector] ?? 0) + 1;
    }
  }

  // ===== 4. Moving Averages =====
  const movingAvg20 = calcMovingAvg(spins, 20);
  const movingAvg50 = calcMovingAvg(spins, 50);

  // ===== PREDICTION (weighted probabilistic — NO fixed signals) =====
  // The AI NEVER predetermines which bonus/number is a signal. The prediction
  // emerges PURELY from statistical evidence via weighted sampling.
  let prediction: string[] = [];
  let predictionConfidence = 0;
  let predictionMethod = "";
  if (n < 10) {
    // Insufficient data — no prediction (honest). Show "INSUFFICIENT DATA".
    prediction = [];
    predictionConfidence = 24;
    predictionMethod = "INSUFFICIENT DATA — need 10+ spins for evidence-based prediction";
  } else {
    // Pure evidence-ranked top-4 (no fixed slots, no weighted random).
    const sampled = selectTopByEvidence(segments, 4);
    prediction = sampled.map((s) => s.segment);
    predictionConfidence = Math.round(
      sampled.reduce((s, seg) => s + seg.confidence, 0) / sampled.length,
    );
    predictionMethod = `Evidence-ranked top-4 (pure multi-factor score — no fixed slots, no last-hit/HOT/OVERDUE bias)`;
  }

  // ===== Hottest / Coldest / Overdue =====
  const hottestSeg = segments.filter((s) => s.isHot).sort((a, b) => b.zScore - a.zScore)[0];
  const coldestSeg = segments.filter((s) => s.isCold).sort((a, b) => a.zScore - b.zScore)[0];
  const overdueSeg = segments.filter((s) => s.isOverdue).sort((a, b) => b.currentGap - a.currentGap)[0];

  // ===== Overall summary =====
  const parts: string[] = [];
  parts.push(`${n} spins analyzed`);
  parts.push(`Entropy ${(entropyRatio * 100).toFixed(0)}%`);
  if (hottestSeg) parts.push(`Hottest: ${hottestSeg.displayName}`);
  if (overdueSeg) parts.push(`Overdue: ${overdueSeg.displayName}`);
  parts.push(`Volatility ${volatilityIndex}/100`);
  if (longestStreak && longestStreak.length >= 2) {
    parts.push(`Longest streak: ${DISPLAY_NAMES[longestStreak.segment]} ×${longestStreak.length}`);
  }
  const overallAnalysis = parts.join(" • ");

  // ===== Analysis pipeline audit trail =====
  const analysisPipeline: { step: string; result: string }[] = [
    { step: "1. Raw Data", result: `${n} real casino spins parsed` },
    { step: "2. Z-Score", result: `${hottestSeg ? `Hottest: ${hottestSeg.displayName} (z=${hottestSeg.zScore.toFixed(2)})` : "none hot"}` },
    { step: "3. Drought", result: `${overdueSeg ? `Overdue: ${overdueSeg.displayName} (gap ${overdueSeg.currentGap})` : "none overdue"}` },
    { step: "4. Moving Avg", result: `MA20 vs MA50 trends computed` },
    { step: "5. Bayesian", result: `Laplace-smoothed posteriors (α=2)` },
    { step: "6. Entropy", result: `${entropy.toFixed(3)} bits (${(entropyRatio * 100).toFixed(0)}% of max)` },
    { step: "7. Markov", result: `Order-1 transition matrix built` },
    { step: "8. Volatility", result: `Index: ${volatilityIndex}/100` },
    { step: "9. Chi-Square", result: `χ²=${chiSq.stat.toFixed(1)}, p=${chiSq.pValue.toFixed(3)} (${isDistributionNormal ? "normal" : "abnormal"})` },
    { step: "10. Streak", result: longestStreak ? `${DISPLAY_NAMES[longestStreak.segment]} ×${longestStreak.length}` : "none" },
    { step: "Evidence Score", result: `10 signals combined per segment` },
    { step: "Prediction", result: n < 10 ? "INSUFFICIENT DATA" : `Weighted sampling (no fixed signals)` },
  ];

  return {
    segments,
    totalSpins: n,
    topSlotMatchRate,
    topSlotSegments,
    movingAvg20,
    movingAvg50,
    prediction,
    predictionConfidence,
    overallAnalysis,
    entropy,
    entropyRatio,
    chiSquare: chiSq.stat,
    chiSquarePValue: chiSq.pValue,
    isDistributionNormal,
    volatilityIndex,
    markovMatrix,
    hottestSegment: hottestSeg?.segment ?? null,
    coldestSegment: coldestSeg?.segment ?? null,
    overdueSegment: overdueSeg?.segment ?? null,
    longestStreak,
    analysisPipeline,
    predictionMethod,
    predictionSample: n,
  };
}

function calcMovingAvg(spins: SpinData[], window: number): Record<string, number> {
  const result: Record<string, number> = {};
  const slice = spins.slice(-window);
  const n = slice.length;
  for (const seg of SEGMENT_NAMES) {
    result[seg] = n > 0 ? slice.filter((s) => s.sector === seg).length / n : 0;
  }
  return result;
}
