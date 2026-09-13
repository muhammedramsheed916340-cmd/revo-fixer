/**
 * FROZEN VALIDATION ANALYZER
 * ==========================
 *
 * Reads the collected actualNames from the frozen validation collector and
 * runs `runFrozenWalkForward` to produce the final 13-point validation report.
 *
 * This is a PURE analysis step — no engine modification, no tuning. It reads
 * the frozen collected data and computes:
 *   - Baseline vs Experimental vs Theoretical HIT rates
 *   - McNemar paired test
 *   - Per-outcome inclusion/hit efficiency
 *   - Bonus inclusion rate, number exclusion rate
 *   - Per-bonus (PACHINKO/CRAZY TIME/CASH HUNT/COIN FLIP) stats
 *   - Duplicate/leakage evidence from the JSONL
 *
 * Output: scripts/data/frozen_validation_report.json + stdout.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import {
  runFrozenWalkForward,
  ALL_FLAGS_OFF,
  MODEL_VERSION,
  type FeatureFlags,
  type FrozenWalkForwardResult,
  BONUS_NAMES,
} from "../../src/components/revo/decisionEngine";

const ACTUALS_FILE = "scripts/data/frozen_validation_actuals.json";
const ROUNDS_FILE = "scripts/data/frozen_validation_rounds.jsonl";
const REPORT_FILE = "scripts/data/frozen_validation_report.json";

const EXPERIMENTAL_FLAGS: FeatureFlags = {
  c1_calibratedChannel: true,
  c2_genericReliability: true,
  c3_uncertaintyShrinkage: true,
  c4_realOptimizer: true,
  c5_deScopeHarmful: true,
  c6_rcaInstrumentation: true,
  c7_frozenWalkForward: true,
};

interface RoundRow {
  roundId: number;
  spinId: string;
  actualResult: string;
  baselineTop4: string[];
  experimentalTop4: string[];
  baselineHit: boolean;
  experimentalHit: boolean;
  theoreticalHit: boolean;
  selectedBonusCount: { baseline: number; experimental: number };
  excludedFifth: { baseline: string; experimental: string };
  duplicateCheck: { isDuplicate: boolean; seenIdsBefore: number };
  leakageCheck: { historyLengthBefore: number; predictionComputedBeforeSettle: boolean };
}

function readActuals(): string[] {
  if (!existsSync(ACTUALS_FILE)) {
    throw new Error(`Actuals file not found: ${ACTUALS_FILE}. Run the collector first.`);
  }
  return JSON.parse(readFileSync(ACTUALS_FILE, "utf-8")) as string[];
}

function readRoundRows(): RoundRow[] {
  if (!existsSync(ROUNDS_FILE)) return [];
  const lines = readFileSync(ROUNDS_FILE, "utf-8").trim().split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l) as RoundRow);
}

function pp(n: number, digits = 2): string {
  return (n * 100).toFixed(digits) + "%";
}

async function main() {
  const actualNames = readActuals();
  const rows = readRoundRows();

  console.log("=".repeat(70));
  console.log("FROZEN FRESH-ROUND SHADOW A/B VALIDATION — ANALYSIS");
  console.log("=".repeat(70));
  console.log(`Model version: ${MODEL_VERSION}`);
  console.log(`Baseline flags:     ALL_FLAGS_OFF (bit-for-bit production)`);
  console.log(`Experimental flags: ALL C1–C7 ON`);
  console.log(`Paired rounds collected: ${actualNames.length}`);
  console.log(`JSONL rows: ${rows.length}`);
  console.log("");

  if (actualNames.length < 100) {
    console.log(`⚠ WARNING: only ${actualNames.length} rounds (< 100 minimum). Results are directional only.`);
  }

  // ===== Run the frozen walk-forward harness (the authoritative paired comparison) =====
  const result: FrozenWalkForwardResult = runFrozenWalkForward(actualNames, EXPERIMENTAL_FLAGS, []);

  // ===== Cross-check: verify the JSONL rows match the harness (duplicate/leakage integrity) =====
  const duplicateSpinIds = new Set<string>();
  const duplicateRounds: number[] = [];
  for (const r of rows) {
    if (duplicateSpinIds.has(r.spinId)) duplicateRounds.push(r.roundId);
    duplicateSpinIds.add(r.spinId);
  }
  const leakageViolations = rows.filter((r) => !r.leakageCheck.predictionComputedBeforeSettle);

  // Per-bonus stats from the harness.
  const perBonus = (arm: typeof result.baseline) => {
    const out: Record<string, { inclusions: number; actuals: number; covered: number; inclusionRate: number; hitRate: number }> = {};
    for (const b of BONUS_NAMES) {
      const st = arm.perOutcome.find((o) => o.name === b)!;
      out[b] = {
        inclusions: st.inclusions,
        actuals: st.actuals,
        covered: st.coveredActuals,
        inclusionRate: arm.totalRounds > 0 ? st.inclusions / arm.totalRounds : 0,
        hitRate: st.inclusions > 0 ? st.coveredActuals / st.inclusions : 0,
      };
    }
    return out;
  };

  const baselineBonus = perBonus(result.baseline);
  const experimentalBonus = perBonus(result.experimental);

  // ===== THE 13-POINT REPORT =====
  const report = {
    meta: {
      modelVersion: MODEL_VERSION,
      baselineFlags: ALL_FLAGS_OFF,
      experimentalFlags: EXPERIMENTAL_FLAGS,
      collectedAt: new Date().toISOString(),
      pairedRounds: result.freshRounds,
      jsonlRows: rows.length,
    },
    "1_baseline_hit_total_pct": {
      hits: result.baseline.hits,
      total: result.baseline.totalRounds,
      pct: result.baseline.hitRate,
    },
    "2_experimental_hit_total_pct": {
      hits: result.experimental.hits,
      total: result.experimental.totalRounds,
      pct: result.experimental.hitRate,
    },
    "3_theoretical_12510_hit_total_pct": {
      hits: result.theoretical.hits,
      total: result.baseline.totalRounds,
      pct: result.theoretical.hitRate,
    },
    "4_experimental_delta_vs_baseline_pp": result.experimental.hitRate - result.baseline.hitRate,
    "5_mcnemar": result.mcnemar,
    "6_m2h_h2m": {
      m2h_missToHit: result.flipsToHit,   // baseline MISS → experimental HIT
      h2m_hitToMiss: result.flipsToMiss,   // baseline HIT → experimental MISS
    },
    "7_per_outcome_inclusion_vs_hit_efficiency": {
      baseline: result.baseline.perOutcome,
      experimental: result.experimental.perOutcome,
    },
    "8_bonus_inclusion_rate": {
      baseline: result.baseline.bonusInclusionRate,
      experimental: result.experimental.bonusInclusionRate,
    },
    "9_number_exclusion_rate": {
      baseline: result.baseline.numberExclusionRate,
      experimental: result.experimental.numberExclusionRate,
    },
    "10_per_bonus_inclusion_and_hit_rates": {
      baseline: baselineBonus,
      experimental: experimentalBonus,
    },
    "11_duplicate_leakage_evidence": {
      duplicateSettlements: duplicateRounds.length,
      duplicateRoundIds: duplicateRounds,
      leakageViolations: leakageViolations.length,
      allPredictionsComputedBeforeSettle: leakageViolations.length === 0,
    },
    "12_exact_clean_paired_rounds": result.freshRounds - duplicateRounds.length,
    "13_rounds_excluded_and_why": {
      excluded: duplicateRounds.length,
      reason: duplicateRounds.length > 0 ? "duplicate spin id (counted once, excluded from clean count)" : "none",
    },
    disclaimer: result.note,
  };

  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  // ===== STDOUT SUMMARY =====
  console.log("");
  console.log("=".repeat(70));
  console.log("FINAL VALIDATION REPORT (13 points)");
  console.log("=".repeat(70));
  console.log(`1.  Baseline:              ${result.baseline.hits}/${result.baseline.totalRounds} = ${pp(result.baseline.hitRate)}`);
  console.log(`2.  Experimental:          ${result.experimental.hits}/${result.experimental.totalRounds} = ${pp(result.experimental.hitRate)}`);
  console.log(`3.  Theoretical [1,2,5,10]: ${result.theoretical.hits}/${result.baseline.totalRounds} = ${pp(result.theoretical.hitRate)}`);
  const deltaPp = (result.experimental.hitRate - result.baseline.hitRate) * 100;
  console.log(`4.  Experimental delta:    ${deltaPp >= 0 ? "+" : ""}${deltaPp.toFixed(2)} percentage points vs baseline`);
  console.log(`5.  McNemar:               χ²=${result.mcnemar.statistic.toFixed(3)}, p=${result.mcnemar.pValue.toFixed(4)}, ${result.mcnemar.significant ? "SIGNIFICANT" : "not significant"} (r=${result.mcnemar.r}, s=${result.mcnemar.s})`);
  console.log(`    ${result.mcnemar.note}`);
  console.log(`6.  M2H (miss→hit):        ${result.flipsToHit}`);
  console.log(`    H2M (hit→miss):        ${result.flipsToMiss}`);
  console.log(`7.  Per-outcome efficiency:`);
  for (const o of result.experimental.perOutcome) {
    const b = result.baseline.perOutcome.find((x) => x.name === o.name)!;
    console.log(`    ${o.name.padEnd(12)} base: incl=${b.inclusions.toString().padStart(3)} hit-eff=${pp(b.hitEfficiency, 1)}  | exp: incl=${o.inclusions.toString().padStart(3)} hit-eff=${pp(o.hitEfficiency, 1)}`);
  }
  console.log(`8.  Bonus inclusion rate:  base=${pp(result.baseline.bonusInclusionRate, 2)} exp=${pp(result.experimental.bonusInclusionRate, 2)}`);
  console.log(`9.  Number exclusion rate:`);
  for (const num of ["1", "2", "5", "10"]) {
    console.log(`    "${num}": base=${pp(result.baseline.numberExclusionRate[num], 1)} exp=${pp(result.experimental.numberExclusionRate[num], 1)}`);
  }
  console.log(`10. Per-bonus (inclusion % / hit-efficiency %):`);
  for (const b of BONUS_NAMES) {
    const be = baselineBonus[b], ee = experimentalBonus[b];
    console.log(`    ${b.padEnd(12)} base: incl=${pp(be.inclusionRate, 1)} (${be.inclusions}×, actuals=${be.actuals}, hit=${pp(be.hitRate, 0)})  | exp: incl=${pp(ee.inclusionRate, 1)} (${ee.inclusions}×, actuals=${ee.actuals}, hit=${pp(ee.hitRate, 0)})`);
  }
  console.log(`11. Duplicate/leakage:    duplicate settlements=${duplicateRounds.length}, leakage violations=${leakageViolations.length}, all-predictions-before-settle=${leakageViolations.length === 0}`);
  console.log(`12. Clean paired rounds:  ${report["12_exact_clean_paired_rounds"]}`);
  console.log(`13. Rounds excluded:       ${duplicateRounds.length} (${report["13_rounds_excluded_and_why"].reason})`);
  console.log("");
  console.log("=".repeat(70));
  console.log("DISCLAIMER");
  console.log("=".repeat(70));
  console.log(result.note);
  console.log("");
  console.log(`Full report → ${REPORT_FILE}`);
}

main().catch((e) => {
  console.error(`ANALYZER FATAL: ${(e as Error).stack}`);
  process.exit(1);
});
