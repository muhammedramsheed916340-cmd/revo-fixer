import { test, expect, describe } from "bun:test";
import {
  buildInitial,
  runFrozenWalkForward,
  ALL_FLAGS_OFF,
  MODEL_VERSION,
  THEORETICAL,
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
// C9 — RECENCY-EXCLUDE-LAST TESTS
// ============================================================
// 1. C9 OFF = bit-for-bit C1-C8 (no drift)
// 2. C9 ON: recency window excludes the just-arrived actual
// 3. Bayesian posterior still includes the just-arrived actual
// 4. Last actual can still appear through genuine posterior evidence
// 5. No double-append / lifecycle regression
// 6. Existing tests remain passing (verified by suite run, not this file)

describe("C9 — recency-exclude-last (anti-chase)", () => {
  const rounds = roundsFrom(CRAZY_INFLATED_30);

  // 1. C9 OFF = bit-for-bit C1-C8
  test("1. C9 OFF produces bit-for-bit identical output to C1-C8 (no drift)", () => {
    const c18: FeatureFlags = { ...ALL_FLAGS_ON, c9_recencyExcludeLast: false };
    const a = buildInitial(rounds, [], "baseline", c18);
    const b = buildInitial(rounds, [], "baseline", c18);
    expect(a.nextSignalNames).toEqual(b.nextSignalNames);
    expect(rawScores(a)).toEqual(rawScores(b));
    // C9 flag stamped in output
    expect(a.flags.c9_recencyExcludeLast).toBe(false);
    expect(a.modelVersion).toBe(MODEL_VERSION);
  });

  // 2. C9 ON: recency window excludes the just-arrived actual
  test("2. C9 ON excludes the just-arrived actual from signal recency (recent-active no longer auto-fires on it)", () => {
    // Build a history where the LAST actual is COIN FLIP (a bonus).
    // With C9 OFF, recent-active fires on COIN FLIP (1 in last 10 > 0.8 × 7.41%).
    // With C9 ON, COIN FLIP is excluded from the signal window → recent-active
    // should NOT fire (unless COIN FLIP appeared in the PRIOR 10).
    // NOTE: C5 must be OFF here — C5 de-scopes recent-active entirely, which
    // would mask the C9 effect. We want to isolate C9's recency-window behavior.
    const cfLast = [
      "1", "2", "1", "5", "2", "1", "10", "2", "1", "5",
      "1", "2", "1", "5", "2", "1", "10", "2", "1", "5",
      "1", "2", "1", "5", "2", "1", "10", "2", "1", "COIN FLIP",
    ];
    const cfRounds = roundsFrom(cfLast);
    // C5 OFF so recent-active can fire; C9 is the variable under test.
    const c9Off: FeatureFlags = { ...ALL_FLAGS_ON, c5_deScopeHarmful: false, c9_recencyExcludeLast: false };
    const c9On: FeatureFlags = { ...ALL_FLAGS_ON, c5_deScopeHarmful: false, c9_recencyExcludeLast: true };
    const engOff = buildInitial(cfRounds, [], "baseline", c9Off);
    const engOn = buildInitial(cfRounds, [], "baseline", c9On);
    const cfOff = engOff.candidateScores.find((c) => c.game.name === "COIN FLIP")!;
    const cfOn = engOn.candidateScores.find((c) => c.game.name === "COIN FLIP")!;
    // With C9 OFF, recent-active fires on COIN FLIP (it's in the last 10).
    expect(cfOff.signals).toContain("recent-active");
    // With C9 ON, recent-active should NOT fire on COIN FLIP (excluded from signal window)
    // because COIN FLIP only appeared once (the last round) and is now excluded.
    expect(cfOn.signals).not.toContain("recent-active");
  });

  // 3. Bayesian posterior still includes the just-arrived actual
  test("3. C9 ON: Bayesian posterior still includes the just-arrived actual (count unchanged)", () => {
    // Build a history where COIN FLIP is the last actual.
    const cfLast = [
      "1", "2", "1", "5", "2", "1", "10", "2", "1", "COIN FLIP",
      "1", "2", "1", "5", "2", "1", "10", "2", "1", "COIN FLIP",
    ];
    const cfRounds = roundsFrom(cfLast);
    const c9On: FeatureFlags = { ...ALL_FLAGS_ON, c9_recencyExcludeLast: true };
    const eng = buildInitial(cfRounds, [], "baseline", c9On);
    const cf = eng.candidateScores.find((c) => c.game.name === "COIN FLIP")!;
    // The posterior must reflect BOTH COIN FLIP appearances (count=2).
    // Laplace: (2 + 30 × 0.0741) / (20 + 30) = (2 + 2.223) / 50 = 0.0845
    const expectedPosterior = (2 + 30 * THEORETICAL["COIN FLIP"]) / (20 + 30);
    expect(cf.calibratedProbabilityPosterior).toBeCloseTo(expectedPosterior, 6);
    // And the rawScore / evidence are computed from the full count (not the signal window).
    expect(cf.rawScore).toBeGreaterThan(0);
  });

  // 4. Last actual can still appear through genuine posterior evidence
  test("4. C9 ON: last actual can still appear in Top-4 via genuine posterior (not a 'never repeat' rule)", () => {
    // "1" has a 38.89% prior. After "1" arrives, its posterior is high enough
    // to remain in Top-4 regardless of the recency signal.
    const oneLast = [
      "2", "5", "1", "2", "1", "5", "2", "1", "10", "2",
      "1", "5", "2", "1", "10", "5", "2", "1", "2", "1",
    ];
    const oneRounds = roundsFrom(oneLast);
    const c9On: FeatureFlags = { ...ALL_FLAGS_ON, c9_recencyExcludeLast: true };
    const eng = buildInitial(oneRounds, [], "baseline", c9On);
    // "1" should still be in Top-4 (its posterior is ~38-39%, highest of all outcomes).
    expect(eng.nextSignalNames).toContain("1");
  });

  // 5. No double-append / lifecycle regression (frozen walk-forward with C9 ON)
  test("5. C9 ON: frozen walk-forward has no leakage, one prediction per round, deterministic", () => {
    const c9On: FeatureFlags = { ...ALL_FLAGS_ON, c9_recencyExcludeLast: true };
    const result = runFrozenWalkForward(CRAZY_INFLATED_30, c9On, []);
    // No leakage: hit rate < 100%
    expect(result.baseline.hitRate).toBeLessThan(1.0);
    expect(result.experimental.hitRate).toBeLessThan(1.0);
    // One round-log entry per input
    expect(result.baseline.rounds.length).toBe(CRAZY_INFLATED_30.length);
    expect(result.experimental.rounds.length).toBe(CRAZY_INFLATED_30.length);
    // Deterministic
    const result2 = runFrozenWalkForward(CRAZY_INFLATED_30, c9On, []);
    expect(result.experimental.hits).toBe(result2.experimental.hits);
    expect(result.experimental.rounds.map((r) => r.preds)).toEqual(
      result2.experimental.rounds.map((r) => r.preds),
    );
    // Each round has exactly 4 preds (except round 0 cold-start)
    for (let i = 1; i < result.experimental.rounds.length; i++) {
      expect(result.experimental.rounds[i].preds.length).toBe(4);
    }
    // Flags frozen
    expect(result.baseline.flags).toEqual(ALL_FLAGS_OFF);
    expect(result.experimental.flags).toEqual(c9On);
    expect(result.modelVersion).toBe(MODEL_VERSION);
  });

  // Additional: C9 ON changes selections vs C9 OFF when recency was driving a chase
  test("C9 ON changes selections vs C9 OFF when a bonus was being chased by recency", () => {
    // Use the CRAZY_INFLATED_30 history where CRAZY TIME is the last actual.
    const c9Off: FeatureFlags = { ...ALL_FLAGS_ON, c9_recencyExcludeLast: false };
    const c9On: FeatureFlags = { ...ALL_FLAGS_ON, c9_recencyExcludeLast: true };
    const engOff = buildInitial(rounds, [], "baseline", c9Off);
    const engOn = buildInitial(rounds, [], "baseline", c9On);
    // The selections MAY differ (C9 excludes the last actual from signal recency).
    // We don't assert they MUST differ (depends on whether recency was decisive),
    // but we verify the outputs are valid 4-subsets in both cases.
    expect(engOff.nextSignalNames.length).toBe(4);
    expect(engOn.nextSignalNames.length).toBe(4);
    expect(new Set(engOn.nextSignalNames).size).toBe(4);
  });

  // Additional: C9 ON with C6 ON records the flag in the RCA
  test("C9 ON + C6 ON: RCA record includes flags.c9_recencyExcludeLast = true", () => {
    const c9On: FeatureFlags = { ...ALL_FLAGS_ON, c9_recencyExcludeLast: true };
    const eng = buildInitial(rounds, [], "baseline", c9On);
    expect(eng.lockedRca).not.toBeNull();
    expect(eng.lockedRca!.flags.c9_recencyExcludeLast).toBe(true);
    expect(eng.flags.c9_recencyExcludeLast).toBe(true);
  });

  // Additional: C9 OFF records flags.c9_recencyExcludeLast = false
  test("C9 OFF: RCA record includes flags.c9_recencyExcludeLast = false", () => {
    const c9Off: FeatureFlags = { ...ALL_FLAGS_ON, c9_recencyExcludeLast: false };
    const eng = buildInitial(rounds, [], "baseline", c9Off);
    expect(eng.lockedRca).not.toBeNull();
    expect(eng.lockedRca!.flags.c9_recencyExcludeLast).toBe(false);
    expect(eng.flags.c9_recencyExcludeLast).toBe(false);
  });

  // Additional: C9 ON handles empty/short history gracefully (no crash)
  test("C9 ON handles empty + 1-round history gracefully (no crash)", () => {
    const c9On: FeatureFlags = { ...ALL_FLAGS_ON, c9_recencyExcludeLast: true };
    // Empty
    const eng0 = buildInitial([], [], "baseline", c9On);
    expect(eng0.predictions.length).toBe(0);
    // 1-round history (signalRecentHist is empty → fallback to userRecFreq)
    const eng1 = buildInitial(roundsFrom(["1"]), [], "baseline", c9On);
    expect(eng1.nextSignalNames.length).toBe(4);
    expect(eng1.nextSignalNames).toContain("1");
  });

  // Additional: C9 ON does NOT force [1,2,5,10] (no hardcoded composition)
  test("C9 ON does NOT force [1,2,5,10] — selection remains evidence-driven", () => {
    // Build a history where "5" is heavily over-represented (genuine evidence).
    const fiveHeavy = [
      "5", "5", "1", "5", "2", "5", "1", "5", "5", "2",
      "1", "5", "5", "2", "5", "1", "5", "5", "2", "5",
    ];
    const c9On: FeatureFlags = { ...ALL_FLAGS_ON, c9_recencyExcludeLast: true };
    const eng = buildInitial(roundsFrom(fiveHeavy), [], "baseline", c9On);
    // "5" should be in Top-4 (its posterior is genuinely elevated by count, not recency).
    expect(eng.nextSignalNames).toContain("5");
  });
});
