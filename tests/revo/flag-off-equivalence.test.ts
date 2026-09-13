import { test, expect, describe } from "bun:test";
import {
  buildInitial,
  runEngine,
  ALL_FLAGS_OFF,
  MODEL_VERSION,
  type FeatureFlags,
  type EngineOutput,
} from "../../src/components/revo/decisionEngine";
import { roundsFrom, CRAZY_INFLATED_30 } from "./_helpers";

// ============================================================
// FEATURE-FLAG OFF EQUIVALENCE — bit-for-bit baseline guarantee
// ============================================================
// When ALL C1–C7 flags are OFF (the default), the engine output MUST be
// bit-for-bit identical to the pre-C1-C7 production engine:
//   - the new C1 channel fields are all `undefined`
//   - lockedRca is null
//   - flags === ALL_FLAGS_OFF, modelVersion === MODEL_VERSION
//   - calling without a flags arg === calling with ALL_FLAGS_OFF explicitly
//   - deterministic (same input → identical output across runs)

/** Extract rawScores (name → score) from an engine output, for stable comparison. */
function rawScores(eng: EngineOutput): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of eng.candidateScores) out[c.game.name] = Math.round(c.rawScore * 1e6) / 1e6;
  return out;
}

describe("C1–C7 flag-OFF equivalence (bit-for-bit baseline)", () => {
  const rounds = roundsFrom(CRAZY_INFLATED_30);

  test("default flags arg === ALL_FLAGS_OFF explicitly (no drift from the production default)", () => {
    const a = buildInitial(rounds, []);                              // no flags arg → default
    const b = buildInitial(rounds, [], "baseline", ALL_FLAGS_OFF);   // explicit ALL_FLAGS_OFF
    expect(a.nextSignalNames).toEqual(b.nextSignalNames);
    expect(a.excludedNames).toEqual(b.excludedNames);
    expect(a.confidence).toBe(b.confidence);
    expect(a.status).toBe(b.status);
    expect(a.decision).toBe(b.decision);
    expect(rawScores(a)).toEqual(rawScores(b));
  });

  test("all C1 channel fields are undefined on every candidate when flags OFF", () => {
    const eng = buildInitial(rounds, [], "baseline", ALL_FLAGS_OFF);
    expect(eng.candidateScores.length).toBe(8);
    for (const c of eng.candidateScores) {
      expect(c.rawEvidenceScore).toBeUndefined();
      expect(c.priorProbability).toBeUndefined();
      expect(c.calibratedProbabilityPosterior).toBeUndefined();
      expect(c.uncertainty).toBeUndefined();
      expect(c.selectionScore).toBeUndefined();
    }
  });

  test("lockedRca is null and flags/modelVersion are stamped when flags OFF", () => {
    const eng = buildInitial(rounds, [], "baseline", ALL_FLAGS_OFF);
    expect(eng.lockedRca).toBeNull();
    expect(eng.flags).toEqual(ALL_FLAGS_OFF);
    expect(eng.modelVersion).toBe(MODEL_VERSION);
  });

  test("deterministic: same input → identical Top-4 + rawScores across two runs", () => {
    const a = buildInitial(rounds, [], "baseline", ALL_FLAGS_OFF);
    const b = buildInitial(rounds, [], "baseline", ALL_FLAGS_OFF);
    expect(a.nextSignalNames).toEqual(b.nextSignalNames);
    expect(rawScores(a)).toEqual(rawScores(b));
  });

  test("recalibrate / runEngine also threads flags with the same OFF default (no drift on MISS path)", () => {
    const missRounds = [...rounds, ...roundsFrom(["PACHINKO"])];
    const a = runEngine(missRounds, ["1", "2", "5", "10"], false, true, "test", [], "baseline");
    const b = runEngine(missRounds, ["1", "2", "5", "10"], false, true, "test", [], "baseline", ALL_FLAGS_OFF);
    expect(a.nextSignalNames).toEqual(b.nextSignalNames);
    expect(rawScores(a)).toEqual(rawScores(b));
  });

  test("flipping C1 ON populates the channel fields (proves flags actually gate, not no-ops)", () => {
    const flagsOn: FeatureFlags = { ...ALL_FLAGS_OFF, c1_calibratedChannel: true, c3_uncertaintyShrinkage: true };
    const eng = buildInitial(rounds, [], "baseline", flagsOn);
    for (const c of eng.candidateScores) {
      expect(typeof c.calibratedProbabilityPosterior).toBe("number");
      expect(typeof c.selectionScore).toBe("number");
      expect(typeof c.rawEvidenceScore).toBe("number");
      expect(typeof c.priorProbability).toBe("number");
    }
    // C6 still OFF → lockedRca null.
    expect(eng.lockedRca).toBeNull();
  });
});
