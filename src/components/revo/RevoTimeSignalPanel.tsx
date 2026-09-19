"use client";

/**
 * TIME-SIGNAL DIAGNOSTIC PANEL (ADDITIVE — new component)
 * ======================================================
 *
 * Shows the required diagnostic surface:
 *
 *   CURRENT TIME WINDOW · SAMPLE SIZE · OBSERVED BASE · THEORETICAL BASE ·
 *   BASE-RATE SHIFT · REGIME STATUS · TIME-SIGNAL CONFIDENCE
 *
 * …and, for every lock, exactly WHY the time-based signal did or did not
 * change the prediction.
 *
 * It reads the live signal store; nothing in the production path is modified.
 */

import { useMemo, useSyncExternalStore, useState } from "react";
import {
  getSignalStoreVersion,
  getTimedRounds,
  subscribeSignalStore,
  auditSignalStore,
} from "./signalDataStore";
import {
  OUTCOMES_8,
  THEORETICAL_BASE_54,
  computeTimeSignal,
  classifyTimeContext,
  type TimeSignalResult,
  type WindowStats,
} from "./timeSignal";
import { OUTCOME_COLORS, OUTCOME_DISPLAY } from "./signalSectorMap";
import { getSignalFlags } from "./signalFlags";
import { SignalPanelPlaceholder, useMounted } from "./SignalPanelFrame";

function useStoreVersion(): number {
  return useSyncExternalStore(subscribeSignalStore, getSignalStoreVersion, () => 0);
}

function pct(x: number, digits = 2): string {
  return `${(x * 100).toFixed(digits)}%`;
}

