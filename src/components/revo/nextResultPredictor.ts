/**
 * NEXT RESULT PREDICTOR
 * =====================
 *
 * Replaces Top-4 with a SINGLE next-result prediction.
 *
 * The system answers ONE question: "WHAT IS THE NEXT RESULT?"
 *
 * Evaluates ALL 8 outcomes using multiple evidence signals, then selects
 * ONLY the highest-scoring outcome as NEXT_RESULT.
 *
 * NO Top-4. NO alternatives. NO backup predictions. NO coverage sets.
 *
 * If the same outcome remains #1 after fresh evidence, it stays #1.
 * No random selection. No rotation. No forced diversity.
 */

import {
  GAMES,
  THEORETICAL,
  BONUS_NAMES,
  type RoundResult,
} from "./decisionEngine";
import type { SpinData } from "./aiStats";

// ============================================================
// TYPES
// ============================================================

export type SignalState = "READY" | "INSUFFICIENT" | "STALE" | "DISABLED";

export interface OutcomeScore {
  outcome: string;
  scores: {
    theory: number;
    history: number;
    time: number;
    dealer: number;
    physics: number;
    ml: number;
    crossing: number;
  };
  finalScore: number;
}

export interface NextResultPrediction {
  predictionId: string;
  predictedOutcome: string;
  scores: OutcomeScore[];
  signalStates: {
    history: SignalState;
    time: SignalState;
    dealer: SignalState;
    physics: SignalState;
    ml: SignalState;
    crossing: SignalState;
  };
  confidence: number;
  lockTimestamp: number;
  latestUsedTimestamp: number;
  modelVersion: string;
  immutable: boolean;
}

export interface SettlementResult {
  predictionId: string;
  predictedOutcome: string;
  actualOutcome: string;
  hit: boolean;
  missRCA: string | null;
  settledAt: number;
}

// ============================================================
// SCORING FUNCTIONS
// ============================================================

function theoryScore(outcome: string): number {
  return THEORETICAL[outcome] ?? 0;
}

function historyScore(history: RoundResult[], outcome: string): number {
  if (history.length === 0) return 0;
  const count = history.filter((r) => r.actualResult.name === outcome).length;
  const expected = (THEORETICAL[outcome] ?? 0.1) * history.length;
  if (expected === 0) return 0;
  return Math.min(2.0, count / expected);
}

function timeScore(history: RoundResult[], outcome: string): number {
  const intervals: number[] = [];
  let lastIdx = -1;
  for (let i = 0; i < history.length; i++) {
    if (history[i].actualResult.name === outcome) {
      if (lastIdx >= 0) intervals.push(i - lastIdx);
      lastIdx = i;
    }
  }
  if (intervals.length < 2) return 0.5;
  const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  const sinceLast = history.length - 1 - lastIdx;
  if (avgInterval === 0) return 0.5;
  const ratio = sinceLast / avgInterval;
  return Math.max(0, 1.0 - Math.abs(ratio - 1.0) * 0.5);
}

function dealerScore(history: RoundResult[], outcome: string): number {
  // Dealer score: based on whether the last result was from the same dealer session
  // For now, use recent transition tendency
  if (history.length < 3) return 0.5;
  const recent = history.slice(-5);
  const recentCount = recent.filter((r) => r.actualResult.name === outcome).length;
  const expected = (THEORETICAL[outcome] ?? 0.1) * recent.length;
  if (expected === 0) return 0.5;
  return Math.min(1.5, recentCount / expected);
}

function crossingScore(history: RoundResult[], outcome: string): number {
  // Transition probability from last result
  if (history.length < 2) return 0.5;
  const lastResult = history[history.length - 1].actualResult.name;
  let transitionsFromLast = 0;
  let transitionsToOutcome = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i - 1].actualResult.name === lastResult) {
      transitionsFromLast++;
      if (history[i].actualResult.name === outcome) {
        transitionsToOutcome++;
      }
    }
  }
  if (transitionsFromLast === 0) return 0.5;
  return transitionsToOutcome / transitionsFromLast;
}

function physicsScore(outcome: string, physicsData?: Record<string, number>): number {
  if (!physicsData) return 0;
  return physicsData[outcome] ?? 0;
}

function mlScore(outcome: string, mlData?: Record<string, number>): number {
  if (!mlData) return 0;
  return mlData[outcome] ?? 0;
}

// ============================================================
// MAIN PREDICTION
// ============================================================

/**
 * Generate a SINGLE next-result prediction.
 *
 * Evaluates ALL 8 outcomes, scores each, and selects ONLY the highest.
 * NO Top-4. NO alternatives.
 */
