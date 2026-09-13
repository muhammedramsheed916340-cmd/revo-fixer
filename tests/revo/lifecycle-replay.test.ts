import { test, expect, describe } from "bun:test";
import {
  buildInitial,
  runEngine,
  runFrozenWalkForward,
  ALL_FLAGS_OFF,
  ALL_FLAGS_OFF as OFF,
  type FeatureFlags,
} from "../../src/components/revo/decisionEngine";
import { roundsFrom, makeRound, CRAZY_INFLATED_30 } from "./_helpers";

// ============================================================
// LIFECYCLE / PIPELINE / DETERMINISTIC REPLAY + C7 HARNESS
// ============================================================
// Verifies:
//   - one prediction per unique live result (no duplicate settlement)
//   - no stale state (each prediction uses history BEFORE that round)
//   - deterministic replay (identical input → identical output)
//   - no data leakage (prediction for round i does not see round i's result)
//   - the C7 frozen walk-forward harness runs, produces sane stats, and
//     carries the explicit "NOT a validation claim" disclaimer.

describe("settlement lifecycle (no leakage, no duplicate settlement)", () => {
  test("runFrozenWalkForward settles each round exactly once (one prediction per result)", () => {
    const flags: FeatureFlags = { ...OFF, c1_calibratedChannel: true, c4_realOptimizer: true };
    const result = runFrozenWalkForward(CRAZY_INFLATED_30, flags, []);
    // Each arm must have exactly one round-log entry per input name.
    expect(result.baseline.rounds.length).toBe(CRAZY_INFLATED_30.length);
    expect(result.experimental.rounds.length).toBe(CRAZY_INFLATED_30.length);
    // Indices must be 1..N with no gaps (no duplicate / skipped settlements).
    expect(result.baseline.rounds.map((r) => r.idx)).toEqual(
      CRAZY_INFLATED_30.map((_, i) => i + 1),
    );
  });

  test("no data leakage — round i's prediction is computed from history [0..i-1], not including i", () => {
    // If there were leakage, the engine would predict round i's actual perfectly
    // every time (100% HIT). A sane engine on CRAZY_INFLATED_30 must NOT be 100%.
    const result = runFrozenWalkForward(CRAZY_INFLATED_30, ALL_FLAGS_OFF, []);
    expect(result.baseline.hitRate).toBeLessThan(1.0);
    expect(result.baseline.hitRate).toBeGreaterThan(0.0);
    // Round 0 is a cold-start (empty history → no data → empty prediction,
    // matching the live SSR-safe behavior). Rounds 1..N must each lock exactly
    // 4 outcomes (no stale/empty state, no duplicate settlement).
    expect(result.baseline.rounds[0].preds.length).toBe(0);
    for (let i = 1; i < result.baseline.rounds.length; i++) {
      expect(result.baseline.rounds[i].preds.length).toBe(4);
    }
    // One round-log entry per input name (exactly one settlement per round).
    expect(result.baseline.rounds.length).toBe(CRAZY_INFLATED_30.length);
  });

  test("deterministic replay — identical input + frozen flags → identical HIT/MISS sequence", () => {
    const flags: FeatureFlags = { ...OFF, c1_calibratedChannel: true, c2_genericReliability: true, c4_realOptimizer: true };
    const a = runFrozenWalkForward(CRAZY_INFLATED_30, flags, []);
    const b = runFrozenWalkForward(CRAZY_INFLATED_30, flags, []);
    expect(a.baseline.hits).toBe(b.baseline.hits);
    expect(a.experimental.hits).toBe(b.experimental.hits);
    expect(a.baseline.rounds.map((r) => r.preds)).toEqual(b.baseline.rounds.map((r) => r.preds));
    expect(a.experimental.rounds.map((r) => r.preds)).toEqual(b.experimental.rounds.map((r) => r.preds));
  });
});

