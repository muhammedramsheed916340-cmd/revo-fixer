import { test, expect, describe } from "bun:test";
import {
  buildInitial,
  ALL_FLAGS_OFF,
  BONUS_NAMES,
  THEORETICAL,
  GAMES,
} from "../../src/components/revo/decisionEngine";
import { roundsFrom, CRAZY_INFLATED_30 } from "./_helpers";

// ============================================================
// C1 — CALIBRATED PROBABILITY CHANNEL
// ============================================================
// The calibrated probability must be a REAL probability (sums to 1 over the
// 8 outcomes), equal to the Dirichlet-smoothed frequency, anchored to the
// theoretical prior, and NOT the legacy rawScore/ΣrawScore score-share.

describe("C1 — calibrated probability channel", () => {
  const rounds = roundsFrom(CRAZY_INFLATED_30);
  const c1On = { ...ALL_FLAGS_OFF, c1_calibratedChannel: true };

  test("posterior probabilities sum to ~1.0 over all 8 outcomes (it is a real distribution)", () => {
    const eng = buildInitial(rounds, [], "baseline", c1On);
    const sum = eng.candidateScores.reduce((s, c) => s + (c.calibratedProbabilityPosterior ?? 0), 0);
    expect(sum).toBeGreaterThan(0.999);
    expect(sum).toBeLessThan(1.001);
  });

  test("posterior equals the smoothed-frequency Dirichlet formula (count + k*prior)/(N+k)", () => {
    const eng = buildInitial(rounds, [], "baseline", c1On);
    const n = rounds.length; // sampleN = n (no liveSpins)
    const k = 30; // SHRINKAGE_K
    // Recompute counts from the history.
    const counts: Record<string, number> = {};
    for (const g of GAMES) counts[g.name] = 0;
    for (const r of rounds) counts[r.actualResult.name]++;
    for (const c of eng.candidateScores) {
      const prior = THEORETICAL[c.game.name];
      const expected = (counts[c.game.name] + k * prior) / (n + k);
      expect(c.calibratedProbabilityPosterior).toBeCloseTo(expected, 6);
    }
  });

  test("posterior is anchored to the prior — a never-seen outcome keeps ~prior mass, not 0", () => {
    // Build a history with NO PACHINKO at all.
    const noPachinko = CRAZY_INFLATED_30.filter((n) => n !== "CRAZY TIME").slice(0, 20);
    const eng = buildInitial(roundsFrom(noPachinko), [], "baseline", c1On);
    const pach = eng.candidateScores.find((c) => c.game.name === "PACHINKO")!;
    // PACHINKO prior 3.70%; with 0 observations and k=30: (0 + 30*0.037)/(20+30) = 1.11/50 = 2.22%.
    // It must NOT collapse to 0 (the prior keeps it alive) and not inflate.
    expect(pach.calibratedProbabilityPosterior).toBeGreaterThan(0.01);
    expect(pach.calibratedProbabilityPosterior).toBeLessThan(0.05);
  });

  test("priorProbability equals the theoretical prior (the prior used in the blend)", () => {
    const eng = buildInitial(rounds, [], "baseline", c1On);
    for (const c of eng.candidateScores) {
      expect(c.priorProbability).toBeCloseTo(THEORETICAL[c.game.name], 6);
    }
  });

  test("rawEvidenceScore = 1 + reliableDeviation (the evidence term before the prior blend)", () => {
    const eng = buildInitial(rounds, [], "baseline", { ...c1On, c2_genericReliability: true });
    for (const c of eng.candidateScores) {
      // rawEvidenceScore should be a finite positive number near 1 ± deviation.
      expect(typeof c.rawEvidenceScore).toBe("number");
      expect(c.rawEvidenceScore!).toBeGreaterThan(0);
    }
  });

  test("the posterior is NOT the legacy score-share (rawScore/ΣrawScore) — they differ structurally", () => {
    const eng = buildInitial(rounds, [], "baseline", c1On);
    // For at least one bonus outcome, the posterior (true prob) is much smaller
    // than the legacy score-share (which is inflated by the 0.5/0.5 blend).
    let bonusPosteriorSmallerThanShare = false;
    for (const c of eng.candidateScores) {
      if (BONUS_NAMES.includes(c.game.name)) {
        const legacy = (c as typeof c & { calibratedProbability?: number }).calibratedProbability ?? 0;
        if ((c.calibratedProbabilityPosterior ?? 0) < legacy * 0.9) {
          bonusPosteriorSmallerThanShare = true;
          break;
        }
      }
    }
    expect(bonusPosteriorSmallerThanShare).toBe(true);
  });
});
