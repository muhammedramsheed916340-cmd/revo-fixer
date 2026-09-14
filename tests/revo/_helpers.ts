import { GAMES, type GameModel, type RoundResult, ALL_FLAGS_OFF, type FeatureFlags } from "../../src/components/revo/decisionEngine";

const byName = new Map(GAMES.map((g) => [g.name, g]));
export function game(name: string): GameModel {
  return byName.get(name) ?? GAMES[0];
}

/** Build a single settled round. `predNames` is the prediction that was locked;
 *  hit is derived from whether actualName ∈ predNames unless overridden. */
export function makeRound(actualName: string, predNames: string[] = ["1", "2", "5", "10"], hit?: boolean): RoundResult {
  const hitFlag = hit ?? predNames.includes(actualName);
  const now = Date.now();
  return {
    prediction: predNames.map((n) => ({ game: game(n), confidence: 50, time: now })),
    actualResult: game(actualName),
    hit: hitFlag,
    time: now,
    confidence: 50,
    recalibrated: false,
  };
}

/** Build a history of rounds from a sequence of actual result names. Each
 *  round's prediction is assumed to be [1,2,5,10] (the theoretical set) so
 *  hit = actualName ∈ {1,2,5,10}. This mirrors how the live engine settles. */
export function roundsFrom(names: string[], pred = ["1", "2", "5", "10"]): RoundResult[] {
  return names.map((n) => makeRound(n, pred));
}

export { ALL_FLAGS_OFF };
export type { FeatureFlags };

/** All C1–C7 flags ON (the full experimental channel). */
export const ALL_FLAGS_ON: FeatureFlags = {
  c1_calibratedChannel: true,
  c2_genericReliability: true,
  c3_uncertaintyShrinkage: true,
  c4_realOptimizer: true,
  c5_deScopeHarmful: true,
  c6_rcaInstrumentation: true,
  c7_frozenWalkForward: true,
  c8_credibleLowerBound: true,
  c9_recencyExcludeLast: true,
};

/** A representative 30-round history where CRAZY TIME (1.85% prior) appears
 *  3× (expected ~0.55) — a small-sample rare-outcome over-appearance that, in
 *  the baseline 0.5/0.5 blend, inflates CRAZY TIME's rawScore above "1"'s and
 *  displaces a number from Top-4. Used to prove the optimizer can differ. */
export const CRAZY_INFLATED_30: string[] = [
  "1", "2", "1", "5", "2", "1", "CRAZY TIME", "2", "1", "5",
  "10", "1", "2", "1", "COIN FLIP", "5", "2", "1", "CRAZY TIME", "10",
  "1", "2", "1", "5", "2", "1", "CRAZY TIME", "2", "1", "2",
];
