"use client";

/**
 * WHEEL PHYSICS / MOTION DEBUG PANEL (ADDITIVE — new component)
 * ============================================================
 *
 * Real-time surface required by the physics layer:
 *
 *   DIRECTION · DIRECTION CONFIDENCE · SPEED °/s · ACCELERATION ·
 *   DECELERATION · CURRENT ANGLE · PREDICTED STOP ANGLE · TIME TO STOP ·
 *   VIBRATION · TRACKING CONFIDENCE · PHYSICS STATE · PREDICTED SECTOR ·
 *   PHYSICS TOP-4
 *
 * …plus, after each completed spin, the comparison block:
 *
 *   PHYSICS PREDICTION · ACTUAL RESULT · HIT/MISS · ANGLE ERROR ·
 *   SECTOR ERROR · DIRECTION · SPEED PROFILE · DECELERATION PROFILE
 *
 * All values come from the live video telemetry; nothing is invented, and the
 * panel shows UNAVAILABLE instead of a fake number when tracking is missing.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getVideoPhysics, subscribeVideoPhysics } from "./RevoVideoSensor";
import {
  computePhysicsEvidence,
  learnDeceleration,
  type PhysicsEvidence,
} from "./wheelPhysicsLayer";
import {
  getDecelerationObservations,
  getMotionFrames,
  getSignalStoreVersion,
  getTimedRounds,
  subscribeSignalStore,
} from "./signalDataStore";
import { getDossiers, subscribeLedger, getLedgerVersion, summarizeDossiers } from "./physicsDossier";
import { OUTCOME_COLORS, OUTCOME_DISPLAY } from "./signalSectorMap";
import { getSignalFlags } from "./signalFlags";
import { SignalPanelPlaceholder, useMounted } from "./SignalPanelFrame";

function useSensorTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeVideoPhysics(() => setTick((t) => t + 1)), []);
  return tick;
}

function useStoreVersion(): number {
  return useSyncExternalStore(subscribeSignalStore, getSignalStoreVersion, () => 0);
}

function useLedgerVersion(): number {
  return useSyncExternalStore(subscribeLedger, getLedgerVersion, () => 0);
}

function Row({ label, value, color, title }: { label: string; value: string; color?: string; title?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-[#0d1020] px-2 py-1">
      <span className="text-[9px] uppercase tracking-wider text-[#5a6a99]">{label}</span>
      <span className="truncate font-bold" style={{ color: color ?? "#fff" }} title={title ?? value}>
        {value}
      </span>
    </div>
  );
}

const STATE_COLOR: Record<string, string> = {
  IDLE: "#5a6a99",
  SPINNING: "#00d4ff",
  FAST: "#2ed573",
  DECELERATING: "#ffa502",
  SLOW: "#ffa502",
  NEAR_STOP: "#ff6b9d",
  STOPPED: "#ff4757",
};

export function RevoPhysicsMotionPanel() {
  useSensorTick();
  useStoreVersion();
  useLedgerVersion();
  const flags = getSignalFlags();
  const mounted = useMounted();

  const evidence: PhysicsEvidence = useMemo(() => {
    const frames = getMotionFrames();
    const learned = learnDeceleration(getDecelerationObservations(), Date.now());
    return computePhysicsEvidence(frames, { learnedDeceleration: learned, windowMs: 4000 });
  }, [getMotionFrames().length, getVideoPhysics()?.timestamp]);

  const sensor = getVideoPhysics();
  const d = evidence.diagnostics;
  const summary = useMemo(() => summarizeDossiers(), [getDossiers().length]);
  const dossiers = getDossiers().slice(-5).reverse();
  const rounds = getTimedRounds();

  // Physics-only Top-4 (all-zero evidence → no Top-4, explicitly).
  const physicsTop4 = useMemo(() => {
    if (!evidence.evidence) return [];
    return Object.entries(evidence.outcomeProbabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k]) => k);
  }, [evidence]);

  const speedProfile = evidence.speed.profile.slice(-60);
  const maxSpeed = Math.max(1, ...speedProfile.map((p) => Math.abs(p.velocity)));

  // SSR/hydration guard (repo convention, see RevoGame.tsx): every value below
  // comes from browser-only state (signal store, video telemetry, flags). The
  // pre-mount render is a stable data-free shell so the server output and the
  // first client render match — no hydration mismatch in the production build.
  if (!mounted) {
    return <SignalPanelPlaceholder icon="fa-gauge-high" title="Wheel physics · motion signal" note="Waiting for live video telemetry before computing direction, speed and stop-angle evidence…" />;
  }

  return (
    <div className="revo-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1e2240] bg-gradient-to-r from-[#00d4ff]/10 to-transparent px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-gauge-high text-[#00d4ff]" /> Wheel physics · motion signal
        </span>
        <span className="flex items-center gap-2 text-[10px]">
          <span
            className="rounded px-2 py-0.5 font-bold"
            style={{ color: flags.PHYSICS_SIGNAL ? "#2ed573" : "#5a6a99", border: `1px solid ${flags.PHYSICS_SIGNAL ? "#2ed57355" : "#2a2f52"}` }}
            title="Physics evidence influences the ensemble ONLY when enabled by a passed validation."
          >
            PHYSICS_SIGNAL {flags.PHYSICS_SIGNAL ? "ON" : "OFF"}
          </span>
          <span className="text-[#5a6a99]">{getMotionFrames().length} frames buffered</span>
        </span>
      </div>

      <div className="space-y-4 p-4">
        {/* ===== Live debug tiles ===== */}
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-4">
          <Row label="Direction" value={d.direction} color={d.direction === "RIGHT" ? "#2ed573" : d.direction === "LEFT" ? "#448AFF" : "#5a6a99"} />
          <Row label="Direction confidence" value={`${(d.directionConfidence * 100).toFixed(0)}%`} />
          <Row label="Direction stability" value={`${(d.directionStability * 100).toFixed(0)}%`} title={`${d.directionChanges} direction change(s) detected`} />
          <Row label="Physics state" value={d.motionState} color={STATE_COLOR[d.motionState]} />
          <Row label="Speed" value={`${d.speedDegPerSec.toFixed(1)} °/s`} />
          <Row label="Avg / peak speed" value={`${d.averageSpeed.toFixed(1)} / ${d.peakSpeed.toFixed(1)} °/s`} />
          <Row label="Acceleration" value={`${d.acceleration.toFixed(1)} °/s²`} />
          <Row label="Deceleration" value={`${d.deceleration.toFixed(1)} °/s²`} />
          <Row label="Velocity trend" value={`${d.velocityTrend >= 0 ? "+" : ""}${d.velocityTrend.toFixed(1)} °/s²`} />
          <Row label="Time to stop" value={d.timeToStop === null ? "UNAVAILABLE" : `${d.timeToStop.toFixed(1)} s`} color={d.timeToStop === null ? "#5a6a99" : "#fff"} />
          <Row label="Current angle" value={`${d.currentAngle.toFixed(1)}°`} />
          <Row label="Predicted stop angle" value={d.predictedStopAngle === null ? "UNAVAILABLE" : `${d.predictedStopAngle.toFixed(1)}° ±${(d.stopAngleUncertaintyDeg ?? 0).toFixed(1)}°`} />
          <Row label="Vibration" value={`${(d.vibration * 100).toFixed(0)}%`} color={d.vibration > 0.5 ? "#ffa502" : "#2ed573"} />
          <Row label="Tracking confidence" value={`${(d.trackingConfidence * 100).toFixed(0)}%`} />
          <Row label="Phase correlation" value={`${(d.phaseCorrelationStrength * 100).toFixed(0)}%`} />
          <Row label="Optical flow strength" value={d.opticalFlowStrength.toFixed(2)} />
          <Row label="Abnormal frames" value={String(d.abnormalFrames)} color={d.abnormalFrames > 0 ? "#ffa502" : "#2ed573"} />
          <Row label="Predicted sector" value={d.predictedSector === null ? "UNAVAILABLE" : `${d.predictedSector} → ${d.predictedOutcome}`} />
        </div>

        {/* ===== Sensor raw ===== */}
        <div className="text-[9px] text-[#5a6a99]">
          Sensor: angleWrapped={sensor ? sensor.angleWrapped.toFixed(1) : "—"}° ·
          velocityRaw={sensor ? sensor.velocityRaw.toFixed(1) : "—"} °/s ·
          confidence={sensor ? (sensor.confidence * 100).toFixed(0) : "—"}% ·
          sector={sensor?.sectorEstimate ?? "—"} · tracking={sensor ? String(sensor.isTracking) : "—"} ·
          analysis window {d.sampleSize} frames / {d.windowMs} ms
        </div>

        {/* ===== Physics Top-4 + evidence vector ===== */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">Physics Top-4 (evidence only)</div>
            {physicsTop4.length === 0 ? (
              <div className="text-[11px] text-[#5a6a99]">
                NO PHYSICS PREDICTION — {evidence.reason}. The layer never falls back to theoretical numbers.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {physicsTop4.map((o) => (
                  <span key={o} className="rounded px-2 py-1 text-[11px] font-bold" style={{ background: `${OUTCOME_COLORS[o]}22`, color: OUTCOME_COLORS[o], border: `1px solid ${OUTCOME_COLORS[o]}55` }}>
                    {OUTCOME_DISPLAY[o]} · {((evidence.outcomeProbabilities[o] ?? 0) * 100).toFixed(1)}%
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 text-[9px] text-[#5a6a99]">
              Physics confidence {(evidence.physicsConfidence * 100).toFixed(0)}% · sector σ {d.stopAngleUncertaintyDeg === null ? "—" : `${d.stopAngleUncertaintyDeg.toFixed(1)}°`}
            </div>
          </div>

          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">Physics-only outcome evidence (all 8, never forced)</div>
            {Object.keys(evidence.outcomeProbabilities).map((o) => (
              <div key={o} className="flex items-center gap-2 text-[10px]">
                <span className="w-20" style={{ color: OUTCOME_COLORS[o] }}>{OUTCOME_DISPLAY[o]}</span>
                <div className="h-1.5 flex-1 rounded bg-[#151a33]">
                  <div className="h-1.5 rounded" style={{ width: `${(evidence.outcomeProbabilities[o] ?? 0) * 100}%`, background: OUTCOME_COLORS[o] }} />
                </div>
                <span className="w-12 text-right text-[#8899cc]">{((evidence.outcomeProbabilities[o] ?? 0) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* ===== Speed / deceleration profile ===== */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
          <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">Speed profile (last {speedProfile.length} frames)</div>
          {speedProfile.length === 0 ? (
            <div className="text-[10px] text-[#5a6a99]">No telemetry yet.</div>
          ) : (
            <div className="flex h-16 items-end gap-[1px]">
              {speedProfile.map((p, i) => (
                <div
                  key={i}
                  title={`${Math.abs(p.velocity).toFixed(0)} °/s · a=${p.acceleration.toFixed(0)} °/s²`}
                  className="flex-1 rounded-t"
                  style={{
                    height: `${Math.max(2, (Math.abs(p.velocity) / maxSpeed) * 100)}%`,
                    background: p.acceleration < 0 ? "#ffa502" : "#00d4ff",
                  }}
                />
              ))}
            </div>
          )}
          <div className="mt-1 flex gap-4 text-[9px] text-[#5a6a99]">
            <span><span className="text-[#00d4ff]">■</span> accelerating</span>
            <span><span className="text-[#ffa502]">■</span> decelerating</span>
            <span>learned deceleration: {JSON.stringify(learnDeceleration(getDecelerationObservations(), Date.now()))} °/s² (from {getDecelerationObservations().length} completed spins)</span>
          </div>
        </div>

        {/* ===== Post-spin comparisons ===== */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              Spin-by-spin: physics prediction vs actual
            </span>
            <span className="text-[9px] text-[#5a6a99]">
              settled dossiers: {summary.n} · hit rate {summary.n === 0 ? "—" : `${(summary.hitRate * 100).toFixed(1)}%`} (95% CI {summary.n === 0 ? "—" : `${(summary.ci95.low * 100).toFixed(1)}–${(summary.ci95.high * 100).toFixed(1)}%`}) · mean sector error {summary.meanSectorError === null ? "—" : summary.meanSectorError.toFixed(2)} · mean angle error {summary.meanStopAngleErrorDeg === null ? "—" : `${summary.meanStopAngleErrorDeg.toFixed(1)}°`}
            </span>
          </div>
          {dossiers.length === 0 ? (
            <div className="text-[10px] text-[#5a6a99]">
              No physics dossiers yet. A dossier is written for every spin the experiment touches (real data only).
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-left text-[#5a6a99]">
                    <th className="py-1 pr-2">Spin</th>
                    <th className="py-1 pr-2">Physics Top-4</th>
                    <th className="py-1 pr-2">Actual</th>
                    <th className="py-1 pr-2">HIT/MISS</th>
                    <th className="py-1 pr-2">Direction</th>
                    <th className="py-1 pr-2">Sector err</th>
                    <th className="py-1 pr-2">Angle err</th>
                    <th className="py-1 pr-2">Velocity @lock</th>
                    <th className="py-1 pr-2">Deceleration</th>
                    <th className="py-1 pr-2">Leakage-safe</th>
                  </tr>
                </thead>
                <tbody>
                  {dossiers.map((dos) => (
                    <tr key={dos.spinId} className="border-t border-[#151a33]">
                      <td className="py-1 pr-2 text-[#8899cc]">{dos.spinId.slice(0, 14)}</td>
                      <td className="py-1 pr-2 text-white">{dos.predictionTop4.join(", ") || "—"}</td>
                      <td className="py-1 pr-2" style={{ color: dos.actualResult ? OUTCOME_COLORS[dos.actualResult] : "#5a6a99" }}>
                        {dos.actualResult ?? "pending"}
                      </td>
                      <td className="py-1 pr-2" style={{ color: dos.hit === null ? "#5a6a99" : dos.hit ? "#2ed573" : "#ff4757" }}>
                        {dos.hit === null ? "—" : dos.hit ? "HIT" : "MISS"}
                      </td>
                      <td className="py-1 pr-2 text-[#8899cc]">{dos.direction}</td>
                      <td className="py-1 pr-2 text-[#8899cc]">{dos.sectorError ?? "—"}</td>
                      <td className="py-1 pr-2 text-[#8899cc]">{dos.stopAngleError === null ? "—" : `${dos.stopAngleError.toFixed(1)}°`}</td>
                      <td className="py-1 pr-2 text-[#8899cc]">{dos.velocityAtLock.toFixed(0)} °/s</td>
                      <td className="py-1 pr-2 text-[#8899cc]">{dos.deceleration.toFixed(1)} °/s²</td>
                      <td className="py-1 pr-2" style={{ color: dos.leakageSafe ? "#2ed573" : "#ff4757" }}>
                        {dos.leakageSafe ? "yes" : "NO"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 text-[9px] text-[#5a6a99]">
            Latest settled rounds: {rounds.slice(-3).map((r) => `${r.outcome}@${new Date(r.settledAt).toISOString().slice(11, 19)}`).join(" · ") || "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RevoPhysicsMotionPanel;