export function predictNextResult(
  history: RoundResult[],
  liveSpins: SpinData[],
  physicsData?: Record<string, number>,
  mlData?: Record<string, number>,
): NextResultPrediction {
  const MODEL_VERSION = "next-result-v1";
  const lockTimestamp = Date.now();
  const latestUsedTimestamp = lockTimestamp;

  // Determine signal states
  const historyState: SignalState = history.length >= 5 ? "READY" : history.length >= 1 ? "INSUFFICIENT" : "DISABLED";
  const timeState: SignalState = history.length >= 10 ? "READY" : history.length >= 3 ? "INSUFFICIENT" : "DISABLED";
  const dealerState: SignalState = history.length >= 5 ? "READY" : "INSUFFICIENT";
  const physicsState: SignalState = physicsData ? "READY" : "INSUFFICIENT";
  const mlState: SignalState = mlData ? "READY" : "INSUFFICIENT";
  const crossingState: SignalState = history.length >= 3 ? "READY" : "INSUFFICIENT";

  // Score all 8 outcomes
  const scores: OutcomeScore[] = GAMES.map((game) => {
    const outcome = game.name;

    const theory = theoryScore(outcome);
    const hist = historyState === "READY" || historyState === "INSUFFICIENT"
      ? historyScore(history, outcome)
      : 0;
    const time = timeState === "READY" || timeState === "INSUFFICIENT"
      ? timeScore(history, outcome)
      : 0.5;
    const dealer = dealerState === "READY"
      ? dealerScore(history, outcome)
      : 0.5;
    const physics = physicsState === "READY"
      ? physicsScore(outcome, physicsData)
      : 0;
    const ml = mlState === "READY"
      ? mlScore(outcome, mlData)
      : 0;
    const crossing = crossingState === "READY" || crossingState === "INSUFFICIENT"
      ? crossingScore(history, outcome)
      : 0.5;

    // Weighted final score
    // Theory is the base prior. Other signals modulate it.
    // Only signals that are READY contribute their full weight.
    // INSUFFICIENT signals contribute at reduced weight.
    const weights = {
      theory: 0.25,
      history: historyState === "READY" ? 0.20 : historyState === "INSUFFICIENT" ? 0.10 : 0,
      time: timeState === "READY" ? 0.15 : timeState === "INSUFFICIENT" ? 0.05 : 0,
      dealer: dealerState === "READY" ? 0.10 : 0,
      physics: physicsState === "READY" ? 0.15 : 0,
      ml: mlState === "READY" ? 0.10 : 0,
      crossing: crossingState === "READY" ? 0.15 : crossingState === "INSUFFICIENT" ? 0.05 : 0,
    };

    const totalWeight = Object.values(weights).reduce((s, v) => s + v, 0);
    const finalScore = totalWeight > 0
      ? (theory * weights.theory +
          hist * weights.history +
          time * weights.time +
          dealer * weights.dealer +
          physics * weights.physics +
          ml * weights.ml +
          crossing * weights.crossing) / totalWeight
      : theory;

    return {
      outcome,
      scores: {
        theory,
        history: hist,
        time,
        dealer,
        physics,
        ml,
        crossing,
      },
      finalScore,
    };
  });

  // Sort by final score (descending) — NO RANDOM TIEBREAKING
  scores.sort((a, b) => {
    if (Math.abs(b.finalScore - a.finalScore) < 0.0001) {
      // Tie: use theoretical probability as tiebreaker (deterministic)
      return (b.scores.theory - a.scores.theory);
    }
    return b.finalScore - a.finalScore;
  });

  // Select ONLY the #1 outcome
  const predictedOutcome = scores[0].outcome;

  // Confidence: how much the #1 stands above #2
  const topScore = scores[0].finalScore;
  const secondScore = scores[1]?.finalScore ?? 0;
  const margin = topScore - secondScore;
  const confidence = Math.min(1, 0.3 + margin * 2 + topScore * 0.3);

  return {
    predictionId: `next-${lockTimestamp}-${Math.random().toString(36).slice(2, 6)}`,
    predictedOutcome,
    scores,
    signalStates: {
      history: historyState,
      time: timeState,
      dealer: dealerState,
      physics: physicsState,
      ml: mlState,
      crossing: crossingState,
    },
    confidence,
    lockTimestamp,
    latestUsedTimestamp,
    modelVersion: MODEL_VERSION,
    immutable: true,
  };
}

// ============================================================
// SETTLEMENT
// ============================================================

