/**
 * MODEL ENSEMBLE — Maximum Performance Prediction System
 * ======================================================
 *
 * Independent models, each returns 8 probabilities + confidence + uncertainty.
 * Fusion weights learned ONLY from training data. If a signal has no
 * demonstrated incremental value, its weight = 0.
 *
 * Models:
 *   A = theoretical prior (54-segment base probabilities)
 *   B = C1-C9 history engine
 *   C = video physics (stopping angle → 54-sector → 8-outcome)
 *   D = ML model (logistic regression on physics + history features)
 *   E = uncertainty/calibration model
 *
 * FUSION:
 *   P_fused(outcome) = Σ wi * Pi(outcome) / Σ wi
 *   where wi = learned_weight_i * confidence_i
 *
 * No theoretical fallback. If video is insufficient, its weight → 0.
 */

import { GAMES, THEORETICAL, BONUS_NAMES } from "./decisionEngine";
import type { PhysicsSnapshot } from "./videoPhysicsHistory";
import { predictStoppingAngle, type PhysicsPrediction } from "./videoPhysicsPredictor";
import { isPhysicallyMoving, countPhysicallyMovingFrames } from "./videoPhysicsHistory";

// ============================================================
// TYPES
// ============================================================

export interface ModelOutput {
  name: string;
  outcomeProbabilities: Record<string, number>; // 8 outcomes, sum to ~1
  confidence: number; // 0..1
  uncertainty: number; // 0..1 (higher = less certain)
  isValid: boolean;
  reason: string;
}

export interface EnsemblePrediction {
  modelVersion: string;
  lockTimestamp: number;
  // Individual model outputs
  models: {
    A_theoretical: ModelOutput;
    B_history: ModelOutput;
    C_video: ModelOutput;
    D_ml: ModelOutput;
    E_calibration: ModelOutput;
  };
  // Fusion
  fusedProbabilities: Record<string, number>;
  top4: string[];
  top4Coverage: number;
  fusionConfidence: number;
  fusionUncertainty: number;
  // Weights used
  weights: {
    A: number;
    B: number;
    C: number;
    D: number;
    E: number;
  };
  // Physics metadata
  physicsPrediction: PhysicsPrediction | null;
  // Lock metadata
  predictionId: string;
  experimentSessionId: string;
  immutable: boolean; // once locked, never modified
}

export interface EnsembleWeights {
  A: number; // theoretical
  B: number; // history
  C: number; // video
  D: number; // ML
  E: number; // calibration
  version: string;
  learnedFrom: number;
  lastUpdated: number;
}

// ============================================================
// DEFAULT WEIGHTS (untrained — history + theoretical only)
// ============================================================

export const DEFAULT_ENSEMBLE_WEIGHTS: EnsembleWeights = {
  A: 0.3, // theoretical prior (30% — always available)
  B: 0.7, // history engine (70% — main signal)
  C: 0.0, // video (0% — unvalidated)
  D: 0.0, // ML (0% — untrained)
  E: 0.0, // calibration (0% — untrained)
  version: "ensemble-v1-untrained",
  learnedFrom: 0,
  lastUpdated: Date.now(),
};

// ============================================================
// MODEL A: THEORETICAL PRIOR
// ============================================================

export function modelA_Theoretical(): ModelOutput {
  const probs: Record<string, number> = {};
  for (const g of GAMES) probs[g.name] = THEORETICAL[g.name] ?? 0;
  return {
    name: "A_theoretical",
    outcomeProbabilities: probs,
    confidence: 0.5, // moderate — it's a fixed prior
    uncertainty: 0.5,
    isValid: true,
    reason: "Theoretical 54-segment prior",
  };
}

// ============================================================
// MODEL B: C1-C9 HISTORY
// ============================================================

export function modelB_History(
  historyProbs: Record<string, number>,
  historyConfidence: number,
): ModelOutput {
  const valid = Object.values(historyProbs).some((v) => v > 0);
  return {
    name: "B_history",
    outcomeProbabilities: valid ? historyProbs : Object.fromEntries(GAMES.map((g) => [g.name, THEORETICAL[g.name] ?? 0])),
    confidence: valid ? historyConfidence : 0.3,
    uncertainty: valid ? 1 - historyConfidence : 0.7,
    isValid: valid,
    reason: valid ? "C1-C9 dynamic engine" : "No history data — using theoretical fallback",
  };
}

// ============================================================
// MODEL C: VIDEO PHYSICS
// ============================================================

export function modelC_Video(
  snapshots: PhysicsSnapshot[],
  lockTimestamp: number,
): { output: ModelOutput; prediction: PhysicsPrediction | null } {
  const prediction = predictStoppingAngle(snapshots, lockTimestamp);

  if (!prediction.isValid) {
    return {
      output: {
        name: "C_video",
        outcomeProbabilities: Object.fromEntries(GAMES.map((g) => [g.name, 0])),
        confidence: 0,
        uncertainty: 1,
        isValid: false,
        reason: `VIDEO INSUFFICIENT — ${prediction.reason}`,
      },
      prediction,
    };
  }

  return {
    output: {
      name: "C_video",
      outcomeProbabilities: prediction.outcomeProbabilities,
      confidence: prediction.physicsConfidence,
      uncertainty: Math.min(1, prediction.angularUncertainty / 180),
      isValid: true,
      reason: prediction.reason,
    },
    prediction,
  };
}

