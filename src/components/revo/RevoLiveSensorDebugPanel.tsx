"use client";

/**
 * LIVE SENSOR DEBUG PANEL (ADDITIVE — new component)
 * ==================================================
 *
 * An expandable view of the REAL live pipeline, from the HLS stream to the
 * dynamic Top-4. It reads the SAME sensor state the rest of the app uses
 * (there is no second sensor and no polling of stale localStorage values):
 *
 *   video (active / calibration / frames / fps)
 *     → motion (tracking, profDiff, raw + filtered velocity, acceleration)
 *       → wheel (measured direction, speed, angle, predicted stop angle, state)
 *         → timeline (spin detected → tracking → decelerating → slow → near stop → stopped)
 *           → dealer (profile + measured LEFT/CENTER/RIGHT position)
 *             → prediction (lock / latest-used / physical-stop, validity, Top-4, all 8, reason)
 *
 * Every value is either a real measurement or an explicit UNAVAILABLE with the
 * exact reason — nothing here is invented and nothing is defaulted.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  getSensorRuntime,
  getVideoPhysics,
  subscribeSensorRuntime,
  subscribeVideoPhysics,
} from "./RevoVideoSensor";
import {
  getDealerProfiles,
  subscribeDealers,
  getDealerVersion,
} from "./dealerSignal";
import { getSignalStoreVersion, getTimedRounds, subscribeSignalStore } from "./signalDataStore";
import { getMotionFrames } from "./signalDataStore";
import { rotationReadout, computePhysicsEvidence, learnDeceleration } from "./wheelPhysicsLayer";
import { getDossiers, getLedgerVersion, getPredictions, subscribeLedger } from "./physicsDossier";
import { getSignalFlags } from "./signalFlags";
import { OUTCOME_DISPLAY, OUTCOME_COLORS } from "./signalSectorMap";
import { useMounted } from "./SignalPanelFrame";

/** Subscribes to every live source this panel renders (no second sensor). */
function useLiveSubscriptions(): void {
  useSyncExternalStore(subscribeSensorRuntime, getSensorVersion, () => 0);
  useSyncExternalStore(subscribeVideoPhysics, getPhysicsVersion, () => 0);
  useSyncExternalStore(subscribeSignalStore, getSignalStoreVersion, () => 0);
  useSyncExternalStore(subscribeDealers, getDealerVersion, () => 0);
  useSyncExternalStore(subscribeLedger, getLedgerVersion, () => 0);
}

// Monotonic counters used ONLY as change tokens for useSyncExternalStore.
let sensorVersion = 0;
subscribeSensorRuntime(() => { sensorVersion++; });
function getSensorVersion(): number {
  return sensorVersion;
}
let physicsVersion = 0;
subscribeVideoPhysics(() => { physicsVersion++; });
function getPhysicsVersion(): number {
  return physicsVersion;
}

