/**
 * SIGNAL LAYER WALK-FORWARD VALIDATION RUNNER (ADDITIVE tooling)
 * =============================================================
 *
 * Runs the strict walk-forward harness (`signalValidation.ts`) over the REAL
 * settled rounds already stored in `scripts/data/` and writes:
 *
 *   · scripts/data/signal_validation_report.json   (machine-readable)
 *   · SIGNAL_LAYERS_VALIDATION.md                  (human-readable summary)
 *
 * Datasets (real rounds the project collected live — no mock data):
 *   · scripts/data/final_benchmark_rounds.jsonl   500 rounds, real settledAt,
 *       real actual results, and the Top-4 the production engine LOCKED LIVE.
 *   · scripts/data/pass179_history.json          1279 rounds (21.2 h span) from
 *       the live baseline ledger (prediction + actual + timestamps).
 *
 * Run:
 *   node --import ./scripts/ts-resolve-register.mjs scripts/validate_signal_layers.ts
 *   node --import ./scripts/ts-resolve-register.mjs scripts/validate_signal_layers.ts --max-rounds 400
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSignalValidation, type SignalValidationReport, type ValidationRoundInput } from "../src/components/revo/signalValidation";
import { GAMES, replayPrediction, type RoundResult } from "../src/components/revo/decisionEngine";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA = path.join(ROOT, "scripts", "data");

// ---------------------------------------------------------------------------
// Loaders (real data only — every row must carry a real settlement timestamp)
// ---------------------------------------------------------------------------

function loadBenchmarkJsonl(file: string): ValidationRoundInput[] {
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return [];
  const rows = raw.split("\n").map((l) => JSON.parse(l));
  const out: ValidationRoundInput[] = [];
  for (const r of rows) {
    const settledAt = new Date(r.settledAt).getTime();
    const outcome = typeof r.actual === "string" ? r.actual : r.actual?.name;
    if (!Number.isFinite(settledAt) || typeof outcome !== "string") continue;
    out.push({
      roundId: `bench-${r.roundId}`,
      spinId: r.spinId ?? `bench-spin-${r.roundId}`,
      settledAt,
      outcome,
      productionTop4: Array.isArray(r.armB_Top4) && r.armB_Top4.length === 4 ? r.armB_Top4 : null,
    });
  }
  return out;
}

function loadHistoryJson(file: string): ValidationRoundInput[] {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const raw = j?.data?.result ?? j?.result;
  if (typeof raw !== "string") return [];
  const rounds = JSON.parse(raw);
  if (!Array.isArray(rounds)) return [];
  const out: ValidationRoundInput[] = [];
  rounds.forEach((r: { prediction?: { game?: { name?: string } }[]; actualResult?: { name?: string }; time?: number }, idx: number) => {
    const outcome = r.actualResult?.name;
    const settledAt = typeof r.time === "number" ? r.time : NaN;
    if (typeof outcome !== "string" || !Number.isFinite(settledAt)) return;
    const preds = Array.isArray(r.prediction) ? r.prediction.map((p) => p.game?.name).filter((n): n is string => typeof n === "string") : [];
    out.push({
      roundId: `${path.basename(file, ".json")}-${idx}`,
      spinId: `${path.basename(file, ".json")}-spin-${idx}`,
      settledAt,
      outcome,
      productionTop4: preds.length === 4 ? preds : null,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Production-engine replay (for arm B probabilities → calibration metrics)
// ---------------------------------------------------------------------------
// The stored Top-4 is what production LOCKED LIVE, so it decides the hit for
// arm B. The replay only supplies a probability vector for calibration scoring.
function makeProductionReplay() {
  const gameByName = new Map(GAMES.map((g) => [g.name, g]));
  return (history: { roundId: string; spinId: string; settledAt: number; outcome: string; productionTop4?: string[] | null }[]) => {
    const rounds: RoundResult[] = history.map((h) => {
      const preds = h.productionTop4 ?? ["1", "2", "5", "10"];
      const prediction = preds.map((n, idx) => ({
        game: gameByName.get(n) ?? GAMES[0],
        confidence: 50,
        time: h.settledAt,
        rank: idx + 1,
        label: "",
        signals: [],
      }));
      return {
        prediction: prediction as unknown as RoundResult["prediction"],
        actualResult: gameByName.get(h.outcome) ?? GAMES[0],
        hit: preds.includes(h.outcome),
        time: h.settledAt,
        confidence: 50,
        recalibrated: false,
      };
    });
    const origLog = console.log;
    console.log = () => {};
    let eng;
    try {
      eng = replayPrediction(rounds);
    } finally {
      console.log = origLog;
    }
    const top4 = eng.predictions.map((p) => p.game.name);
    const scores: Record<string, number> = {};
    let sum = 0;
    for (const c of eng.candidateScores) {
      const v = Math.max(0, c.rawScore);
      scores[c.game.name] = v;
      sum += v;
    }
    if (sum > 0) for (const k of Object.keys(scores)) scores[k] /= sum;
    const probabilities = Object.keys(scores).length > 0 ? scores : { ...{} };
    return { top4, probabilities };
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function buildMarkdown(report: SignalValidationReport, extraDatasets: string[]): string {
  const lines: string[] = [];
  lines.push("# Signal Layers — Walk-Forward Validation Report");
  lines.push("");
  lines.push(`Generated: ${new Date(report.generatedAt).toISOString()}`);
  lines.push(`Harness version: ${report.version}`);
  lines.push(`Dataset(s): ${[report.dataset, ...extraDatasets].filter(Boolean).join(", ")}`);
  lines.push(`Rounds evaluated: **${report.roundsEvaluated}** real settled rounds`);
  if (report.roundRange.from && report.roundRange.to) {
    lines.push(`Window: ${new Date(report.roundRange.from).toISOString()} → ${new Date(report.roundRange.to).toISOString()}`);
  }
  lines.push("");
  lines.push("## Arms (all evaluated on the SAME chronological rounds)");
  lines.push("");
  lines.push("| Arm | Rounds | Hits | Hit rate | Wilson 95% | Bootstrap 95% | Brier | ECE | Bonus incl. |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const arm of Object.values(report.arms)) {
    lines.push(
      `| ${arm.label} | ${arm.rounds} | ${arm.hits} | ${pct(arm.hitRate)} | [${pct(arm.wilson.low)}, ${pct(arm.wilson.high)}] | [${pct(arm.bootstrapCI.low)}, ${pct(arm.bootstrapCI.high)}] | ${arm.brier === null ? "—" : arm.brier.toFixed(4)} | ${arm.expectedCalibrationError === null ? "—" : arm.expectedCalibrationError.toFixed(4)} | ${arm.bonusInclusionRate === null ? "—" : pct(arm.bonusInclusionRate)} |`,
    );
  }
  const unavailable = Object.values(report.arms).filter((a) => !a.available);
  if (unavailable.length > 0) {
    lines.push("");
    lines.push("**Arms without real data (NOT fabricated):**");
    for (const a of unavailable) lines.push(`- ${a.label}: ${a.unavailableReason ?? "no data"}`);
  }
  lines.push("");
  lines.push("## Paired comparisons (McNemar on discordant rounds)");
  lines.push("");
  lines.push("| Comparison | Paired n | A-only | B-only | Δ (pp) | Bootstrap CI on Δ | McNemar p | Verdict |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const c of report.comparisons) {
    const verdict = c.pairedRounds === 0
      ? "NOT EVALUATED"
      : c.significant
        ? "SIGNIFICANT"
        : c.mcnemarConclusive
          ? "not significant"
          : "INCONCLUSIVE";
    lines.push(
      `| ${c.label} | ${c.pairedRounds} | ${c.onlyA} | ${c.onlyB} | ${c.deltaPp.toFixed(2)} | [${c.ciLowDeltaPp.toFixed(2)}, ${c.ciHighDeltaPp.toFixed(2)}] | ${c.mcnemarP} | ${verdict} |`,
    );
  }
  lines.push("");
  lines.push("## Time-signal diagnostics during the walk-forward");
  lines.push("");
  lines.push(`- Regime status counts: ${JSON.stringify(report.timeSignalDiagnostics.regimeStatusCounts)}`);
  lines.push(`- Rounds where the time signal was ACTIVE: ${report.timeSignalDiagnostics.activeRounds}/${report.roundsEvaluated}`);
  lines.push(`- Mean time-signal confidence: ${(report.timeSignalDiagnostics.meanConfidence * 100).toFixed(1)}%`);
  lines.push(`- Mean primary-window sample: ${report.timeSignalDiagnostics.meanPrimarySample}`);
  lines.push(`- Primary window usage: ${JSON.stringify(report.timeSignalDiagnostics.windowUsage)}`);
  lines.push("");
  lines.push("## Audits");
  lines.push("");
  lines.push(`- Duplicate audit: ${report.audits.duplicate.passed ? "PASS" : `FAIL (${report.audits.duplicate.duplicates.length})`}`);
  lines.push(`- Timestamp audit: ${report.audits.timestamp.passed ? "PASS" : `FAIL (${report.audits.timestamp.problems.length})`}${report.audits.timestamp.monotonic ? " (monotonic)" : " (NOT monotonic)"}`);
  lines.push(`- Leakage audit: ${report.audits.leakage.passed ? "PASS" : `FAIL (${report.audits.leakage.violations.length})`} — ${report.audits.leakage.checkedRounds} rounds checked`);
  lines.push(`- Overall integrity: ${report.audits.integrity.passed ? "PASS" : `FAIL — ${report.audits.integrity.problems.join("; ")}`}`);
  lines.push("");
  lines.push("## Promotion gate (feature flags stay OFF unless this passes)");
  lines.push("");
  for (const p of report.recommendation.promotable) {
    lines.push(`- **${p.signal}**: ${p.allowed ? "PROMOTABLE" : `NOT PROMOTABLE — ${p.reasons.join("; ")}`}`);
  }
  lines.push("");
  lines.push(`> ${report.recommendation.summary}`);
  lines.push("");
  lines.push(`> ${report.disclaimer}`);
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { maxRounds: number; outJson: string; outMd: string; dataset: string } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    maxRounds: Number(get("--max-rounds") ?? 500),
    outJson: get("--out") ?? path.join(DATA, "signal_validation_report.json"),
    outMd: get("--out-md") ?? path.join(ROOT, "SIGNAL_LAYERS_VALIDATION.md"),
    dataset: get("--dataset") ?? "final_benchmark_rounds.jsonl",
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const benchFile = path.join(DATA, args.dataset);
  const historyFile = path.join(DATA, "pass179_history.json");

  const benchRounds = fs.existsSync(benchFile) ? loadBenchmarkJsonl(benchFile) : [];
  const historyRounds = fs.existsSync(historyFile) ? loadHistoryJson(historyFile) : [];
  console.log(`loaded ${benchRounds.length} benchmark rounds and ${historyRounds.length} ledger rounds`);

  const bench = benchRounds.slice(-args.maxRounds);
  const reportBench = runSignalValidation(bench, {
    dataset: `${path.basename(benchFile)} (${bench.length} rounds, production locks stored live)`,
    productionReplay: makeProductionReplay() as never,
    minRoundsForReporting: 50,
    seed: 20260919,
  });
  console.log(`benchmark run: ${reportBench.roundsEvaluated} rounds evaluated`);

  // Secondary run on the longer ledger (stored live locks; no replay → faster).
  const ledgerSample = historyRounds.slice(-args.maxRounds);
  const reportLedger = ledgerSample.length >= 50
    ? runSignalValidation(ledgerSample, {
        dataset: `pass179_history.json (${ledgerSample.length} rounds, live baseline ledger)`,
        minRoundsForReporting: 50,
        seed: 20260919,
      })
    : null;
  if (reportLedger) console.log(`ledger run: ${reportLedger.roundsEvaluated} rounds evaluated`);

  const combined = {
    primary: reportBench,
    secondary: reportLedger,
    meta: {
      generatedAt: Date.now(),
      runner: "scripts/validate_signal_layers.ts",
      nodeRuntime: process.version,
      note: "Both datasets contain REAL settled rounds collected from the live game. No mock or synthetic rounds are used in any accuracy metric.",
    },
  };
  fs.writeFileSync(args.outJson, JSON.stringify(combined, null, 2));

  const md = [
    buildMarkdown(reportBench, []),
    reportLedger
      ? `\n---\n\n# Secondary dataset\n\n${buildMarkdown(reportLedger, []).replace("# Signal Layers — Walk-Forward Validation Report\n\n", "")}`
      : "",
  ].join("\n");
  fs.writeFileSync(args.outMd, md);

  console.log(`\nwrote ${args.outJson}`);
  console.log(`wrote ${args.outMd}`);
  for (const arm of Object.values(reportBench.arms)) {
    console.log(
      `${arm.available ? " " : "×"} ${arm.label.padEnd(40)} n=${String(arm.rounds).padStart(4)} hit=${(arm.hitRate * 100).toFixed(2)}%`,
    );
  }
  console.log("\npromotion gate:");
  for (const p of reportBench.recommendation.promotable) {
    console.log(`  ${p.signal}: ${p.allowed ? "PROMOTABLE" : `NOT PROMOTABLE — ${p.reasons.join("; ")}`}`);
  }
  console.log("\naudits:", JSON.stringify(reportBench.audits.integrity));
}

main();
