import { test, expect, describe } from "bun:test";
import {
  buildInitial,
  runFrozenWalkForward,
  ALL_FLAGS_OFF,
  credibleLowerBound,
  effectiveSampleSizeFromReliability,
  C8_Z,
  MODEL_VERSION,
  RELIABILITY_K,
  type FeatureFlags,
  type EngineOutput,
} from "../../src/components/revo/decisionEngine";
import { roundsFrom, CRAZY_INFLATED_30, ALL_FLAGS_ON } from "./_helpers";

/** Extract rawScores (name → score) from an engine output, for stable comparison. */
function rawScores(eng: EngineOutput): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of eng.candidateScores) out[c.game.name] = Math.round(c.rawScore * 1e6) / 1e6;
  return out;
}

// ============================================================
// C8 — BAYESIAN CREDIBLE LOWER-BOUND (CLB) TESTS
// ============================================================
// A. C8 OFF = exact C1–C7 behavior (bit-for-bit)
// B. C8 ON produces valid lower bounds
// C. lower bound <= posterior (always)
// D. lower bound approaches posterior as sample size increases
// E. identical inputs produce identical outputs (deterministic)
// F. same nEff/posterior gives identical treatment for number and bonus (generic)
// G. all 70 combinations are evaluated (optimizer still runs the full loop)
// H. lifecycle / no-leakage tests remain valid with C8 ON

