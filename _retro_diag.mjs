import { runRetrospectiveDiagnostic } from "/home/z/my-project/src/components/revo/decisionEngine.ts";
const SYNTH = [
  "1","2","1","5","2","1","10","2","1","COIN FLIP",
  "1","2","5","1","2","1","PACHINKO","2","1","5",
  "10","1","2","1","COIN FLIP","5","2","1","1","2",
  "1","5","10","2","1","CASH HUNT","2","1","5","1",
  "2","1","PACHINKO","5","2","1","10","2","1","PACHINKO",
];
const r = runRetrospectiveDiagnostic(SYNTH, []);
const fmt = (x) => Math.round(x*100);
console.log("=== RETROSPECTIVE DIAGNOSTIC (synthetic 50) ===");
console.log("Rounds:", r.baseline.totalRounds);
console.log("Baseline     HIT:", r.baseline.hits+"/"+r.baseline.totalRounds, "=", fmt(r.baseline.hitRate)+"%");
console.log("Experimental HIT:", r.experimental.hits+"/"+r.experimental.totalRounds, "=", fmt(r.experimental.hitRate)+"%");
console.log("Net Δ hits:", r.experimental.hits - r.baseline.hits);
console.log("Flips MISS→HIT:", r.flipsToHit, " | Flips HIT→MISS:", r.flipsToMiss);
console.log("PACHINKO inclusions: base", r.baseline.pachinkoInclusions, "→ exp", r.experimental.pachinkoInclusions, "(removed", r.pachinkoInclusionsRemoved+")");
console.log("PACHINKO actuals:", r.baseline.pachinkoActuals, "| retained by exp:", r.pachinkoActualsRetained);
console.log("--- per outcome (name: actuals | baseInc → expInc | baseCov / expCov) ---");
for (let i=0;i<r.baseline.perOutcome.length;i++){
  const b=r.baseline.perOutcome[i], e=r.experimental.perOutcome[i];
  console.log(`  ${b.name.padEnd(11)}: act=${b.actuals}  inc ${b.inclusions}→${e.inclusions}  cov ${b.coveredActuals}/${b.actuals} → ${e.coveredActuals}/${e.actuals}`);
}
console.log("--- exclusion rates (1/2/5/10) ---");
for (const n of ["1","2","5","10"]){
  const b=r.baseline.exclusionRates[n], e=r.experimental.exclusionRates[n];
  console.log(`  "${n}": ${fmt(b)}% → ${fmt(e)}%  (prevented ${r.exclusionPrevented[n]})`);
}
console.log("--- round-by-round flips ---");
for (let i=0;i<r.baseline.rounds.length;i++){
  const b=r.baseline.rounds[i], e=r.experimental.rounds[i];
  if (b.hit!==e.hit){
    console.log(`  R${b.idx}: actual=${b.actual} base[${b.preds.join(",")}] ${b.hit?"HIT":"MISS"} → exp[${e.preds.join(",")}] ${e.hit?"HIT":"MISS"}`);
  }
}
