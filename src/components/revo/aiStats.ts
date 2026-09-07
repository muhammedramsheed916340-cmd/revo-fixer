"use client";

/**
 * AI Statistical Analysis Engine for Crazy Time predictions.
 *
 * Uses real historical spin data from the CasinoScores API to perform:
 * 1. Variance & Z-Score Analysis — actual vs theoretical frequency
 * 2. Maximum Drought & Gap Analysis — overdue detection
 * 3. Top Slot Correlation — multiplier matching trends
 * 4. Moving Averages — rolling trend detection
 * 5. Bayesian Probability Forecasting — weighted predictions
 *
 * All outputs are data-driven. "STRONG" confidence only when statistics support it.
 */

// Theoretical probabilities for each Crazy Time segment (based on wheel layout).
// Crazy Time wheel: 54 segments total.
// 1: 21 segments → 38.89%
// 2: 13 segments → 24.07%
// 5: 7 segments → 12.96%
// 10: 4 segments → 7.41%
// CoinFlip: 4 segments → 7.41%
// Pachinko: 2 segments → 3.70%
// CashHunt: 2 segments → 3.70%
// CrazyTime: 1 segment → 1.85%
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

// Standard names used by our prediction system
export const SEGMENT_NAMES = ["1", "2", "5", "10", "CoinFlip", "Pachinko", "CashHunt", "CrazyTime"];

// Display names for UI
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

// Image keys for Cloudinary card images
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

export interface SegmentStat {
  segment: string;
  displayName: string;
  imageKey: string;
  count: number;
  actualFreq: number; // actual hit frequency (0-1)
  theoreticalProb: number; // theoretical probability (0-1)
  zScore: number; // positive = hot (overperforming), negative = overdue
  currentGap: number; // spins since last hit
  maxDrought: number; // longest historical gap
  avgGap: number; // average gap between hits
  isOverdue: boolean; // currentGap > avgGap * 1.5
  isHot: boolean; // zScore > 1.5
  isCold: boolean; // zScore < -1.5
  bayesianProb: number; // updated probability after Bayesian analysis
  confidence: number; // 0-100, derived from data strength
  confidenceLabel: string; // STRONG / MODERATE / LOW / INSUFFICIENT
}

export interface AnalysisResult {
  segments: SegmentStat[];
  totalSpins: number;
  topSlotMatchRate: number; // 0-1
  topSlotSegments: Record<string, number>; // top slot favoring
  movingAvg20: Record<string, number>; // last 20 spins frequency
  movingAvg50: Record<string, number>; // last 50 spins frequency
  prediction: string[]; // 4 segment names, ranked by bayesianProb
  predictionConfidence: number; // 0-100
  overallAnalysis: string; // human-readable summary
}

export interface SpinData {
  sector: string;
  topSlotSector?: string;
  topSlotMatched: boolean;
  multiplier?: number;
  settledAt: string;
}

/**
 * Map API sector names to our standard segment names.
 */
function normalizeSector(raw: string): string {
  const map: Record<string, string> = {
    "1": "1", "2": "2", "5": "5", "10": "10",
    CoinFlip: "CoinFlip", Pachinko: "Pachinko", CashHunt: "CashHunt",
    CrazyTime: "CrazyTime", CrazyBonus: "CrazyTime",
  };
  return map[raw] ?? raw;
}

/**
 * Parse raw API results into normalized spin data.
 */
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

/**
 * Main analysis function — performs all 5 statistical operations.
 */
