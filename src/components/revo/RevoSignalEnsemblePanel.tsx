"use client";

/**
 * SIGNAL ENSEMBLE PANEL (ADDITIVE — new component)
 * ===============================================
 *
 * Shows the fused view of every channel:
 *
 *   THEORETICAL BASE + HISTORY + TIME + DEALER + PHYSICS + ML/FUSION
 *   → all 8 outcome scores → exactly 4 dynamically selected outcomes
 *
 * …plus the A–J arm labels used by the validation harness, the feature-flag
 * controls (which REFUSE to switch on without a passed validation), and the
 * integrity block (timestamp ordering / physical-stop ordering / no future
 * information / Top-4 count).
 *
 * With every flag OFF the panel shows "PRODUCTION_PASSTHROUGH": the production
 * prediction is returned unchanged.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  getProductionPrediction,
  getSignalStoreVersion,
  getTimedRounds,
  subscribeSignalStore,
} from "./signalDataStore";
import { buildLiveSignalBundle } from "./signalDataStore";
import { SIGNAL_FLAGS_OFF, type SignalFeatureFlags } from "./signalFlags";
import { ARM_LABELS, type AblationArm } from "./signalEnsemble";
import {
  SIGNAL_FLAG_LABELS,
  canPromote,
  forceEnableSignalFlag,
  getSignalFlags,
  getSignalFlagsVersion,
  getValidationLedger,
  setSignalFlag,
  subscribeSignalFlags,
  type SignalFlagName,
} from "./signalFlags";
import { OUTCOME_COLORS, OUTCOME_DISPLAY } from "./signalSectorMap";

function useStoreVersion(): number {
  return useSyncExternalStore(subscribeSignalStore, getSignalStoreVersion, () => 0);
}
function useFlagVersion(): number {
  return useSyncExternalStore(subscribeSignalFlags, getSignalFlagsVersion, () => 0);
}

function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function RevoSignalEnsemblePanel() {
  useStoreVersion();
  useFlagVersion();
  const flags = getSignalFlags();
  const ledger = getValidationLedger();
  const rounds = getTimedRounds();
  const [message, setMessage] = useState<string | null>(null);

  // Build the live bundle from real data only. Production probabilities are
  // not supplied here (the panel is a diagnostic view); the bundle therefore
  // reports exactly which channels have real data at this moment.
  const production = getProductionPrediction();

  // (a) the REAL bundle for this moment — governed by the actual flags, so with
  //     everything OFF it is PRODUCTION_PASSTHROUGH and the production Top-4 is
  //     returned verbatim;
  // (b) a SHADOW bundle computed with every experimental signal forced ON, so
  //     the operator can see what the fused prediction WOULD be. The shadow
  //     bundle is display-only and is never fed into the production decision.
  const bundle = useMemo(
    () =>
      buildLiveSignalBundle({
        lockTimestamp: Date.now(),
        historyProbabilities: production?.probabilities ?? null,
        historyTop4: production?.top4 ?? null,
        recordPrediction: false,
      }),
    [rounds.length, rounds[rounds.length - 1]?.settledAt, production?.publishedAt, flags.TIME_SIGNAL, flags.DEALER_SIGNAL, flags.PHYSICS_SIGNAL, flags.FUSION],
  );

  const shadowFlags: SignalFeatureFlags = useMemo(
    () => ({ ...SIGNAL_FLAGS_OFF, TIME_SIGNAL: true, DEALER_SIGNAL: true, PHYSICS_SIGNAL: true, FUSION: true }),
    [],
  );
  const shadow = useMemo(
    () =>
      buildLiveSignalBundle({
        lockTimestamp: Date.now(),
        historyProbabilities: production?.probabilities ?? null,
        historyTop4: production?.top4 ?? null,
        flagsOverride: shadowFlags,
        recordPrediction: false,
      }),
    [rounds.length, rounds[rounds.length - 1]?.settledAt, production?.publishedAt, shadowFlags],
  );

  const ensemble = bundle.ensemble;
  // What the experimental ensemble would output right now (shadow), vs what is
  // actually in force (live bundle).
  const previewEnsemble = ensemble.passthrough ? shadow.ensemble : ensemble;
  const sortedOutcomes = useMemo(
    () => Object.entries(previewEnsemble.all8Scores).sort((a, b) => b[1] - a[1]),
    [previewEnsemble.all8Scores],
  );

  const toggle = (flag: SignalFlagName) => {
    const current = flags[flag];
    if (current) {
      const res = setSignalFlag(flag, false);
      setMessage(res.reason);
      return;
    }
    const res = setSignalFlag(flag, true);
    if (!res.ok) {
      const gate = canPromote(flag);
      setMessage(`${res.reason}\nGate: ${gate.reasons.join("; ")}`);
    } else {
      setMessage(res.reason);
    }
  };

  return (
    <div className="revo-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1e2240] bg-gradient-to-r from-[#2ed573]/10 to-transparent px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-layer-group text-[#2ed573]" /> Signal ensemble (experimental)
        </span>
        <span className="text-[10px] text-[#5a6a99]">
          live mode: <b style={{ color: ensemble.passthrough ? "#2ed573" : "#ffa502" }}>{ensemble.mode}</b> · shadow mode: <b className="text-[#ffa502]">{shadow.ensemble.mode}</b> · {bundle.why.length} explanation lines
        </span>
      </div>

      <div className="space-y-4 p-4">
        {/* ===== Feature flags + gate ===== */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
          <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Feature flags (default OFF — enabling requires a passed out-of-sample validation)
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(SIGNAL_FLAG_LABELS) as SignalFlagName[]).map((flag) => {
              const gate = canPromote(flag);
              const outcome = ledger[flag];
              return (
                <div key={flag} className="rounded border border-[#1e2240] p-2">
                  <div className="text-[10px] font-bold text-white">{SIGNAL_FLAG_LABELS[flag]}</div>
                  <div className="mt-1 text-[9px]" style={{ color: flags[flag] ? "#2ed573" : "#5a6a99" }}>
                    {flag}: {flags[flag] ? "ON" : "OFF"}
                  </div>
                  <div className="mt-1 text-[9px]" style={{ color: gate.allowed ? "#2ed573" : "#ffa502" }} title={gate.reasons.join("; ")}>
                    {gate.allowed ? "gate PASSED" : `gate blocked${outcome && !outcome.passed && outcome.reason.includes("FORCED") ? " (forced)" : ""}`}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <button
                      onClick={() => toggle(flag)}
                      className="rounded border border-[#2a2f52] px-2 py-0.5 text-[9px] text-white hover:bg-[#151a33]"
                    >
                      {flags[flag] ? "disable" : "enable"}
                    </button>
                    <button
                      onClick={() => {
                        forceEnableSignalFlag(flag);
                        setMessage(`${flag} FORCED ON (debug only — recorded as NOT validated).`);
                      }}
                      className="rounded border border-[#5a6a99]/40 px-2 py-0.5 text-[9px] text-[#5a6a99] hover:bg-[#151a33]"
                      title="Debug only: enables the layer for local inspection and records an explicit NOT-validated override."
                    >
                      force
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {message ? <div className="mt-2 whitespace-pre-wrap text-[9px] text-[#ffa502]">{message}</div> : null}
          <div className="mt-2 text-[9px] text-[#5a6a99]">
            Diagnostics and data collection always run, even with every flag OFF — the flags only control whether a signal
            is allowed to influence the fused Top-4.
          </div>
        </div>

        {/* ===== Channel table ===== */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
          <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Channels (weight 0 unless enabled AND has real data AND confidence ≥ 5%)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-left text-[#5a6a99]">
                  <th className="py-1 pr-2">Channel</th>
                  <th className="py-1 pr-2">Enabled</th>
                  <th className="py-1 pr-2">Data</th>
                  <th className="py-1 pr-2">Confidence</th>
                  <th className="py-1 pr-2">Weight</th>
                  <th className="py-1 pr-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {ensemble.channels.map((c) => (
                  <tr key={c.key} className="border-t border-[#151a33]">
                    <td className="py-1 pr-2 text-white">{c.label}</td>
                    <td className="py-1 pr-2" style={{ color: c.enabled ? "#2ed573" : "#5a6a99" }}>{c.enabled ? "on" : "off"}</td>
                    <td className="py-1 pr-2" style={{ color: c.available ? "#2ed573" : "#ff4757" }}>{c.available ? "real" : "none"}</td>
                    <td className="py-1 pr-2 text-[#8899cc]">{pct(c.confidence, 0)}</td>
                    <td className="py-1 pr-2 text-white">{pct(ensemble.weights[c.key], 1)}</td>
                    <td className="py-1 pr-2 text-[#5a6a99]">{c.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ===== Fused Top-4 + all 8 ===== */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
                Fused Top-4 — exactly 4, selected dynamically (no hardcoded composition, no forced bonus)
              </span>
              <span
                className="rounded px-2 py-0.5 text-[9px] font-bold"
                style={{
                  color: ensemble.passthrough ? "#2ed573" : "#ffa502",
                  border: `1px solid ${ensemble.passthrough ? "#2ed57355" : "#ffa50255"}`,
                }}
                title={ensemble.passthrough ? "The live bundle returns the production Top-4 unchanged." : "Consequently the live bundle is already fused."}
              >
                {ensemble.passthrough ? "LIVE: production output (experimental signals are shadow-only)" : "LIVE: fused output"}
              </span>
            </div>
            {previewEnsemble.top4.length === 0 ? (
              <div className="text-[11px] text-[#5a6a99]">No prediction yet — waiting for real rounds.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {previewEnsemble.top4.map((o, i) => (
                  <span key={o} className="rounded px-2 py-1 text-[11px] font-bold" style={{ background: `${OUTCOME_COLORS[o]}22`, color: OUTCOME_COLORS[o], border: `1px solid ${OUTCOME_COLORS[o]}55` }}>
                    #{i + 1} {OUTCOME_DISPLAY[o]} · {pct(previewEnsemble.all8Scores[o] ?? 0)}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 text-[9px] text-[#5a6a99]">
              {ensemble.passthrough
                ? "PRODUCTION_PASSTHROUGH is in force: no experimental signal is enabled, so the production Top-4 is returned unchanged and the tiles above show the SHADOW (worst-case preview) output only."
                : `Fused confidence (weakest selected outcome): ${pct(ensemble.confidence)}`}
            </div>
          </div>

          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">All 8 outcomes (always eligible)</div>
            {sortedOutcomes.map(([o, v]) => (
              <div key={o} className="flex items-center gap-2 text-[10px]">
                <span className="w-20" style={{ color: OUTCOME_COLORS[o] }}>{OUTCOME_DISPLAY[o]}</span>
                <div className="h-1.5 flex-1 rounded bg-[#151a33]">
                  <div className="h-1.5 rounded" style={{ width: `${Math.min(100, v * 100 * 2)}%`, background: OUTCOME_COLORS[o] }} />
                </div>
                <span className="w-14 text-right text-[#8899cc]">{pct(v)}</span>
                {previewEnsemble.top4.includes(o) ? <span className="w-10 text-right text-[9px] text-[#2ed573]">in Top-4</span> : <span className="w-10 text-right text-[9px] text-[#5a6a99]">—</span>}
              </div>
            ))}
          </div>
        </div>

        {/* ===== Integrity ===== */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
          <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">Integrity (data contract)</div>
          <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-5">
            <Check label="latestUsed ≤ lock" ok={ensemble.integrity.orderingOk} value={ensemble.integrity.latestUsedTimestamp === null ? "no data used" : new Date(ensemble.integrity.latestUsedTimestamp).toISOString().slice(11, 19)} />
            <Check label="lock < physical stop" ok={ensemble.integrity.lockBeforeStop === null ? true : ensemble.integrity.lockBeforeStop} value={ensemble.integrity.lockBeforeStop === null ? "no spin in progress" : String(ensemble.integrity.lockBeforeStop)} />
            <Check label="no future info" ok={ensemble.integrity.noFutureInformation} value={String(ensemble.integrity.noFutureInformation)} />
            <Check label="exactly 4 outcomes" ok={ensemble.integrity.top4Count === 4} value={String(ensemble.integrity.top4Count)} />
            <Check label="unique Top-4" ok={ensemble.integrity.uniqueTop4} value={String(ensemble.integrity.uniqueTop4)} />
          </div>
        </div>

        {/* ===== A–J arms ===== */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
          <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Validation arms for this lock (A–J; unavailable arms are never fabricated)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-left text-[#5a6a99]">
                  <th className="py-1 pr-2">Arm</th>
                  <th className="py-1 pr-2">Top-4</th>
                  <th className="py-1 pr-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(ARM_LABELS) as AblationArm[]).map((arm) => {
                  const a = bundle.arms[arm];
                  return (
                    <tr key={arm} className="border-t border-[#151a33]">
                      <td className="py-1 pr-2 text-white">{ARM_LABELS[arm]}</td>
                      <td className="py-1 pr-2 text-[#8899cc]">{a.top4.length > 0 ? a.top4.join(", ") : "—"}</td>
                      <td className="py-1 pr-2" style={{ color: a.available ? "#2ed573" : "#5a6a99" }}>{a.available ? "evaluated" : a.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[9px] text-[#5a6a99]">
            Full walk-forward A–J results on real settled rounds: run <code>node --import ./scripts/ts-resolve-register.mjs scripts/validate_signal_layers.ts</code> →
            {" "}reports in <code>scripts/data/signal_validation_report.json</code> and <code>SIGNAL_LAYERS_VALIDATION.md</code>.
          </div>
        </div>

        {/* ===== WHY ===== */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
          <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">Why this Top-4 (every channel's contribution)</div>
          <ul className="space-y-1 text-[10px] text-[#8899cc]">
            {ensemble.why.slice(0, 14).map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Check({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="rounded border border-[#1e2240] p-2">
      <div className="text-[9px] text-[#5a6a99]">{label}</div>
      <div className="font-bold" style={{ color: ok ? "#2ed573" : "#ff4757" }}>{ok ? "PASS" : "FAIL"}</div>
      <div className="text-[9px] text-[#5a6a99]">{value}</div>
    </div>
  );
}

export default RevoSignalEnsemblePanel;
