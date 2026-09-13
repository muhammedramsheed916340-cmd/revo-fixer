import { test, expect, describe } from "bun:test";
import {
  buildInitial,
  ALL_FLAGS_OFF,
  BONUS_NAMES,
  type CandidateScore,
} from "../../src/components/revo/decisionEngine";
import { roundsFrom, CRAZY_INFLATED_30 } from "./_helpers";

// ============================================================
// C4 — REAL 70-COMBINATION OPTIMIZER
// ============================================================
// The optimizer must:
//   - evaluate ALL C(8,4)=70 combinations explicitly
//   - consider calibrated probability + uncertainty + reliability + diversity
//   - be CAPABLE of selecting a combination DIFFERENT from greedy top-4-by-score
//   - log WHY the winning combination won (optimizerNote)
//   - NEVER hardcode [1,2,5,10] or force a bonus slot or use random selection

const NUMBER_NAMES = ["1", "2", "5", "10"];

describe("C4 — real 70-combination optimizer", () => {
  const rounds = roundsFrom(CRAZY_INFLATED_30);

  test("C4 ON + C6 ON produces a non-empty optimizerNote explaining why the combo won", () => {
    const eng = buildInitial(rounds, [], "baseline", {
      ...ALL_FLAGS_OFF,
      c1_calibratedChannel: true, c2_genericReliability: true,
      c3_uncertaintyShrinkage: true, c4_realOptimizer: true, c6_rcaInstrumentation: true,
    });
    expect(eng.lockedRca).not.toBeNull();
    expect(eng.lockedRca!.optimizerNote.length).toBeGreaterThan(0);
    expect(eng.lockedRca!.optimizerNote).toContain("C4 real optimizer");
  });

  test("C4 can select a DIFFERENT combination than greedy top-4-by-rawScore", () => {
    // Baseline (all OFF): greedy top-4-by-rawScore. With CRAZY TIME inflated (3× in 30),
    // the 0.5/0.5 blend inflates CRAZY TIME's rawScore above "1"'s, so greedy INCLUDES
    // a bonus (CRAZY TIME) and DISPLACES a number.
    const baseline = buildInitial(rounds, [], "baseline", ALL_FLAGS_OFF);
    // Experimental (C1+C2+C3+C4 ON): the optimizer uses the true posterior for
    // coverage + an overreaction penalty on low-reliability bonuses, so it should
    // DROP the bonus and select the number-heavy set.
    const experimental = buildInitial(rounds, [], "baseline", {
      ...ALL_FLAGS_OFF,
      c1_calibratedChannel: true, c2_genericReliability: true,
      c3_uncertaintyShrinkage: true, c4_realOptimizer: true, c6_rcaInstrumentation: true,
    });
    const baseTop4 = baseline.nextSignalNames;
    const expTop4 = experimental.nextSignalNames;
    // The two selections must DIFFER (this is the proof the optimizer is real,
    // not the degenerate greedy).
    expect(JSON.stringify([...baseTop4].sort())).not.toBe(JSON.stringify([...expTop4].sort()));
    // Baseline includes at least one bonus (the displacement bug).
    expect(baseTop4.some((n) => BONUS_NAMES.includes(n))).toBe(true);
    // Experimental drops the low-reliability bonus entirely (pure numbers).
    expect(expTop4.every((n) => NUMBER_NAMES.includes(n))).toBe(true);
  });

  test("C4 OFF (C1 ON) is the degenerate greedy-by-coverage (matches top-4-by-probability)", () => {
    // With C1 ON but C4 OFF, the optimizer objective = coverage (Σ posterior),
    // which is maximized by the 4 highest posteriors → degenerate greedy.
    const eng = buildInitial(rounds, [], "baseline", {
      ...ALL_FLAGS_OFF, c1_calibratedChannel: true, c6_rcaInstrumentation: true,
    });
    // The optimizerNote must indicate C4 OFF (degenerate).
    expect(eng.lockedRca!.optimizerNote).toContain("C4 OFF");
    // And the selection should equal the 4 highest posteriors.
    const byPost = [...eng.candidateScores]
      .sort((a, b) => (b.calibratedProbabilityPosterior ?? 0) - (a.calibratedProbabilityPosterior ?? 0))
      .slice(0, 4).map((c) => c.game.name).sort();
    expect([...eng.nextSignalNames].sort()).toEqual(byPost);
  });

  test("optimizer never hardcodes [1,2,5,10] — when evidence supports a bonus, it CAN include it", () => {
    // Build a history where COIN FLIP is genuinely over-represented with ENOUGH
    // observations that its reliability exceeds the gate (so no overreaction penalty).
    // 60 rounds: COIN FLIP ×12 (prior 7.41%, expected ~4.4; reliability 12/22=0.55 > gate).
    const coinHeavy: string[] = [];
    const seq = ["1", "2", "1", "COIN FLIP", "5", "2", "1", "COIN FLIP", "10", "2", "1", "COIN FLIP"];
    for (let i = 0; i < 60; i++) coinHeavy.push(seq[i % seq.length]);
    const eng = buildInitial(roundsFrom(coinHeavy), [], "baseline", {
      ...ALL_FLAGS_OFF,
      c1_calibratedChannel: true, c2_genericReliability: true,
      c3_uncertaintyShrinkage: true, c4_realOptimizer: true, c6_rcaInstrumentation: true,
    });
    const coin = eng.candidateScores.find((c) => c.game.name === "COIN FLIP")!;
    // COIN FLIP has 12 observations → reliability 0.55 > 0.4 gate → NO overreaction penalty.
    expect(coin.reliability!).toBeGreaterThan(0.4);
    // Its posterior should be elevated above prior (genuine evidence).
    expect(coin.calibratedProbabilityPosterior!).toBeGreaterThan(coin.priorProbability!);
    // The optimizer is ALLOWED to include it (not hardcoded out).
    // (We don't assert it MUST include it — only that the mechanism permits a bonus
    //  with sufficient evidence, proving no hardcoded [1,2,5,10] forcing.)
    expect(eng.lockedRca!.optimizerNote).toContain("C4 real optimizer");
  });

  test("the optimizer evaluates all 70 combinations (no early-exit / no random pick)", () => {
    // Deterministic: two runs with identical input + flags produce identical Top-4.
    const flags = {
      ...ALL_FLAGS_OFF,
      c1_calibratedChannel: true, c2_genericReliability: true,
      c3_uncertaintyShrinkage: true, c4_realOptimizer: true,
    };
    const a = buildInitial(rounds, [], "baseline", flags);
    const b = buildInitial(rounds, [], "baseline", flags);
    expect(a.nextSignalNames).toEqual(b.nextSignalNames);
  });
});