// ============================================================
// MODEL D: ML (placeholder — uses video prediction when available)
// ============================================================

export function modelD_ML(
  videoPrediction: PhysicsPrediction | null,
): ModelOutput {
  if (!videoPrediction || !videoPrediction.isValid) {
    return {
      name: "D_ml",
      outcomeProbabilities: Object.fromEntries(GAMES.map((g) => [g.name, 0])),
      confidence: 0,
      uncertainty: 1,
      isValid: false,
      reason: "ML model not trained — need 20+ labeled spins",
    };
  }

  // When ML is untrained, use video prediction as a proxy
  // (This will be replaced by actual ML predictions once trained)
  return {
    name: "D_ml",
    outcomeProbabilities: videoPrediction.outcomeProbabilities,
    confidence: 0, // unvalidated
    uncertainty: 1,
    isValid: false,
    reason: "ML model untrained — using video proxy (weight=0)",
  };
}

// ============================================================
// MODEL E: CALIBRATION
// ============================================================

export function modelE_Calibration(
  otherModels: ModelOutput[],
): ModelOutput {
  // Average the valid model predictions
  const validModels = otherModels.filter((m) => m.isValid);
  if (validModels.length === 0) {
    return {
      name: "E_calibration",
      outcomeProbabilities: Object.fromEntries(GAMES.map((g) => [g.name, THEORETICAL[g.name] ?? 0])),
      confidence: 0.3,
      uncertainty: 0.7,
      isValid: true,
      reason: "No valid models — theoretical fallback for calibration only",
    };
  }

  const avgProbs: Record<string, number> = {};
  for (const g of GAMES) avgProbs[g.name] = 0;
  for (const m of validModels) {
    for (const g of GAMES) {
      avgProbs[g.name] += m.outcomeProbabilities[g.name] ?? 0;
    }
  }
  for (const g of GAMES) avgProbs[g.name] /= validModels.length;

  return {
    name: "E_calibration",
    outcomeProbabilities: avgProbs,
    confidence: validModels.length / otherModels.length,
    uncertainty: 1 - validModels.length / otherModels.length,
    isValid: true,
    reason: `Calibration model (average of ${validModels.length} valid models)`,
  };
}

// ============================================================
// 70-COMBINATION OPTIMIZER
// ============================================================

export function selectTop4(probs: Record<string, number>): {
  top4: string[];
  coverage: number;
} {
  const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  const top4 = sorted.slice(0, 4).map((x) => x[0]);
  const coverage = top4.reduce((s, name) => s + (probs[name] ?? 0), 0);
  return { top4, coverage };
}

// ============================================================
// ENSEMBLE FUSION
// ============================================================

export function runEnsemble(
  snapshots: PhysicsSnapshot[],
  lockTimestamp: number,
  historyProbs: Record<string, number>,
  historyConfidence: number,
  weights: EnsembleWeights,
  experimentSessionId: string,
): EnsemblePrediction {
  // Run individual models
  const A = modelA_Theoretical();
  const B = modelB_History(historyProbs, historyConfidence);
  const { output: C, prediction: physicsPrediction } = modelC_Video(snapshots, lockTimestamp);
  const D = modelD_ML(physicsPrediction);
  const E = modelE_Calibration([A, B, C, D]);

  const models = { A_theoretical: A, B_history: B, C_video: C, D_ml: D, E_calibration: E };

  // Compute effective weights (weight * confidence)
  const wA = weights.A * A.confidence;
  const wB = weights.B * B.confidence;
  const wC = C.isValid ? weights.C * C.confidence : 0;
  const wD = D.isValid ? weights.D * D.confidence : 0;
  const wE = weights.E * E.confidence;
  const totalW = wA + wB + wC + wD + wE;

  // Fuse probabilities
  const fusedProbs: Record<string, number> = {};
  for (const g of GAMES) fusedProbs[g.name] = 0;
  if (totalW > 0) {
    for (const g of GAMES) {
      fusedProbs[g.name] =
        (wA * (A.outcomeProbabilities[g.name] ?? 0) +
          wB * (B.outcomeProbabilities[g.name] ?? 0) +
          wC * (C.outcomeProbabilities[g.name] ?? 0) +
          wD * (D.outcomeProbabilities[g.name] ?? 0) +
          wE * (E.outcomeProbabilities[g.name] ?? 0)) / totalW;
    }
  }

  // Normalize
  const sum = Object.values(fusedProbs).reduce((s, v) => s + v, 0);
  if (sum > 0) {
    for (const k of Object.keys(fusedProbs)) fusedProbs[k] /= sum;
  }

  // Select Top-4
  const { top4, coverage } = selectTop4(fusedProbs);

  // Fusion confidence
  const fusionConfidence = totalW > 0
    ? (wA * A.confidence + wB * B.confidence + wC * C.confidence + wD * D.confidence + wE * E.confidence) / totalW
    : 0;

  const fusionUncertainty = 1 - fusionConfidence;

  return {
    modelVersion: "ensemble-v1-maxperf",
    lockTimestamp,
    models,
    fusedProbabilities: fusedProbs,
    top4,
    top4Coverage: coverage,
    fusionConfidence,
    fusionUncertainty,
    weights: { A: wA, B: wB, C: wC, D: wD, E: wE },
    physicsPrediction,
    predictionId: `pred-${lockTimestamp}-${Math.random().toString(36).slice(2, 8)}`,
    experimentSessionId,
    immutable: true, // PREDICTION IS IMMUTABLE
  };
}