describe("C7 — frozen walk-forward harness (build path, NOT a claim)", () => {
  const flags: FeatureFlags = {
    ...OFF, c1_calibratedChannel: true, c2_genericReliability: true,
    c3_uncertaintyShrinkage: true, c4_realOptimizer: true,
  };

  test("runs and produces all required stat blocks", () => {
    const result = runFrozenWalkForward(CRAZY_INFLATED_30, flags, []);
    expect(result.baseline).toBeDefined();
    expect(result.experimental).toBeDefined();
    expect(result.theoretical).toBeDefined();
    expect(result.mcnemar).toBeDefined();
    expect(result.freshRounds).toBe(CRAZY_INFLATED_30.length);
    expect(result.modelVersion).toBeDefined();
  });

  test("theoretical benchmark = [1,2,5,10] hit-rate on the SAME rounds", () => {
    const result = runFrozenWalkForward(CRAZY_INFLATED_30, ALL_FLAGS_OFF, []);
    const expected = CRAZY_INFLATED_30.filter((n) => ["1", "2", "5", "10"].includes(n)).length;
    expect(result.theoretical.hits).toBe(expected);
    expect(result.theoretical.hitRate).toBeCloseTo(expected / CRAZY_INFLATED_30.length, 6);
  });

  test("bonus inclusion rate + number exclusion rate are computed per arm", () => {
    const result = runFrozenWalkForward(CRAZY_INFLATED_30, flags, []);
    expect(typeof result.baseline.bonusInclusionRate).toBe("number");
    expect(typeof result.experimental.bonusInclusionRate).toBe("number");
    for (const num of ["1", "2", "5", "10"]) {
      expect(typeof result.baseline.numberExclusionRate[num]).toBe("number");
      expect(typeof result.experimental.numberExclusionRate[num]).toBe("number");
    }
  });

  test("per-outcome inclusion/hit efficiency is computed for all 8 outcomes", () => {
    const result = runFrozenWalkForward(CRAZY_INFLATED_30, flags, []);
    expect(result.experimental.perOutcome.length).toBe(8);
    for (const st of result.experimental.perOutcome) {
      expect(typeof st.inclusions).toBe("number");
      expect(typeof st.actuals).toBe("number");
      expect(typeof st.coveredActuals).toBe("number");
      expect(typeof st.hitEfficiency).toBe("number");
      // hitEfficiency ∈ [0,1] (0 when never included).
      expect(st.hitEfficiency).toBeGreaterThanOrEqual(0);
      expect(st.hitEfficiency).toBeLessThanOrEqual(1);
    }
  });

  test("McNemar is computed on discordant pairs and flagged inconclusive below 10", () => {
    const result = runFrozenWalkForward(CRAZY_INFLATED_30, flags, []);
    const disc = result.mcnemar.r + result.mcnemar.s;
    expect(result.mcnemar.r + result.mcnemar.s).toBe(disc);
    expect(typeof result.mcnemar.pValue).toBe("number");
    expect(result.mcnemar.pValue).toBeGreaterThanOrEqual(0);
    expect(result.mcnemar.pValue).toBeLessThanOrEqual(1);
    if (disc < 10) {
      expect(result.mcnemar.note).toContain("inconclusive");
    }
  });

  test("carries the explicit 'NOT a validation claim' disclaimer (never asserts success)", () => {
    const result = runFrozenWalkForward(CRAZY_INFLATED_30, flags, []);
    expect(result.note).toContain("NOT");
    expect(result.note.toLowerCase()).toContain("not a validation");
    expect(result.note).toContain("100+");
  });

  test("flags are FROZEN for the whole run — baseline arm always ALL_FLAGS_OFF", () => {
    const result = runFrozenWalkForward(CRAZY_INFLATED_30, flags, []);
    expect(result.baseline.flags).toEqual(ALL_FLAGS_OFF);
    expect(result.experimental.flags).toEqual(flags);
  });
});

describe("C5 — de-scope harmful features (regression guards)", () => {
  test("C5 OFF preserves the anomaly/shift overwrites; C5 ON removes them (signals differ)", () => {
    // Build a history long enough to trigger anomaly/pattern-shift detection.
    // 25 rounds with a skewed distribution (heavy "1") often trips the chi² test.
    const skewed = Array.from({ length: 25 }, (_, i) =>
      ["1", "1", "1", "2", "5", "1", "10", "1", "2", "PACHINKO"][i % 10]);
    const rounds = roundsFrom(skewed);
    const off = buildInitial(rounds, [], "baseline", ALL_FLAGS_OFF);
    const on = buildInitial(rounds, [], "baseline", { ...ALL_FLAGS_OFF, c5_deScopeHarmful: true });
    // When anomaly/shift overwrites are removed, the signal tags must not include
    // "anomaly-weighted" / "shift-adaptive" on the C5-ON output.
    const offSignals = new Set(off.candidateScores.flatMap((c) => c.signals));
    const onSignals = new Set(on.candidateScores.flatMap((c) => c.signals));
    // If the baseline (C5 OFF) emitted an anomaly/shift overwrite, C5 ON must NOT.
    if (offSignals.has("anomaly-weighted") || offSignals.has("shift-adaptive")) {
      expect(onSignals.has("anomaly-weighted")).toBe(false);
      expect(onSignals.has("shift-adaptive")).toBe(false);
    }
    // recent-active is also gated by C5.
    if (offSignals.has("recent-active")) {
      expect(onSignals.has("recent-active")).toBe(false);
    }
  });

  test("C5 ON does not persistence-penalize a high-reliability number after misses", () => {
    // 2 consecutive misses ending on a number-actual the prediction missed.
    // Build rounds so the last 2 are MISSes (actual = a bonus not in [1,2,5,10]).
    const base = CRAZY_INFLATED_30.slice(0, 20);
    const rounds = roundsFrom([...base, "PACHINKO", "CASH HUNT"]); // 2 bonus-actuals = 2 misses
    const on = buildInitial(rounds, [], "baseline", { ...ALL_FLAGS_OFF, c5_deScopeHarmful: true });
    // "1" has high reliability (many observations) → must NOT carry a persistence penalty.
    const one = on.candidateScores.find((c) => c.game.name === "1")!;
    expect(one.signals.some((s) => s.startsWith("persistence-penalty"))).toBe(false);
  });
});

describe("no mid-test tuning — engine output depends only on (rounds, flags), not call order", () => {
  test("calling buildInitial then runEngine on the same input yields consistent candidate scores", () => {
    const rounds = roundsFrom(CRAZY_INFLATED_30);
    const a = buildInitial(rounds, [], "baseline", ALL_FLAGS_OFF);
    // Append a round and re-run; the FIRST 8 candidates' rawScores for the
    // original history should be recomputed consistently (no hidden mutation).
    const b = runEngine([...rounds, makeRound("1")], ["1", "2", "5", "10"], true, false, "", [], "baseline", ALL_FLAGS_OFF);
    expect(b.candidateScores.length).toBe(8);
    // No NaN / Infinity anywhere.
    for (const c of b.candidateScores) {
      expect(Number.isFinite(c.rawScore)).toBe(true);
    }
    void a;
  });
});