function Line({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#151a33] py-[3px]">
      <span className="text-[10px] uppercase tracking-wider text-[#5a6a99]">{label}</span>
      <span className="truncate text-[11px] font-bold" style={{ color: color ?? "#dbe3ff" }} title={value}>
        {value}
      </span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 mb-1 text-[9px] font-bold uppercase tracking-widest text-[#00d4ff]">{children}</div>;
}

export function RevoLiveSensorDebugPanel() {
  const mounted = useMounted();
  useLiveSubscriptions();
  const [open, setOpen] = useState(false);

  const runtime = getSensorRuntime();
  const sensor = getVideoPhysics();
  const frames = getMotionFrames();
  const recentFrames = useMemo(() => frames.filter((f) => f.timestamp >= Date.now() - 20_000), [frames.length, runtime.lastFrameTimestamp]);

  const rotation = useMemo(
    () => rotationReadout(recentFrames, sensor ? {
      velocity: sensor.velocity,
      velocityRaw: sensor.velocityRaw,
      acceleration: sensor.acceleration,
      confidence: sensor.confidence,
      direction: sensor.direction,
      isTracking: sensor.isTracking,
    } : null),
    [recentFrames.length, sensor?.timestamp, sensor?.isTracking],
  );

  const evidence = useMemo(
    () => computePhysicsEvidence(recentFrames, {
      windowMs: 4_000,
      learnedDeceleration: learnDeceleration([], Date.now()),
    }),
    [recentFrames.length, sensor?.timestamp],
  );

  const dealer = getDealerProfiles().slice(-1)[0] ?? null;
  const dossiers = getDossiers();
  const lastDossier = dossiers.slice(-1)[0] ?? null;
  const lastPrediction = getPredictions().slice(-1)[0] ?? null;
  const rounds = getTimedRounds();
  const flags = getSignalFlags();

  // Predicted stop angle / sector from the physics layer's own position model.
  const pos = evidence.position;

  const physicsTop4 = useMemo(() => {
    if (!evidence.evidence) return [];
    return Object.entries(evidence.outcomeProbabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${OUTCOME_DISPLAY[k]} ${(v * 100).toFixed(1)}%`);
  }, [evidence]);

  if (!mounted) {
    return (
      <div className="revo-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs font-bold uppercase tracking-wider text-white">Live sensor debug</span>
          <span className="text-[10px] text-[#5a6a99]">initializing…</span>
        </div>
      </div>
    );
  }

  const videoState = runtime.active ? (runtime.frames > 0 ? "ACTIVE" : "CONNECTING") : "INACTIVE";

  return (
    <div className="revo-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-[#1e2240] bg-gradient-to-r from-[#00d4ff]/10 to-transparent px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-microchip text-[#00d4ff]" /> Live sensor debug
        </span>
        <span className="flex items-center gap-3 text-[10px] text-[#5a6a99]">
          <span style={{ color: videoState === "ACTIVE" ? "#2ed573" : videoState === "CONNECTING" ? "#ffa502" : "#ff4757" }}>
            video {videoState}
          </span>
          <span>frames {runtime.frames}</span>
          <span>{runtime.fps.toFixed(1)} fps</span>
          <span style={{ color: runtime.calibrationLocked ? "#2ed573" : "#ffa502" }}>
            cal {runtime.calibrationLocked ? "LOCKED" : "UNLOCKED"}
          </span>
          <i className={`fas ${open ? "fa-chevron-up" : "fa-chevron-down"}`} />
        </span>
      </button>

      {open && (
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-3">
          {/* ---------- VIDEO → MOTION ---------- */}
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
            <SectionTitle>Video → motion</SectionTitle>
            <Line label="Stream / status" value={runtime.streamState} color={runtime.active ? "#2ed573" : "#ff4757"} />
            <Line label="CV loop" value={runtime.active ? "RUNNING (requestAnimationFrame)" : "STOPPED — press Start Live Sensor"} />
            <Line label="Frames processed" value={String(runtime.frames)} />
            <Line label="FPS" value={`${runtime.fps.toFixed(1)}`} />
            <Line label="Calibration" value={runtime.calibrationLocked ? "LOCKED" : "UNLOCKED / CALIBRATING"} color={runtime.calibrationLocked ? "#2ed573" : "#ffa502"} />
            <Line label="Tracking" value={runtime.tracking ? "ACTIVE" : "IDLE"} color={runtime.tracking ? "#2ed573" : "#5a6a99"} />
            <Line label="Last frame" value={runtime.lastFrameTimestamp ? `${((Date.now() - runtime.lastFrameTimestamp) / 1000).toFixed(1)} s ago` : "never"} />
            <Line label="ProfDiff" value={runtime.profDiff.toFixed(2)} />
            <Line label="Raw velocity" value={`${runtime.velocityRaw.toFixed(1)} °/s`} />
            <Line label="Filtered velocity" value={`${runtime.velocity.toFixed(1)} °/s`} />
            <Line label="Acceleration" value={`${runtime.acceleration.toFixed(1)} °/s²`} />
            <Line
              label="Direction (sensor)"
              value={runtime.directionLabel}
              color={runtime.directionLabel === "RIGHT" ? "#2ed573" : runtime.directionLabel === "LEFT" ? "#448AFF" : "#5a6a99"}
            />
            <Line label="Sensor confidence" value={`${(runtime.confidence * 100).toFixed(0)}%`} />
            {runtime.lastError && <Line label="Last error" value={runtime.lastError} color="#ff4757" />}
          </div>

          {/* ---------- WHEEL / TIMELINE ---------- */}
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
            <SectionTitle>Wheel → timeline</SectionTitle>
            <Line
              label="Rotation direction"
              value={rotation.display}
              color={rotation.direction === "RIGHT" ? "#2ed573" : rotation.direction === "LEFT" ? "#448AFF" : "#5a6a99"}
            />
            <Line label="Direction source" value={rotation.source} />
            <Line label="Direction confidence" value={`${(rotation.confidence * 100).toFixed(0)}%`} />
            <Line label="Sign convention agrees" value={rotation.signAgreement === null ? "no comparison available" : rotation.signAgreement ? "yes (velocity sign == Δangle sign)" : "NO — sensor sign contradicts measured Δangle"} />
            <Line label="Speed (filtered)" value={`${rotation.filteredSpeedDegPerSec.toFixed(1)} °/s`} />
            <Line label="Speed (raw)" value={`${rotation.rawSpeedDegPerSec.toFixed(1)} °/s`} />
            <Line label="Acceleration" value={`${rotation.acceleration.toFixed(1)} °/s²`} />
            <Line label="Motion state" value={evidence.diagnostics.motionState} />
            <Line label="Moving frames (20 s)" value={`${rotation.movingFrames} / ${rotation.frames}`} />
            <Line label="Current angle" value={sensor ? `${sensor.angleWrapped.toFixed(1)}° (sector ${sensor.sectorEstimate ?? "—"})` : "UNAVAILABLE"} />
            <Line label="Predicted stop angle" value={pos.predictedStopAngle === null ? "UNAVAILABLE" : `${pos.predictedStopAngle.toFixed(1)}° ±${(pos.stopAngleUncertaintyDeg ?? 0).toFixed(1)}°`} />
            <Line label="Predicted sector → outcome" value={pos.predictedSector === null ? "UNAVAILABLE" : `${pos.predictedSector} → ${pos.predictedOutcome}`} />
            <Line label="Insufficient reason" value={evidence.evidence ? "—" : evidence.reason} color={evidence.evidence ? "#2ed573" : "#ffa502"} />
          </div>

          {/* ---------- DEALER + PREDICTION ---------- */}
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3">
            <SectionTitle>Dealer → prediction</SectionTitle>
            <Line label="Dealer profile" value={dealer ? (dealer.name ? `${dealer.name} (${dealer.dealerId})` : `UNKNOWN NAME · ${dealer.dealerId}`) : "no dealer observed yet"} />
            <Line
              label="Dealer position"
              value={dealer ? `${dealer.position.current} (conf ${(dealer.position.confidence * 100).toFixed(0)}%)` : "UNKNOWN"}
              color={dealer && dealer.position.current !== "UNKNOWN" ? "#FFD700" : "#5a6a99"}
            />
            <Line label="Position counts" value={dealer ? JSON.stringify(dealer.position.counts) : "—"} />
            <Line label="Position reason" value={dealer?.position.lastReason ?? "no observation"} />
            <Line label="Dealer identification" value={dealer ? `${(dealer.identification.meanConfidence * 100).toFixed(0)}% · ${dealer.identification.observations} obs` : "—"} />
            <Line label="Rounds with dealer" value={dealer ? String(dealer.rounds.length) : "0"} />
            <Line label="Stored rounds" value={`${rounds.length} (last ${rounds.slice(-1)[0] ? new Date(rounds.slice(-1)[0].settledAt).toISOString().slice(11, 19) + "Z" : "—"})`} />
            <Line label="Physics" value={evidence.evidence ? "VALID" : "INSUFFICIENT"} color={evidence.evidence ? "#2ed573" : "#ffa502"} />
            <Line label="Dossiers" value={String(dossiers.length)} />
            <Line
              label="Last lock / stop"
              value={
                lastDossier
                  ? `lock ${new Date(lastDossier.lockTimestamp).toISOString().slice(11, 19)}Z · stop ${lastDossier.physicalStop !== null ? new Date(lastDossier.physicalStop).toISOString().slice(11, 19) + "Z" : "—"} · used ${lastDossier.latestUsedTimestamp !== null ? new Date(lastDossier.latestUsedTimestamp).toISOString().slice(11, 19) + "Z" : "—"}`
                  : "no dossier yet"
              }
            />
            <Line
              label="Lock contract"
              value={lastDossier ? (lastDossier.leakageSafe ? "latestUsed ≤ lock < physicalStop ✓" : "VIOLATED — see dossier notes") : "—"}
              color={lastDossier ? (lastDossier.leakageSafe ? "#2ed573" : "#ff4757") : "#5a6a99"}
            />
            <Line label="Physics Top-4" value={physicsTop4.length > 0 ? physicsTop4.join(" · ") : "INSUFFICIENT — no valid pre-lock evidence"} color={physicsTop4.length > 0 ? "#fff" : "#ffa502"} />
            <Line label="Last shadow prediction" value={lastPrediction ? `${lastPrediction.ensembleMode}${lastPrediction.shadow ? " (SHADOW)" : ""}` : "—"} />
            <Line label="Flags (real)" value={`T:${flags.TIME_SIGNAL ? "on" : "off"} D:${flags.DEALER_SIGNAL ? "on" : "off"} P:${flags.PHYSICS_SIGNAL ? "on" : "off"} F:${flags.FUSION ? "on" : "off"}`} />
          </div>

          {/* ---------- 8 outcome scores ---------- */}
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-3 lg:col-span-3">
            <SectionTitle>All 8 outcome probabilities (physics evidence only)</SectionTitle>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
              {Object.entries(evidence.outcomeProbabilities).map(([o, v]) => (
                <div key={o} className="flex items-center gap-2 text-[10px]">
                  <span className="w-20 truncate" style={{ color: OUTCOME_COLORS[o] }}>{OUTCOME_DISPLAY[o]}</span>
                  <div className="h-1.5 flex-1 rounded bg-[#151a33]">
                    <div className="h-1.5 rounded" style={{ width: `${Math.min(100, v * 100)}%`, background: OUTCOME_COLORS[o] }} />
                  </div>
                  <span className="w-12 text-right text-[#8899cc]">{(v * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[9px] text-[#5a6a99]">{evidence.reason === "ok" ? "Physics model valid — probabilities come from the constant-deceleration stopping model over the 54 sectors." : `PHYSICS INSUFFICIENT: ${evidence.reason}`}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RevoLiveSensorDebugPanel;