/**
 * Settle a prediction against the actual result.
 * Records HIT/MISS and generates miss RCA.
 */
export function settlePrediction(
  prediction: NextResultPrediction,
  actualOutcome: string,
): SettlementResult {
  const hit = prediction.predictedOutcome === actualOutcome;

  let missRCA: string | null = null;
  if (!hit) {
    // Find where the actual outcome ranked
    const actualIdx = prediction.scores.findIndex((s) => s.outcome === actualOutcome);
    const actualScore = prediction.scores[actualIdx];
    const predictedScore = prediction.scores[0];

    const reasons: string[] = [];
    reasons.push(`Predicted: ${predictedScore.outcome} (${(predictedScore.finalScore * 100).toFixed(1)}%)`);
    reasons.push(`Actual: ${actualOutcome} (ranked #${actualIdx + 1}, score ${(actualScore?.finalScore * 100 ?? 0).toFixed(1)}%)`);

    // Compare scores
    if (actualScore) {
      const scoreDiff = predictedScore.finalScore - actualScore.finalScore;
      reasons.push(`Margin: ${(scoreDiff * 100).toFixed(1)}pp`);

      // Which signals favored the actual?
      const signals = ["history", "time", "dealer", "physics", "ml", "crossing"] as const;
      for (const sig of signals) {
        if (actualScore.scores[sig] > predictedScore.scores[sig]) {
          reasons.push(`${sig} favored actual (${actualScore.scores[sig].toFixed(2)} vs ${predictedScore.scores[sig].toFixed(2)})`);
        }
      }
    }

    missRCA = reasons.join(" · ");
  }

  return {
    predictionId: prediction.predictionId,
    predictedOutcome: prediction.predictedOutcome,
    actualOutcome,
    hit,
    missRCA,
    settledAt: Date.now(),
  };
}

// ============================================================
// WALK-FORWARD VALIDATION (Top-1 accuracy)
// ============================================================

export interface NextResultValidation {
  totalRounds: number;
  hits: number;
  misses: number;
  top1HitRate: number;
  bonusHits: number;
  bonusTotal: number;
  bonusCaptureRate: number;
  rounds: Array<{
    idx: number;
    actual: string;
    predicted: string;
    hit: boolean;
    confidence: number;
    margin: number;
  }>;
  logLoss: number;
  brierScore: number;
}

/**
 * Validate the next-result predictor using walk-forward testing.
 * Primary metric: Top-1 HIT RATE.
 */
export function validateNextResult(
  actualNames: string[],
  liveSpins: SpinData[] = [],
): NextResultValidation {
  const history: RoundResult[] = [];
  const rounds: NextResultValidation["rounds"] = [];
  let hits = 0;
  let bonusHits = 0;
  let bonusTotal = 0;
  let logLossSum = 0;
  let brierSum = 0;

  for (let i = 0; i < actualNames.length; i++) {
    const actualName = actualNames[i];
    const actualGame = GAMES.find((g) => g.name === actualName) ?? GAMES[0];

    // Predict using ONLY pre-round history
    const prediction = predictNextResult(history, liveSpins);
    const hit = prediction.predictedOutcome === actualName;
    const isBonus = BONUS_NAMES.includes(actualName);

    const topScore = prediction.scores[0].finalScore;
    const secondScore = prediction.scores[1]?.finalScore ?? 0;
    const margin = topScore - secondScore;

    rounds.push({
      idx: i + 1,
      actual: actualName,
      predicted: prediction.predictedOutcome,
      hit,
      confidence: prediction.confidence,
      margin,
    });

    if (hit) hits++;
    if (isBonus) {
      bonusTotal++;
      if (hit) bonusHits++;
    }

    // Log loss
    const predictedProb = prediction.scores.find((s) => s.outcome === actualName)?.finalScore ?? 0.01;
    logLossSum += -Math.log(Math.max(1e-9, predictedProb));

    // Brier score
    brierSum += (1 - predictedProb) ** 2;

    // Settle round
    history.push({
      prediction: [],
      actualResult: actualGame,
      hit,
      time: Date.now() + i,
      confidence: 50,
      recalibrated: false,
    });
  }

  const total = actualNames.length;
  return {
    totalRounds: total,
    hits,
    misses: total - hits,
    top1HitRate: total > 0 ? hits / total : 0,
    bonusHits,
    bonusTotal,
    bonusCaptureRate: bonusTotal > 0 ? bonusHits / bonusTotal : 0,
    rounds,
    logLoss: total > 0 ? logLossSum / total : 0,
    brierScore: total > 0 ? brierSum / total : 0,
  };
}