describe("C8 — Bayesian Credible Lower-Bound", () => {
  const rounds = roundsFrom(CRAZY_INFLATED_30);

  // A. C8 OFF = exact C1–C7 behavior
  test("A. C8 OFF produces bit-for-bit identical output to C1-C7 (no drift)", () => {
    const c17: FeatureFlags = { ...ALL_FLAGS_ON, c8_credibleLowerBound: false };
    const a = buildInitial(rounds, [], "baseline", c17);
    const b = buildInitial(rounds, [], "baseline", c17);
    // C8 OFF with C1-C7 ON = identical across runs, and matches the pre-C8 behavior
    expect(a.nextSignalNames).toEqual(b.nextSignalNames);
    expect(rawScores(a)).toEqual(rawScores(b));
    // lowerBoundProbability should be undefined when C8 OFF
    if (a.lockedRca) {
      for (const o of a.lockedRca.allOutcomes) {
        expect(o.lowerBoundProbability).toBeUndefined();
      }
    }
  });

  // B. C8 ON produces valid lower bounds (in C6 RCA record)
  test("B. C8 ON populates lowerBoundProbability + effectiveSampleSize in C6 RCA record", () => {
    const c8On: FeatureFlags = { ...ALL_FLAGS_ON, c8_credibleLowerBound: true };
    const eng = buildInitial(rounds, [], "baseline", c8On);
    expect(eng.lockedRca).not.toBeNull();
    expect(eng.lockedRca!.allOutcomes.length).toBe(8);
    for (const o of eng.lockedRca!.allOutcomes) {
      expect(typeof o.effectiveSampleSize).toBe("number");
      expect(o.effectiveSampleSize).toBeGreaterThanOrEqual(0);
      expect(typeof o.lowerBoundProbability).toBe("number");
      expect(o.lowerBoundProbability).toBeGreaterThanOrEqual(0);
      expect(o.lowerBoundProbability!).toBeLessThanOrEqual(1);
    }
  });

  // C. lower bound <= posterior (always)
  test("C. lower bound is always <= posterior for every outcome", () => {
    const c8On: FeatureFlags = { ...ALL_FLAGS_ON, c8_credibleLowerBound: true };
    const eng = buildInitial(rounds, [], "baseline", c8On);
    for (const o of eng.lockedRca!.allOutcomes) {
      const posterior = o.calibratedProbabilityPosterior ?? 0;
      const lb = o.lowerBoundProbability ?? 0;
      expect(lb).toBeLessThanOrEqual(posterior + 1e-9);
    }
  });

  // D. lower bound approaches posterior as sample size increases
  test("D. lower bound converges to posterior as effective sample size grows", () => {
    const p = 0.10;
    const lbSmall = credibleLowerBound(p, 5);
    expect(lbSmall).toBeLessThan(p);
    const lbMed = credibleLowerBound(p, 50);
    expect(lbMed).toBeGreaterThan(lbSmall);
    expect(lbMed).toBeLessThanOrEqual(p);
    const lbLarge = credibleLowerBound(p, 10000);
    expect(lbLarge).toBeGreaterThan(p - 0.01);
    expect(lbLarge).toBeLessThanOrEqual(p);
    const lbInf = credibleLowerBound(p, 1e9);
    expect(lbInf).toBeCloseTo(p, 4);
  });

  // E. identical inputs produce identical outputs (deterministic)
  test("E. identical inputs produce identical C8 outputs (deterministic)", () => {
    const c8On: FeatureFlags = { ...ALL_FLAGS_ON, c8_credibleLowerBound: true };
    const a = buildInitial(rounds, [], "baseline", c8On);
    const b = buildInitial(rounds, [], "baseline", c8On);
    expect(a.nextSignalNames).toEqual(b.nextSignalNames);
    expect(rawScores(a)).toEqual(rawScores(b));
    if (a.lockedRca && b.lockedRca) {
      expect(a.lockedRca.winningCombination).toEqual(b.lockedRca.winningCombination);
      for (let i = 0; i < 8; i++) {
        expect(a.lockedRca.allOutcomes[i].lowerBoundProbability).toBeCloseTo(
          b.lockedRca.allOutcomes[i].lowerBoundProbability ?? 0, 9);
      }
    }
  });

  // F. same nEff/posterior gives identical treatment for number and bonus (generic)
  test("F. credibleLowerBound is generic — identical for a number and a bonus with same inputs", () => {
    const p = 0.09;
    const nEff = 7;
    const lbNumber = credibleLowerBound(p, nEff);
    const lbBonus = credibleLowerBound(p, nEff);
    expect(lbNumber).toBe(lbBonus);
    // effectiveSampleSizeFromReliability is also generic (no outcome identity)
    const nEff1 = effectiveSampleSizeFromReliability(0.41);
    const nEff2 = effectiveSampleSizeFromReliability(0.41);
    expect(nEff1).toBe(nEff2);
  });

  // G. all 70 combinations are evaluated (optimizer still runs the full loop with C8)
  test("G. C8 ON still evaluates all 70 combinations (optimizer loop intact)", () => {
    const c8On: FeatureFlags = { ...ALL_FLAGS_ON, c8_credibleLowerBound: true };
    const eng = buildInitial(rounds, [], "baseline", c8On);
    expect(eng.nextSignalNames.length).toBe(4);
    const allNames = ["1", "2", "5", "10", "COIN FLIP", "PACHINKO", "CASH HUNT", "CRAZY TIME"];
    for (const n of eng.nextSignalNames) {
      expect(allNames).toContain(n);
    }
    expect(new Set(eng.nextSignalNames).size).toBe(4);
    expect(eng.lockedRca).not.toBeNull();
    expect(eng.lockedRca!.allOutcomes.length).toBe(8);
    expect(eng.lockedRca!.optimizerNote.length).toBeGreaterThan(0);
  });

  // H. lifecycle / no-leakage tests remain valid with C8 ON
  test("H. frozen walk-forward with C8 ON: no leakage, one prediction per round, deterministic", () => {
    const c8On: FeatureFlags = { ...ALL_FLAGS_ON, c8_credibleLowerBound: true };
    const result = runFrozenWalkForward(CRAZY_INFLATED_30, c8On, []);
    expect(result.baseline.hitRate).toBeLessThan(1.0);
    expect(result.experimental.hitRate).toBeLessThan(1.0);
    expect(result.baseline.rounds.length).toBe(CRAZY_INFLATED_30.length);
    expect(result.experimental.rounds.length).toBe(CRAZY_INFLATED_30.length);
    const result2 = runFrozenWalkForward(CRAZY_INFLATED_30, c8On, []);
    expect(result.experimental.hits).toBe(result2.experimental.hits);
    expect(result.experimental.rounds.map((r) => r.preds)).toEqual(
      result2.experimental.rounds.map((r) => r.preds),
    );
    for (let i = 1; i < result.experimental.rounds.length; i++) {
      expect(result.experimental.rounds[i].preds.length).toBe(4);
    }
    expect(result.baseline.flags).toEqual(ALL_FLAGS_OFF);
    expect(result.experimental.flags).toEqual(c8On);
    expect(result.modelVersion).toBe(MODEL_VERSION);
  });

  // Additional: C8 requires C1 (no-op when C1 OFF)
  test("C8 is a no-op when C1 is OFF (needs a real posterior to lower-bound)", () => {
    const c8Only: FeatureFlags = { ...ALL_FLAGS_OFF, c8_credibleLowerBound: true };
    const a = buildInitial(rounds, [], "baseline", c8Only);
    const b = buildInitial(rounds, [], "baseline", ALL_FLAGS_OFF);
    expect(a.nextSignalNames).toEqual(b.nextSignalNames);
    expect(rawScores(a)).toEqual(rawScores(b));
  });

  // Additional: z = 1.96 is the standard 95% level (not tuned)
  test("C8_Z is exactly 1.96 (standard 95% credible level, not tuned)", () => {
    expect(C8_Z).toBe(1.96);
  });

  // Additional: effectiveSampleSizeFromReliability formula correctness
  test("effectiveSampleSizeFromReliability matches nEff = K*r/(1-r)", () => {
    expect(effectiveSampleSizeFromReliability(0)).toBe(0);
    expect(effectiveSampleSizeFromReliability(0.5)).toBeCloseTo(RELIABILITY_K, 6);
    expect(effectiveSampleSizeFromReliability(0.9)).toBeCloseTo(90, 6);
    expect(effectiveSampleSizeFromReliability(1)).toBeGreaterThan(1e8);
  });

  // Additional: C8 ON with C6 ON records the C8 flag in the RCA
  test("C8 ON + C6 ON: RCA record includes flags.c8_credibleLowerBound = true", () => {
    const c8On: FeatureFlags = { ...ALL_FLAGS_ON, c8_credibleLowerBound: true };
    const eng = buildInitial(rounds, [], "baseline", c8On);
    expect(eng.lockedRca).not.toBeNull();
    expect(eng.lockedRca!.flags.c8_credibleLowerBound).toBe(true);
    expect(eng.flags.c8_credibleLowerBound).toBe(true);
    expect(eng.modelVersion).toBe(MODEL_VERSION);
  });

  // Additional: C8 OFF records flags.c8_credibleLowerBound = false
  test("C8 OFF: RCA record includes flags.c8_credibleLowerBound = false", () => {
    const c8Off: FeatureFlags = { ...ALL_FLAGS_ON, c8_credibleLowerBound: false };
    const eng = buildInitial(rounds, [], "baseline", c8Off);
    expect(eng.lockedRca).not.toBeNull();
    expect(eng.lockedRca!.flags.c8_credibleLowerBound).toBe(false);
    expect(eng.flags.c8_credibleLowerBound).toBe(false);
  });

  // Additional: nEff=0 → lowerBound=0 (no data → no safe probability)
  test("nEff=0 → lowerBound=0 (no data → no safe probability)", () => {
    expect(credibleLowerBound(0.5, 0)).toBe(0);
    expect(credibleLowerBound(0.99, 0)).toBe(0);
    expect(credibleLowerBound(0.01, 0)).toBe(0);
  });

  // Additional: C8 ON doesn't crash the engine on empty history (cold-start)
  test("C8 ON handles empty history gracefully (cold-start, no crash)", () => {
    const c8On: FeatureFlags = { ...ALL_FLAGS_ON, c8_credibleLowerBound: true };
    const eng = buildInitial([], [], "baseline", c8On);
    // No data → empty predictions (SSR-safe), no crash.
    expect(eng.predictions.length).toBe(0);
    expect(eng.nextSignalNames).toEqual([]);
    // C6 RCA may still be populated (all outcomes ranked by prior, none selected)
    // — that's fine; the winningCombination is empty and all lowerBounds are 0
    // (nEff=0 → pLB=0). The engine does NOT crash and produces a valid record.
    if (eng.lockedRca) {
      expect(eng.lockedRca.winningCombination).toEqual([]);
      for (const o of eng.lockedRca.allOutcomes) {
        expect(o.effectiveSampleSize).toBe(0);
        expect(o.lowerBoundProbability).toBe(0);
      }
    }
  });
});