export function analyzeSpins(spins: SpinData[]): AnalysisResult {
  const n = spins.length;
  const segments: SegmentStat[] = [];

  // Per-segment raw data
  const counts: Record<string, number> = {};
  const gaps: Record<string, number[]> = {}; // gap sequences
  const currentGaps: Record<string, number> = {};
  const maxDroughts: Record<string, number> = {};

  for (const seg of SEGMENT_NAMES) {
    counts[seg] = 0;
    gaps[seg] = [];
    currentGaps[seg] = 0;
    maxDroughts[seg] = 0;
  }

  // Track gap between hits for each segment
  let lastHitIndex: Record<string, number> = {};
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

  // Calculate current gap (spins since last hit)
  for (const seg of SEGMENT_NAMES) {
    if (lastHitIndex[seg] >= 0) {
      currentGaps[seg] = n - 1 - lastHitIndex[seg];
    } else {
      currentGaps[seg] = n; // never hit in dataset
    }
  }

  // 1. Z-Score Analysis
  for (const seg of SEGMENT_NAMES) {
    const count = counts[seg];
    const actualFreq = n > 0 ? count / n : 0;
    const expectedProb = THEORETICAL_PROB[seg];
    // Z-score: (observed - expected) / sqrt(expected * (1-expected) / n)
    const expected = expectedProb * n;
    const stdDev = Math.sqrt(expected * (1 - expectedProb));
    const zScore = stdDev > 0 ? (count - expected) / stdDev : 0;

    // Average gap
    const segGaps = gaps[seg];
    const avgGap = segGaps.length > 0
      ? segGaps.reduce((s, g) => s + g, 0) / segGaps.length
      : n / Math.max(count, 1);

    const isOverdue = currentGaps[seg] > avgGap * 1.5 && avgGap > 0;
    const isHot = zScore > 1.5;
    const isCold = zScore < -1.5;

    // 5. Bayesian Probability Forecasting
    // Prior = theoretical probability
    // Likelihood = observed frequency (with Laplace smoothing)
    // Posterior = weighted combination of prior and observed
    const alpha = 2; // smoothing parameter
    const posterior = (count + alpha * expectedProb) / (n + alpha);

    // Adjust for overdue segments (gap analysis)
    let bayesianProb = posterior;
    if (isOverdue) {
      // Boost overdue segments slightly (gap-filling)
      bayesianProb *= 1 + Math.min(0.3, (currentGaps[seg] / Math.max(avgGap, 1) - 1) * 0.15);
    }
    if (isHot && zScore > 2) {
      // Slightly dampen extremely hot segments (regression to mean)
      bayesianProb *= 0.9;
    }

    // Confidence calculation
    let confidence: number;
    let confidenceLabel: string;
    if (n < 20) {
      // Deterministic (no Math.random) to avoid SSR hydration mismatch.
      confidence = 24;
      confidenceLabel = "INSUFFICIENT DATA";
    } else if (n < 50) {
      confidence = Math.min(50, Math.round(Math.abs(zScore) * 15 + 20));
      confidenceLabel = confidence >= 40 ? "MODERATE" : "LOW CONFIDENCE";
    } else {
      // With 50+ spins, confidence can reach STRONG
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
    });
  }

  // 3. Top Slot Correlation
  const topSlotMatches = spins.filter((s) => s.topSlotMatched).length;
  const topSlotMatchRate = spins.length > 0 ? topSlotMatches / spins.length : 0;
  const topSlotSegments: Record<string, number> = {};
  for (const s of spins) {
    if (s.topSlotSector) {
      topSlotSegments[s.topSlotSector] = (topSlotSegments[s.topSlotSector] ?? 0) + 1;
    }
  }

  // 4. Moving Averages
  const movingAvg20 = calcMovingAvg(spins, 20);
  const movingAvg50 = calcMovingAvg(spins, 50);

  // 5. Prediction: pick top 4 by bayesianProb
  const ranked = [...segments].sort((a, b) => b.bayesianProb - a.bayesianProb);
  const prediction = ranked.slice(0, 4).map((s) => s.segment);
  const predictionConfidence = Math.round(
    ranked.slice(0, 4).reduce((s, seg) => s + seg.confidence, 0) / 4,
  );

  // Overall analysis summary
  const overdueSegs = segments.filter((s) => s.isOverdue).map((s) => s.displayName);
  const hotSegs = segments.filter((s) => s.isHot).map((s) => s.displayName);
  const parts: string[] = [];
  parts.push(`${n} spins analyzed`);
  if (overdueSegs.length > 0) parts.push(`Overdue: ${overdueSegs.join(", ")}`);
  if (hotSegs.length > 0) parts.push(`Hot: ${hotSegs.join(", ")}`);
  parts.push(`Top Slot match: ${(topSlotMatchRate * 100).toFixed(1)}%`);
  const overallAnalysis = parts.join(" • ");

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
