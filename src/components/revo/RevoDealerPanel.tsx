"use client";

/**
 * DEALER ANALYSIS PANEL (ADDITIVE — new component)
 * ================================================
 *
 * Required surface:
 *   CURRENT DEALER · DEALER ID/NAME · CONFIDENCE OF IDENTIFICATION ·
 *   ROUNDS WITH DEALER · DEALER HIT RATE · DEALER DISTRIBUTION ·
 *   BASELINE DISTRIBUTION · DEALER vs BASELINE · STATISTICAL CONFIDENCE ·
 *   DEALER SIGNAL: ACTIVE / INSUFFICIENT / NON-SIGNIFICANT
 *
 * …plus the chain: CURRENT DEALER → PHYSICAL WHEEL → TIME WINDOW → FINAL TOP-4.
 *
 * Identity safety: only the public-UI name (when the game shows one), a
 * self-minted dealer id and a coarse non-reversible appearance descriptor are
 * ever displayed or stored.
 */

import { useMemo, useSyncExternalStore } from "react";
import {
  getDealerProfiles,
  getDealerVersion,
  subscribeDealers,
  dealerFullStats,
  compareDealerToBaseline,
  detectDealerRegime,
  type DealerProfile,
} from "./dealerSignal";
import {
  getSignalStoreVersion,
  getTimedRounds,
  subscribeSignalStore,
} from "./signalDataStore";
import { OUTCOMES_8 } from "./timeSignal";
import { OUTCOME_COLORS, OUTCOME_DISPLAY } from "./signalSectorMap";
import { getSignalFlags } from "./signalFlags";
import { getVideoPhysics } from "./RevoVideoSensor";

function useDealerVersion(): number {
  return useSyncExternalStore(subscribeDealers, getDealerVersion, () => 0);
}
function useStoreVersion(): number {
  return useSyncExternalStore(subscribeSignalStore, getSignalStoreVersion, () => 0);
}

function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  ACTIVE: { color: "#2ed573", label: "ACTIVE" },
  INSUFFICIENT: { color: "#5a6a99", label: "INSUFFICIENT" },
  "NON-SIGNIFICANT": { color: "#ffa502", label: "NON-SIGNIFICANT" },
};

