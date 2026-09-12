import { runRetrospectiveDiagnostic } from "../src/components/revo/decisionEngine";
import * as fs from "fs";

const raw = JSON.parse(fs.readFileSync("scripts/data/pass282_history.json", "utf8"));
const arr = JSON.parse(raw.data.result);
const actuals: string[] = arr.map((r: any) => r.actualResult.name);

const retro = runRetrospectiveDiagnostic(actuals, []);

const theoHits = actuals.filter((n) => ["1", "2", "5", "10"].includes(n)).length;
const bonusHits = actuals.filter((n) => ["PACHINKO", "COIN FLIP", "CASH HUNT", "CRAZY TIME"].includes(n)).length;

const out = {
  n: actuals.length,
  actual_distribution: actuals.reduce((m: Record<string, number>, n) => { m[n] = (m[n] ?? 0) + 1; return m; }, {}),
  benchmark_A_dynamic_baseline_stored: 118,            // from RCA on stored history
  benchmark_B_experimental_replay: {
    hits: retro.experimental.hits,
    misses: retro.experimental.misses,
    hitRate: retro.experimental.hitRate,
  },
  baseline_replay: {
    hits: retro.baseline.hits,
    misses: retro.baseline.misses,
    hitRate: retro.baseline.hitRate,
  },
  benchmark_C_theoretical_12510: theoHits,
  benchmark_C_rate: theoHits / actuals.length,
  bonus_actuals_total: bonusHits,
  flipsToHit_miss_to_hit: retro.flipsToHit,
  flipsToMiss_hit_to_miss: retro.flipsToMiss,
  net_gain_experimental: retro.experimental.hits - retro.baseline.hits,
  pachinkoInclusions_baseline: retro.baseline.pachinkoInclusions,
  pachinkoInclusions_experimental: retro.experimental.pachinkoInclusions,
  pachinko_actuals: retro.baseline.pachinkoActuals,
  pachinkoCoveredActuals_experimental: retro.pachinkoActualsRetained,
  exclusionRates_baseline: retro.baseline.exclusionRates,
  exclusionRates_experimental: retro.experimental.exclusionRates,
  perOutcome_baseline: retro.baseline.perOutcome,
  perOutcome_experimental: retro.experimental.perOutcome,
  note: retro.note,
};

fs.writeFileSync("scripts/data/replay_top4_result.json", JSON.stringify(out, null, 2));
process.stderr.write("WROTE scripts/data/replay_top4_result.json\n");
process.stderr.write(`baseline_replay=${retro.baseline.hits}/${actuals.length}=${(retro.baseline.hitRate*100).toFixed(2)}%  experimental=${retro.experimental.hits}/${actuals.length}=${(retro.experimental.hitRate*100).toFixed(2)}%  theo=${theoHits}/${actuals.length}=${(theoHits/actuals.length*100).toFixed(2)}%  flipsToHit=${retro.flipsToHit} flipsToMiss=${retro.flipsToMiss}\n`);
