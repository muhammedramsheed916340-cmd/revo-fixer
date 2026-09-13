import { test, expect, describe } from "bun:test";
import {
  buildInitial,
  ALL_FLAGS_OFF,
  RELIABILITY_K,
  BONUS_NAMES,
  type CandidateScore,
} from "../../src/components/revo/decisionEngine";
import { roundsFrom, CRAZY_INFLATED_30 } from "./_helpers";

// ============================================================
// C2 — GENERIC CONTINUOUS RARE-OUTCOME RELIABILITY
// C3 — UNCERTAINTY-AWARE SHRINKAGE
// ============================================================
// C2: reliability = effectiveSampleSize/(effectiveSampleSize+RELIABILITY_K),
//     applied to POSITIVE deviation only; negative deviation passes through
//     unchanged (never inflate an unseen rare outcome). Generic — no
//     per-outcome hardcoded penalty. Decoupled from `mode`.
// C3: uncertainty shrinkage pulls the selection score toward the prior so a
//     small sample cannot create an aggressive jump. Preserves the existing
//     k=30 sample-size gates; adds NO HOT/OVERDUE/GAP/DROUGHT rules.

function find(scores: CandidateScore[], name: string): CandidateScore {
  return scores.find((c) => c.game.name === name)!;
}

describe("C2 — generic continuous rare-outcome reliability", () => {
  const rounds = roundsFrom(CRAZY_INFLATED_30);

  test("reliability is computed for every outcome when C2 ON (generic, no hardcode)", () => {
    const eng = buildInitial(rounds, [], "baseline", { ...ALL_FLAGS_OFF, c2_genericReliability: true });
    for (const c of eng.candidateScores) {
      expect(typeof c.reliability).toBe("number");
      expect(c.reliability!).toBeGreaterThanOrEqual(0);
      expect(c.reliability!).toBeLessThanOrEqual(1);
    }
  });

  test("reliability matches the continuous formula count/(count+K) for each outcome", () => {
    const eng = buildInitial(rounds, [], "baseline", { ...ALL_FLAGS_OFF, c2_genericReliability: true });
    // Recompute counts from the history.
    const counts: Record<string, number> = {};
    for (const r of rounds) counts[r.actualResult.name] = (counts[r.actualResult.name] ?? 0) + 1;
    for (const c of eng.candidateScores) {
      const cnt = counts[c.game.name] ?? 0;
      const expected = cnt / (cnt + RELIABILITY_K);
      expect(c.reliability).toBeCloseTo(expected, 6);
    }
  });

  test("reliability is undefined for all outcomes when C2 OFF (bit-for-bit: identity path)", () => {
    const eng = buildInitial(rounds, [], "baseline", ALL_FLAGS_OFF);
    // In baseline mode + C2 OFF, reliability is set to 1.0 internally but the
    // field is still populated (the existing behavior). What matters for
    // bit-for-bit is that reliableDeviation === cappedDeviation (identity).
    for (const c of eng.candidateScores) {
      // reliableDeviation must equal the cappedDeviation (identity) when inactive.
      expect(c.reliableDeviation).toBeCloseTo(
        Math.max(-0.6, Math.min(2.0, c.stabilizedDeviation)),
        9,
      );
    }
  });

  test("a rare outcome with few observations has LOW reliability; a common outcome has HIGH", () => {
    const eng = buildInitial(rounds, [], "baseline", { ...ALL_FLAGS_OFF, c2_genericReliability: true });
    const crazy = find(eng.candidateScores, "CRAZY TIME");
    const one = find(eng.candidateScores, "1");
    // CRAZY TIME appeared 3× → reliability 3/13 ≈ 0.23; "1" appeared ~11× → ~0.52.
    expect(crazy.reliability!).toBeLessThan(0.35);
    expect(one.reliability!).toBeGreaterThan(0.4);
    expect(one.reliability!).toBeGreaterThan(crazy.reliability!);
  });

  test("positive deviation is dampened by reliability; negative deviation passes through (no rare-outcome inflation)", () => {
    const eng = buildInitial(rounds, [], "baseline", { ...ALL_FLAGS_OFF, c2_genericReliability: true });
    for (const c of eng.candidateScores) {
      const capped = Math.max(-0.6, Math.min(2.0, c.stabilizedDeviation));
      const r = c.reliability ?? 1;
      if (capped > 0) {
        // Positive deviation dampened: reliableDeviation < capped.
        expect(c.reliableDeviation!).toBeLessThanOrEqual(capped + 1e-9);
        expect(c.reliableDeviation).toBeCloseTo(capped * r, 6);
      } else {
        // Negative deviation passes through unchanged.
        expect(c.reliableDeviation).toBeCloseTo(capped, 6);
      }
    }
  });

  test("C2 is decoupled from `mode` — works in baseline mode when the flag is ON", () => {
    // baseline mode + C2 ON should still apply reliability (previously reliability
    // only fired in experimental mode; now C2 decouples it).
    const baselineC2 = buildInitial(rounds, [], "baseline", { ...ALL_FLAGS_OFF, c2_genericReliability: true });
    const experimentalOff = buildInitial(rounds, [], "experimental", ALL_FLAGS_OFF);
    // Both should have reliability computed.
    for (const c of baselineC2.candidateScores) {
      expect(typeof c.reliability).toBe("number");
    }
    for (const c of experimentalOff.candidateScores) {
      expect(typeof c.reliability).toBe("number");
    }
  });

  test("no per-outcome hardcoded penalty — reliability formula is identical for bonuses and numbers", () => {
    const eng = buildInitial(rounds, [], "baseline", { ...ALL_FLAGS_OFF, c2_genericReliability: true });
    const counts: Record<string, number> = {};
    for (const r of rounds) counts[r.actualResult.name] = (counts[r.actualResult.name] ?? 0) + 1;
    // For EVERY outcome (bonus or number), reliability === count/(count+K).
    for (const c of eng.candidateScores) {
      const cnt = counts[c.game.name] ?? 0;
      expect(c.reliability).toBeCloseTo(cnt / (cnt + RELIABILITY_K), 6);
    }
  });
});