// ============================================================
// PAPER-BETTING SIMULATOR
// ============================================================

export interface BetSimulation {
  predictionId: string;
  spinId: string;
  top4: string[];
  actualOutcome: string;
  hit: boolean;
  stake: number;
  payout: number; // positive = win, negative = loss
  bankroll: number;
  cumulativePnl: number;
  roi: number;
  drawdown: number;
  maxBankroll: number;
}

export interface SimulationReport {
  totalBets: number;
  hits: number;
  misses: number;
  hitRate: number;
  totalStake: number;
  totalPayout: number;
  netProfit: number;
  roi: number;
  maxDrawdown: number;
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreak: number; // positive = win streak, negative = loss streak
  finalBankroll: number;
  startingBankroll: number;
}

export class PaperBettingSimulator {
  private bankroll: number;
  private startingBankroll: number;
  private stakePerBet: number;
  private maxBankroll: number;
  private maxDrawdown: number;
  private bets: BetSimulation[] = [];
  private winStreak = 0;
  private lossStreak = 0;
  private longestWinStreak = 0;
  private longestLossStreak = 0;

  constructor(startingBankroll: number, stakePerBet: number) {
    this.startingBankroll = startingBankroll;
    this.bankroll = startingBankroll;
    this.stakePerBet = stakePerBet;
    this.maxBankroll = startingBankroll;
    this.maxDrawdown = 0;
  }

  placeBet(
    predictionId: string,
    spinId: string,
    top4: string[],
    actualOutcome: string,
  ): BetSimulation {
    const hit = top4.includes(actualOutcome);
    const stake = this.stakePerBet;
    const payout = hit ? stake * 3 - stake : -stake; // 3:1 payout for Top-4 hit
    this.bankroll += payout;

    if (this.bankroll > this.maxBankroll) {
      this.maxBankroll = this.bankroll;
    }
    const drawdown = this.maxBankroll - this.bankroll;
    if (drawdown > this.maxDrawdown) {
      this.maxDrawdown = drawdown;
    }

    if (hit) {
      this.winStreak++;
      this.lossStreak = 0;
      if (this.winStreak > this.longestWinStreak) this.longestWinStreak = this.winStreak;
    } else {
      this.lossStreak++;
      this.winStreak = 0;
      if (this.lossStreak > this.longestLossStreak) this.longestLossStreak = this.lossStreak;
    }

    const cumulativePnl = this.bankroll - this.startingBankroll;
    const roi = this.startingBankroll > 0 ? cumulativePnl / this.startingBankroll : 0;

    const bet: BetSimulation = {
      predictionId,
      spinId,
      top4,
      actualOutcome,
      hit,
      stake,
      payout,
      bankroll: this.bankroll,
      cumulativePnl,
      roi,
      drawdown,
      maxBankroll: this.maxBankroll,
    };
    this.bets.push(bet);
    return bet;
  }

  getReport(): SimulationReport {
    const hits = this.bets.filter((b) => b.hit).length;
    const total = this.bets.length;
    const totalStake = this.bets.reduce((s, b) => s + b.stake, 0);
    const totalPayout = this.bets.reduce((s, b) => s + b.payout, 0);
    return {
      totalBets: total,
      hits,
      misses: total - hits,
      hitRate: total > 0 ? hits / total : 0,
      totalStake,
      totalPayout,
      netProfit: totalPayout,
      roi: totalStake > 0 ? totalPayout / totalStake : 0,
      maxDrawdown: this.maxDrawdown,
      longestWinStreak: this.longestWinStreak,
      longestLossStreak: this.longestLossStreak,
      currentStreak: this.winStreak > 0 ? this.winStreak : -this.lossStreak,
      finalBankroll: this.bankroll,
      startingBankroll: this.startingBankroll,
    };
  }

  getBets(): BetSimulation[] {
    return this.bets;
  }

  reset(): void {
    this.bankroll = this.startingBankroll;
    this.maxBankroll = this.startingBankroll;
    this.maxDrawdown = 0;
    this.bets = [];
    this.winStreak = 0;
    this.lossStreak = 0;
    this.longestWinStreak = 0;
    this.longestLossStreak = 0;
  }
}