export function RevoDealerPanel() {
  useDealerVersion();
  useStoreVersion();
  const flags = getSignalFlags();
  const rounds = getTimedRounds();
  const profiles = getDealerProfiles();
  const active: DealerProfile | null = profiles.length > 0 ? profiles[profiles.length - 1] : null;

  const stats = useMemo(() => (active ? dealerFullStats(active.dealerId) : null), [active?.dealerId, active?.rounds.length]);
  const regime = useMemo(
    () => (active ? detectDealerRegime(active, rounds, Date.now()) : null),
    [active?.dealerId, active?.rounds.length, rounds.length],
  );
  const comparison = useMemo(
    () => (active ? compareDealerToBaseline(active, rounds, Date.now()) : null),
    [active?.dealerId, active?.rounds.length, rounds.length],
  );

  const baselineCounts = useMemo(() => {
    const c: Record<string, number> = Object.fromEntries(OUTCOMES_8.map((o) => [o, 0]));
    for (const r of rounds) if (c[r.outcome] !== undefined) c[r.outcome]++;
    return c;
  }, [rounds.length]);
  const baselineN = rounds.length;

  const status = !active
    ? "INSUFFICIENT"
    : (stats?.totalRounds ?? 0) < 40
      ? "INSUFFICIENT"
      : regime?.gate.passed
        ? "ACTIVE"
        : "NON-SIGNIFICANT";
  const statusStyle = STATUS_STYLE[status];

  const wheel = active?.wheel;
  const sensor = getVideoPhysics();

  return (
    <div className="revo-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1e2240] bg-gradient-to-r from-[#FFD700]/10 to-transparent px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-user-tie text-[#FFD700]" /> Dealer / agent analysis
        </span>
        <span className="flex items-center gap-2 text-[10px]">
          <span
            className="rounded px-2 py-0.5 font-bold"
            style={{ color: flags.DEALER_SIGNAL ? "#2ed573" : "#5a6a99", border: `1px solid ${flags.DEALER_SIGNAL ? "#2ed57355" : "#2a2f52"}` }}
            title="Dealer statistics affect the prediction ONLY when enabled by a passed validation."
          >
            DEALER_SIGNAL {flags.DEALER_SIGNAL ? "ON" : "OFF"}
          </span>
          <span className="text-[#5a6a99]">{profiles.length} profile(s)</span>
        </span>
      </div>

      <div className="space-y-4 p-4">
        {!active ? (
          <div className="text-[11px] text-[#5a6a99]">
            No dealer profile yet. A profile is created only from real observations of the live table
            (public-UI name and/or a coarse appearance descriptor captured before the prediction lock).
            No dealer data is ever invented.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Tile label="Current dealer" value={active.name ?? "(unnamed — UI did not show a name)"} sub={active.dealerId} />
              <Tile label="Identification confidence" value={pct(active.identification.meanConfidence, 0)} sub={`${active.identification.observations} observation(s) · ${active.identification.appearances} appearance`} />
              <Tile label="Rounds with dealer" value={String(stats?.totalRounds ?? 0)} sub={`sessions: ${active.sessions.length}`} />
              <Tile
                label="Dealer hit rate"
                value={
                  stats && stats.totalRounds > 0 && active.identification.observations > 0
                    ? "—"
                    : "n/a"
                }
                sub="needs live-locked predictions per dealer round"
              />
              <Tile label="Dealer signal" value={statusStyle.label} sub={regime?.notes[0] ?? "no regime computed"} color={statusStyle.color} />
              <Tile label="Statistical confidence" value={regime ? pct(Math.min(1, regime.tvd / 0.2) * (regime.gate.passed ? 1 : 0), 0) : "0%"} sub={`TVD ${regime?.tvd.toFixed(3) ?? "—"} · p=${regime?.test.pValue.toFixed(4) ?? "—"}`} />
              <Tile label="Wheel direction (dealer)" value={wheel && wheel.roundsWithPhysics > 0 ? `L:${wheel.directionCounts.LEFT} R:${wheel.directionCounts.RIGHT}` : "no video data"} sub={wheel?.avgSpeedDegPerSec === null || wheel === undefined ? "—" : `avg ${wheel.avgSpeedDegPerSec?.toFixed(0)} °/s · decel ${wheel.avgDecelerationDegPerSec2?.toFixed(1)} °/s²`} />
              <Tile label="Table / game" value={active.tableId ?? "not exposed by the UI"} sub={`first seen ${new Date(active.firstSeen).toISOString().slice(0, 19)}Z`} />
            </div>

            {/* Distribution comparison */}
            <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
                Dealer distribution vs wheel baseline (all 8 outcomes)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-left text-[#5a6a99]">
                      <th className="py-1 pr-2">Outcome</th>
                      <th className="py-1 pr-2">Dealer</th>
                      <th className="py-1 pr-2">Baseline</th>
                      <th className="py-1 pr-2">Δ</th>
                      <th className="py-1 pr-2">z</th>
                      <th className="py-1 pr-2">p (FDR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OUTCOMES_8.map((o, idx) => {
                      const dealerRate = regime?.perOutcomeShift[idx]?.dealerRate ?? 0;
                      const baseRate = regime?.perOutcomeShift[idx]?.baselineRate ?? (baselineN > 0 ? baselineCounts[o] / baselineN : 0);
                      const shift = regime?.perOutcomeShift[idx];
                      return (
                        <tr key={o} className="border-t border-[#151a33]">
                          <td className="py-1 pr-2 font-bold" style={{ color: OUTCOME_COLORS[o] }}>{OUTCOME_DISPLAY[o]}</td>
                          <td className="py-1 pr-2 text-white">{stats && stats.totalRounds > 0 ? pct(dealerRate) : "—"}</td>
                          <td className="py-1 pr-2 text-[#8899cc]">{pct(baseRate)}</td>
                          <td className="py-1 pr-2" style={{ color: (shift?.delta ?? 0) >= 0 ? "#2ed573" : "#ff4757" }}>
                            {shift ? `${shift.delta >= 0 ? "+" : ""}${(shift.delta * 100).toFixed(2)} pp` : "—"}
                          </td>
                          <td className="py-1 pr-2 text-[#8899cc]">{shift?.zScore.toFixed(2) ?? "—"}</td>
                          <td className="py-1 pr-2 text-[#8899cc]">{shift?.pValue.toFixed(4) ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-[10px] text-[#5a6a99]">
                {regime?.test.note} · sample: dealer n={regime?.dealerSampleSize ?? 0}, baseline n={regime?.baselineSampleSize ?? 0}
              </div>
            </div>

            {/* A/B/C/D/E comparisons */}
            <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
                A/B/C/D/E comparisons (A = this dealer · B = before · C = after · D = other dealers · E = overall)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-left text-[#5a6a99]">
                      <th className="py-1 pr-2">Set</th>
                      <th className="py-1 pr-2">n</th>
                      <th className="py-1 pr-2">TVD vs A</th>
                      <th className="py-1 pr-2">χ² p vs A</th>
                      <th className="py-1 pr-2">Conclusive</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(comparison?.comparisons ?? []).map((c) => (
                      <tr key={c.key} className="border-t border-[#151a33]">
                        <td className="py-1 pr-2 text-white">{c.key} — {c.label}</td>
                        <td className="py-1 pr-2 text-[#8899cc]">{c.sampleSize}</td>
                        <td className="py-1 pr-2 text-[#8899cc]">{c.tvdVsA.toFixed(3)}</td>
                        <td className="py-1 pr-2 text-[#8899cc]">{c.testVsA.pValue.toFixed(4)}</td>
                        <td className="py-1 pr-2" style={{ color: c.testVsA.conclusive ? "#2ed573" : "#5a6a99" }}>{c.testVsA.conclusive ? "yes" : "no (n too small)"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-[9px] text-[#5a6a99]">{comparison?.notes[0]}</div>
            </div>

            {/* Chain: dealer → wheel → time window → final Top-4 */}
            <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
                CURRENT DEALER → PHYSICAL WHEEL → TIME WINDOW → FINAL TOP-4
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-[#8899cc]">
                <span className="rounded px-2 py-1" style={{ background: "#FFD70022", color: "#FFD700" }}>
                  {active.name ?? active.dealerId}
                </span>
                <span>→</span>
                <span className="rounded px-2 py-1" style={{ background: "#00d4ff22", color: "#00d4ff" }}>
                  {sensor ? `${sensor.direction > 0 ? "CW" : "CCW"} · ${Math.abs(sensor.velocityRaw).toFixed(0)} °/s · sector ${sensor.sectorEstimate ?? "—"}` : "video offline"}
                </span>
                <span>→</span>
                <span className="rounded px-2 py-1" style={{ background: "#a78bfa22", color: "#a78bfa" }}>
                  {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC
                </span>
                <span>→</span>
                <span className="rounded px-2 py-1 text-[#5a6a99]" style={{ background: "#5a6a9922" }}>
                  final Top-4 shown in the ensemble panel (see below)
                </span>
              </div>
              <div className="mt-2 text-[9px] text-[#5a6a99]">
                The chain is DISPLAY-ONLY: the dealer signal only reaches the ensemble when its flag is ON and its gate passed.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-2">
      <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">{label}</div>
      <div className="truncate text-sm font-bold" style={{ color: color ?? "#fff" }} title={value}>{value}</div>
      {sub ? <div className="mt-0.5 truncate text-[9px] text-[#5a6a99]" title={sub}>{sub}</div> : null}
    </div>
  );
}

export default RevoDealerPanel;