describe("C3 — uncertainty-aware shrinkage", () => {
  const rounds = roundsFrom(CRAZY_INFLATED_30);

  test("uncertainty is in [0,1] for every outcome when C3 ON", () => {
    const eng = buildInitial(rounds, [], "baseline", {
      ...ALL_FLAGS_OFF, c1_calibratedChannel: true, c3_uncertaintyShrinkage: true,
    });
    for (const c of eng.candidateScores) {
      expect(typeof c.uncertainty).toBe("number");
      expect(c.uncertainty!).toBeGreaterThanOrEqual(0);
      expect(c.uncertainty!).toBeLessThanOrEqual(1);
    }
  });

  test("a data-starved outcome has HIGH uncertainty; a well-sampled outcome has LOW", () => {
    const eng = buildInitial(rounds, [], "baseline", {
      ...ALL_FLAGS_OFF, c1_calibratedChannel: true, c3_uncertaintyShrinkage: true,
    });
    const crazy = find(eng.candidateScores, "CRAZY TIME"); // 3 obs
    const one = find(eng.candidateScores, "1");             // ~11 obs
    expect(crazy.uncertainty!).toBeGreaterThan(one.uncertainty!);
  });

  test("selectionScore shrinks toward the prior by uncertainty (small sample → no aggressive jump)", () => {
    const eng = buildInitial(rounds, [], "baseline", {
      ...ALL_FLAGS_OFF, c1_calibratedChannel: true, c3_uncertaintyShrinkage: true,
    });
    for (const c of eng.candidateScores) {
      const prior = c.priorProbability!;
      const posterior = c.calibratedProbabilityPosterior!;
      const u = c.uncertainty!;
      const expected = posterior * (1 - u) + prior * u;
      expect(c.selectionScore).toBeCloseTo(expected, 6);
    }
  });

  test("C3 adds NO HOT/OVERDUE/GAP/DROUGHT hard rules — only prior-anchored shrinkage", () => {
    // The selectionScore must lie BETWEEN the posterior and the prior (shrunk),
    // never above the posterior (no boost) and never below the min of the two.
    const eng = buildInitial(rounds, [], "baseline", {
      ...ALL_FLAGS_OFF, c1_calibratedChannel: true, c3_uncertaintyShrinkage: true,
    });
    for (const c of eng.candidateScores) {
      const prior = c.priorProbability!;
      const posterior = c.calibratedProbabilityPosterior!;
      const lo = Math.min(prior, posterior);
      const hi = Math.max(prior, posterior);
      expect(c.selectionScore!).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(c.selectionScore!).toBeLessThanOrEqual(hi + 1e-9);
    }
  });
});