function pp(x: number): string {
  const v = x * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)} pp`;
}

const STATUS_COLOR: Record<string, string> = {
  CONFIRMED_REGIME: "#ff4757",
  CANDIDATE_REGIME: "#ffa502",
  NO_REGIME: "#2ed573",
  INSUFFICIENT_DATA: "#5a6a99",
};

export function RevoTimeSignalPanel() {
  useStoreVersion();
  const rounds = getTimedRounds();
  const flags = getSignalFlags();
  const mounted = useMounted();
  const [selectedWindow, setSelectedWindow] = useState<string>("");

  const signal: TimeSignalResult = useMemo(
    () =>
      computeTimeSignal({
        rounds,
        lockTimestamp: Date.now(),
      }),
    [rounds.length, rounds[rounds.length - 1]?.settledAt],
  );

  const audit = useMemo(() => auditSignalStore(), [rounds.length]);
  const ctx = classifyTimeContext(signal.lockTimestamp);
  const windows: WindowStats[] = signal.windows;
  const activeWindow = selectedWindow
    ? windows.find((w) => w.key === selectedWindow) ?? signal.primaryWindow
    : signal.primaryWindow;

  // SSR/hydration guard (repo convention, see RevoGame.tsx): every value below
  // comes from browser-only state (signal store, video telemetry, flags). The
  // pre-mount render is a stable data-free shell so the server output and the
  // first client render match — no hydration mismatch in the production build.
  if (!mounted) {
    return <SignalPanelPlaceholder icon="fa-clock-rotate-left" title="Time-based wheel analysis" note="Reading the real settlement timestamps of stored rounds to build the rolling and time-of-day windows…" accent="#a78bfa" />;
  }

  return (
    <div className="revo-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1e2240] bg-gradient-to-r from-[#a78bfa]/10 to-transparent px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-clock text-[#a78bfa]" /> Time-based wheel analysis
        </span>
        <span className="flex items-center gap-2 text-[10px]">
          <span
            className="rounded px-2 py-0.5 font-bold"
            style={{
              color: flags.TIME_SIGNAL ? "#2ed573" : "#5a6a99",
              border: `1px solid ${flags.TIME_SIGNAL ? "#2ed57355" : "#2a2f52"}`,
            }}
            title="Time signal influences the ensemble ONLY when enabled by a passed validation."
          >
            TIME_SIGNAL {flags.TIME_SIGNAL ? "ON" : "OFF"}
          </span>
          <span className="text-[#5a6a99]">
            {rounds.length} real settled rounds · {ctx.date} {String(ctx.hour).padStart(2, "0")}:{String(ctx.minute).padStart(2, "0")} UTC
          </span>
        </span>
      </div>

      <div className="space-y-4 p-4">
        {/* ===== Required diagnostic tiles ===== */}
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Tile label="Current time window" value={signal.primaryWindow.label} sub={`session block: ${ctx.sessionBlock}`} />
          <Tile label="Sample size" value={String(signal.primaryWindow.sampleSize)} sub={`windows computed: ${windows.length}`} />
          <Tile
            label="Base-rate shift"
            value={signal.diagnostics.baseRateShiftMagnitude.toFixed(3)}
            sub="TVD vs theoretical (0 = identical)"
            color={signal.diagnostics.baseRateShiftMagnitude > 0.08 ? "#ffa502" : "#2ed573"}
          />
          <Tile
            label="Regime status"
            value={signal.regime.status}
            sub={`recent n=${signal.regime.recentWindow.sampleSize} vs prior n=${signal.regime.priorWindow.sampleSize}`}
            color={STATUS_COLOR[signal.regime.status]}
          />
          <Tile
            label="Time-signal confidence"
            value={pct(signal.confidence, 1)}
            sub={signal.active ? "ACTIVE" : "inactive"}
            color={signal.confidence >= 0.5 ? "#2ed573" : "#ffa502"}
          />
          <Tile label="Theoretical base" value="54 sectors" sub="1=38.89% · 2=24.07% · 5=12.96% · 10=7.41%" />
          <Tile label="Observed base" value={signal.primaryWindow.key} sub="observed frequencies below" />
          <Tile
            label="Data integrity"
            value={audit.rounds.passed && audit.timestamps.passed ? "PASS" : "FAIL"}
            sub={`dup ${audit.rounds.duplicates.length} · ts ${audit.timestamps.problems.length}`}
            color={audit.rounds.passed && audit.timestamps.passed ? "#2ed573" : "#ff4757"}
          />
        </div>

        {/* ===== Observed vs theoretical, all 8 outcomes ===== */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              Observed vs theoretical base — {activeWindow.label}
            </span>
            <select
              value={activeWindow.key}
              onChange={(e) => setSelectedWindow(e.target.value)}
              className="rounded border border-[#2a2f52] bg-[#0d1020] px-2 py-1 text-[10px] text-white"
            >
              {windows.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label} (n={w.sampleSize})
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-left text-[#5a6a99]">
                  <th className="py-1 pr-2">Outcome</th>
                  <th className="py-1 pr-2">Observed</th>
                  <th className="py-1 pr-2">Theoretical</th>
                  <th className="py-1 pr-2">Deviation</th>
                  <th className="py-1 pr-2">Uncertainty</th>
                  <th className="py-1 pr-2">Confidence</th>
                  <th className="py-1 pr-2">Momentum</th>
                  <th className="py-1 pr-2">z</th>
                </tr>
              </thead>
              <tbody>
                {activeWindow.outcomes.map((o) => (
                  <tr key={o.outcome} className="border-t border-[#151a33]">
                    <td className="py-1 pr-2 font-bold" style={{ color: OUTCOME_COLORS[o.outcome] }}>
                      {OUTCOME_DISPLAY[o.outcome]}
                    </td>
                    <td className="py-1 pr-2 text-white">{pct(o.observed)}</td>
                    <td className="py-1 pr-2 text-[#8899cc]">{pct(o.theoretical)}</td>
                    <td className="py-1 pr-2" style={{ color: o.deviation >= 0 ? "#2ed573" : "#ff4757" }}>
                      {pp(o.deviation)}
                    </td>
                    <td className="py-1 pr-2 text-[#8899cc]">±{pct(o.uncertainty)}</td>
                    <td className="py-1 pr-2 text-[#8899cc]">{pct(o.confidence, 0)}</td>
                    <td className="py-1 pr-2" style={{ color: o.momentum >= 0 ? "#2ed573" : "#ff4757" }}>
                      {pp(o.momentum)}
                    </td>
                    <td className="py-1 pr-2 text-[#8899cc]">{o.zScore.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-[#5a6a99]">
            <span>
              Bonus frequency: {pct(activeWindow.bonus.bonusRate)} (theory {pct(activeWindow.bonus.theoretical)}, Δ{pp(activeWindow.bonus.deviation)}) · n={activeWindow.sampleSize}
            </span>
            <span>Transitions: {activeWindow.transition.pairCount} pairs · {activeWindow.transition.independenceTest.note}</span>
          </div>
        </div>

        {/* ===== Regime gate ===== */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              Regime evidence gate (a change must clear ALL checks before it can adjust the base)
            </span>
            <span className="text-[10px] font-bold" style={{ color: signal.regime.evidenceGate.passed ? "#ff4757" : "#2ed573" }}>
              {signal.regime.evidenceGate.passed ? "CONFIRMED" : "NOT CONFIRMED"}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {signal.regime.evidenceGate.checks.map((c) => (
              <div key={c.name} className="flex items-start gap-2 text-[10px]">
                <span style={{ color: c.passed ? "#2ed573" : "#ff4757" }}>{c.passed ? "✓" : "✗"}</span>
                <span className="text-[#8899cc]">
                  <b className="text-white">{c.name}</b> — {c.detail}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-[#8899cc]">
            χ²={signal.regime.homogeneity.statistic.toFixed(2)} · df={signal.regime.homogeneity.df} · p={signal.regime.homogeneity.pValue.toFixed(4)} · TVD={signal.regime.shiftMagnitude.toFixed(3)} · persistence {signal.regime.persistence.agreeingBlocks}/{signal.regime.persistence.subBlocks}
          </div>
        </div>

        {/* ===== Dynamic base weights ===== */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              Dynamic base weights (theoretical floor enforced)
            </div>
            {Object.entries(signal.dynamicBase.weights).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-[10px] text-[#8899cc]">
                <span>{k}</span>
                <span className="font-bold text-white">{pct(v, 1)}</span>
              </div>
            ))}
            <div className="mt-2 text-[10px]" style={{ color: signal.dynamicBase.regimeAdjusted ? "#ffa502" : "#2ed573" }}>
              {signal.dynamicBase.regimeAdjusted
                ? "A CONFIRMED regime relaxed the theoretical floor for THIS lock only."
                : "No confirmed regime → theoretical floor active; the 54-sector profile is never rewritten."}
            </div>
            <div className="mt-1 text-[9px] text-[#5a6a99]">
              samples: long-term {signal.dynamicBase.sampleSizes.longTerm} · recent {signal.dynamicBase.sampleSizes.recent} · time window {signal.dynamicBase.sampleSizes.timeWindow} · physics {signal.dynamicBase.sampleSizes.physicsRounds}
            </div>
          </div>
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              Time signal → 8 outcome scores
            </div>
            {OUTCOMES_8.map((o) => (
              <div key={o} className="flex items-center gap-2 text-[10px]">
                <span className="w-20" style={{ color: OUTCOME_COLORS[o] }}>{OUTCOME_DISPLAY[o]}</span>
                <div className="h-1.5 flex-1 rounded bg-[#151a33]">
                  <div
                    className="h-1.5 rounded"
                    style={{ width: `${Math.min(100, (signal.scores[o] ?? 0) * 100 * 2)}%`, background: OUTCOME_COLORS[o] }}
                  />
                </div>
                <span className="w-14 text-right text-[#8899cc]">{pct(signal.scores[o] ?? 0)}</span>
                <span className="w-12 text-right" style={{ color: (signal.multipliers[o] ?? 1) >= 1 ? "#2ed573" : "#ff4757" }}>
                  ×{(signal.multipliers[o] ?? 1).toFixed(2)}
                </span>
              </div>
            ))}
            <div className="mt-2 text-[9px] text-[#5a6a99]">
              Multipliers are capped and shrink toward 1 with sample size — a short window cannot swing an outcome.
            </div>
          </div>
        </div>

        {/* ===== WHY ===== */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
          <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Why the time signal did or did not change the prediction
          </div>
          <ul className="space-y-1 text-[10px] text-[#8899cc]">
            {signal.why.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
            <li>
              • Feature flag: <b className="text-white">TIME_SIGNAL {flags.TIME_SIGNAL ? "ON" : "OFF"}</b>
              {flags.TIME_SIGNAL ? " — its scores reach the ensemble." : " — diagnostics only; the ensemble ignores it (production prediction unchanged)."}
            </li>
          </ul>
        </div>

        {/* ===== Window table ===== */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
          <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
            All windows (rolling + time-of-day)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-left text-[#5a6a99]">
                  <th className="py-1 pr-2">Window</th>
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1 pr-2">n</th>
                  <th className="py-1 pr-2">TVD vs theory</th>
                  <th className="py-1 pr-2">χ² p</th>
                  <th className="py-1 pr-2">Bonus rate</th>
                </tr>
              </thead>
              <tbody>
                {windows.map((w) => (
                  <tr key={w.key} className="border-t border-[#151a33]">
                    <td className="py-1 pr-2 text-white">{w.label}</td>
                    <td className="py-1 pr-2 text-[#8899cc]">{w.kind}</td>
                    <td className="py-1 pr-2 text-[#8899cc]">{w.sampleSize}</td>
                    <td className="py-1 pr-2 text-[#8899cc]">{w.chiSquare.test.effectSize.toFixed(3)}</td>
                    <td className="py-1 pr-2 text-[#8899cc]">{w.chiSquare.test.pValue.toFixed(4)}</td>
                    <td className="py-1 pr-2 text-[#8899cc]">{pct(w.bonus.bonusRate, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-2">
      <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">{label}</div>
      <div className="truncate text-sm font-bold" style={{ color: color ?? "#ffffff" }} title={value}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[9px] text-[#5a6a99]">{sub}</div> : null}
    </div>
  );
}

export default RevoTimeSignalPanel;
