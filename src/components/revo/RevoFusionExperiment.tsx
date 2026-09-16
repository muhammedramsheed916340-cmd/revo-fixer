"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  DEFAULT_FUSION_WEIGHTS,
  lockPrediction,
  type FusionWeights,
  type LockRecord,
} from "./fusionEngine";
import {
  buildInitial,
  type RoundResult,
} from "./decisionEngine";
import { getLiveSpins } from "./liveSpinStore";
import { getVideoPhysics } from "./RevoVideoSensor";
import {
  getSynchronizedCount,
  getBufferStats,
  getCompletedSpins,
  getCurrentSpin,
  getSpinPhase,
  getSynchronizationReport,
  subscribeToBuffer,
  clearAll,
  type PhysicalSpin,
  type SpinPhase,
} from "./videoPhysicsHistory";
import {
  GAME_CARD_IMAGES,
} from "./aiStats";

const SECTOR_TO_GAME: Record<string, string> = {
  "1": "1", "2": "2", "5": "5", "10": "10",
  CoinFlip: "COIN FLIP", Pachinko: "PACHINKO",
  CashHunt: "CASH HUNT", CrazyTime: "CRAZY TIME",
  CrazyBonus: "CRAZY TIME",
};

const GAME_COLOR: Record<string, string> = {
  "1": "#448AFF", "2": "#2ed573", "5": "#ffa502", "10": "#ff4757",
  PACHINKO: "#00d4ff", "COIN FLIP": "#a78bfa",
  "CASH HUNT": "#FFD700", "CRAZY TIME": "#ff6b9d",
};

const PHASE_COLOR: Record<SpinPhase, string> = {
  IDLE: "#5a6a99",
  SPIN_DETECTED: "#2ed573",
  TRACKING: "#00d4ff",
  DECELERATION: "#ffa502",
  PREDICTION_WINDOW: "#ff6b9d",
  PHYSICAL_STOP: "#ff4757",
  SETTLED: "#8899cc",
};

function useBufferVersion(): number {
  return useSyncExternalStore(
    subscribeToBuffer,
    () => getSynchronizedCount(),
    () => 0,
  );
}

export function RevoFusionExperiment() {
  const [weights] = useState<FusionWeights>(DEFAULT_FUSION_WEIGHTS);
  const [liveLock, setLiveLock] = useState<LockRecord | null>(null);

  // Live buffer stats
  useBufferVersion();
  const syncCount = getSynchronizedCount();
  const bufferStats = getBufferStats();
  const currentSpin = getCurrentSpin();
  const spinPhase = getSpinPhase();
  const syncReport = getSynchronizationReport();

  // Lock a live prediction (no-leakage)
  const lockNow = () => {
    const spins = getLiveSpins();
    const physics = getVideoPhysics();

    const rounds: RoundResult[] = spins
      .slice()
      .reverse()
      .map((s) => ({
        prediction: [],
        actualResult: {
          name: SECTOR_TO_GAME[s.sector] ?? s.sector,
          imageKey: s.sector,
          confidenceRange: [50, 90],
          isBonus: !["1", "2", "5", "10"].includes(s.sector),
        },
        hit: false,
        time: new Date(s.settledAt).getTime(),
        confidence: 50,
        recalibrated: false,
      }));

    const physicsSnapshot = physics
      ? {
          timestamp: physics.timestamp,
          angle: physics.angle,
          velocity: physics.velocity,
          acceleration: physics.acceleration,
          confidence: physics.confidence,
          direction: physics.direction,
          isTracking: physics.isTracking,
          calibrationStable: physics.calibrationStable,
        }
      : null;

    const lockTs = Date.now();
    const lock = lockPrediction(rounds, spins, physicsSnapshot, weights, lockTs);
    setLiveLock(lock);

    toast.success(
      `Prediction LOCKED — Top4: [${lock.top4.join(", ")}] · coverage ${(lock.top4Coverage * 100).toFixed(1)}%`,
      {
        description: `Video ${lock.videoUsed ? "USED" : "INSUFFICIENT"} · conf ${(lock.fusionConfidence * 100).toFixed(0)}%`,
      },
    );
  };

  const handleClear = () => {
    clearAll();
    setLiveLock(null);
    toast.info("All synchronized data cleared");
  };

  const completedSpins = getCompletedSpins();

  return (
    <section
      id="fusion-experiment"
      className="scroll-mt-20 px-4 py-10 sm:px-6"
      aria-label="Fusion engine experiment V2.2"
    >
      <div className="mx-auto max-w-5xl">
        {/* Heading */}
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#ff6b9d]">
            <i className="fas fa-clock-rotate-left" /> V2.2 · Physical Timeline
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Fusion <span className="text-[#ff6b9d]">Engine V2.2</span>
          </h2>
          <p className="mt-1 text-sm text-[#8899cc]">
            Video-derived physical timeline → spin start/stop detection → true pre-result lock points
          </p>
        </div>

        {/* Warning banner */}
        <div className="mb-5 rounded-xl border border-[#ffa502]/40 bg-[#ffa502]/10 px-4 py-2.5 text-xs text-[#ffa502]">
          <i className="fas fa-triangle-exclamation mr-1.5" />
          <b>TIMELINE VALIDATION ONLY —</b> NOT prediction accuracy. The API
          settledAt is NOT the physical stop. We now detect spin start/stop from
          VIDEO telemetry. Lock points are relative to physical stop.
        </div>

        {/* Real-time spin state machine */}
        <div className="revo-card mb-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-gear text-[#00d4ff]" /> Real-time Spin State
            </span>
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-black"
              style={{
                background: `${PHASE_COLOR[spinPhase]}20`,
                color: PHASE_COLOR[spinPhase],
              }}
            >
              ● {spinPhase}
            </span>
          </div>
          {currentSpin && (
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <div className="text-[9px] text-[#5a6a99]">Spin start</div>
                <div className="font-bold text-white">
                  {currentSpin.physicalSpinStart
                    ? new Date(currentSpin.physicalSpinStart).toLocaleTimeString()
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-[#5a6a99]">Physical stop</div>
                <div className="font-bold" style={{
                  color: currentSpin.physicalSpinStop ? "#ff4757" : "#5a6a99",
                }}>
                  {currentSpin.physicalSpinStop
                    ? new Date(currentSpin.physicalSpinStop).toLocaleTimeString()
                    : "tracking…"}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-[#5a6a99]">Max velocity</div>
                <div className="font-bold text-[#00d4ff]">
                  {currentSpin.maxVelocity.toFixed(0)}°/s
                </div>
              </div>
              <div>
                <div className="text-[9px] text-[#5a6a99]">Stop confidence</div>
                <div className="font-bold" style={{
                  color: currentSpin.physicalStopConfidence > 0.5 ? "#2ed573" : "#ffa502",
                }}>
                  {(currentSpin.physicalStopConfidence * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          )}
          {!currentSpin && (
            <div className="text-center text-[11px] text-[#5a6a99]">
              Waiting for wheel movement (STOPPED → MOVING transition)…
            </div>
          )}
        </div>

        {/* Synchronized dataset status */}
        <div className="revo-card mb-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-database text-[#00d4ff]" /> Physical Dataset
            </span>
            <button
              onClick={handleClear}
              className="rounded-lg border border-[#ff4757]/40 bg-[#ff4757]/10 px-2 py-1 text-[10px] font-bold text-[#ff4757] transition hover:bg-[#ff4757]/20"
            >
              <i className="fas fa-trash mr-1" /> Clear
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <div className="text-[9px] text-[#5a6a99]">Completed spins</div>
              <div className="font-black text-white">{syncReport.totalCompletedSpins}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">With physical stop</div>
              <div className="font-black text-[#2ed573]">{syncReport.spinsWithPhysicalStop}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">API matched</div>
              <div className="font-black text-[#00d4ff]">{syncReport.spinsWithApiMatch}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Unmatched</div>
              <div className="font-black text-[#ffa502]">{syncReport.unmatchedSpins}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Physics snapshots</div>
              <div className="font-black text-[#a78bfa]">{bufferStats.totalSnapshots}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Tracking snapshots</div>
              <div className="font-black text-[#2ed573]">{bufferStats.trackingSnapshots}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Moving snapshots</div>
              <div className="font-black text-[#ff6b9d]">{bufferStats.movingSnapshots}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Buffer time</div>
              <div className="font-black text-white">{(bufferStats.timeSpanSeconds / 60).toFixed(1)}min</div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            onClick={lockNow}
            className="flex items-center gap-2 rounded-xl border border-[#2ed573]/40 bg-[#2ed573]/10 px-4 py-2.5 text-sm font-bold text-[#2ed573] transition hover:bg-[#2ed573]/20"
          >
            <i className="fas fa-lock" />
            Lock Prediction Now
          </button>
        </div>

        {/* Live lock display */}
        {liveLock && <LiveLockDisplay lock={liveLock} />}

        {/* Synchronization Report (TIMELINE VALIDATION) */}
        <SyncReportView report={syncReport} completedSpins={completedSpins} />

        {/* Recent spins list */}
        {completedSpins.length > 0 && (
          <div className="revo-card mt-4 overflow-hidden">
            <div className="border-b border-[#1e2240] bg-gradient-to-r from-[#00d4ff]/10 to-transparent px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-list text-[#00d4ff]" /> Recent Physical Spins
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto revo-scroll p-3">
              {completedSpins.slice(-15).reverse().map((spin) => (
                <SpinRow key={spin.spinId} spin={spin} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function LiveLockDisplay({ lock }: { lock: LockRecord }) {
  return (
    <div className="revo-card mb-5 overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#2ed573]/10 to-transparent px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-lock text-[#2ed573]" /> Live Prediction Lock
        </span>
        <span className="text-[10px] text-[#5a6a99]">
          {new Date(lock.lockTimestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="p-4">
        {lock.top4.length > 0 ? (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {lock.top4.map((name, i) => {
              const imgKey = name === "COIN FLIP" ? "CoinFlip"
                : name === "PACHINKO" ? "Pachinko"
                : name === "CASH HUNT" ? "CashHunt"
                : name === "CRAZY TIME" ? "CrazyTime"
                : name;
              return (
                <div
                  key={name}
                  className="rounded-xl border-2 p-2 text-center"
                  style={{
                    borderColor: `${GAME_COLOR[name] ?? "#8899cc"}60`,
                    background: `${GAME_COLOR[name] ?? "#8899cc"}10`,
                  }}
                >
                  <span className="mb-1 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-black">
                    #{i + 1}
                  </span>
                  <img
                    src={GAME_CARD_IMAGES[imgKey]}
                    alt={name}
                    className="mx-auto h-10 w-10 object-contain"
                  />
                  <div className="mt-0.5 text-xs font-bold text-white">{name}</div>
                  <div className="text-[9px] text-[#5a6a99]">
                    {isFinite(lock.outcomeProbabilities[name] ?? 0)
                      ? `${((lock.outcomeProbabilities[name] ?? 0) * 100).toFixed(1)}%`
                      : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mb-3 rounded-lg border border-[#ff4757]/40 bg-[#ff4757]/10 p-3 text-center text-sm font-bold text-[#ff4757]">
            <i className="fas fa-ban mr-1" />
            VIDEO: INSUFFICIENT — no valid pre-result video prediction
          </div>
        )}
        <div className="mt-2 flex items-center gap-2 text-[10px]">
          <i className="fas fa-shield-halved text-[#2ed573]" />
          <span className="text-[#2ed573]">
            No leakage: all inputs ≤ lock time
          </span>
        </div>
      </div>
    </div>
  );
}

function SyncReportView({
  report,
  completedSpins,
}: {
  report: ReturnType<typeof getSynchronizationReport>;
  completedSpins: PhysicalSpin[];
}) {
  const { apiDelayStats } = report;
  const delays = report.apiDelays;

  // Timeline gates
  const gatePhysicalStop = report.spinsWithPhysicalStop > 0;
  const gateApiMatch = report.spinsWithApiMatch > 0;
  const gateLockReconstruction = report.lockPointReconstruction.t5Reconstructed > 0;
  const gateLeakage = report.leakageAudit.passed;
  const gateMinSpins = report.spinsWithApiMatch >= 20;

  const allGatesPassed =
    gatePhysicalStop &&
    gateApiMatch &&
    gateLockReconstruction &&
    gateLeakage &&
    gateMinSpins;

  return (
    <div className="space-y-4">
      <div className="revo-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#00d4ff]/10 to-transparent px-4 py-3">
          <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
            <i className="fas fa-stopwatch text-[#00d4ff]" /> Timeline Synchronization Report
          </span>
          <span className="text-[10px] text-[#5a6a99]">
            {completedSpins.length} spins · {report.spinsWithApiMatch} matched
          </span>
        </div>
        <div className="p-4">
          {/* API delay distribution */}
          <div className="mb-4">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              API Delay Distribution (physical stop → API result)
            </div>
            {delays.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <DelayTile label="Min" value={apiDelayStats.min} />
                <DelayTile label="Median" value={apiDelayStats.median} />
                <DelayTile label="Mean" value={apiDelayStats.mean} />
                <DelayTile label="Max" value={apiDelayStats.max} />
              </div>
            ) : (
              <div className="text-center text-[11px] text-[#5a6a99]">
                No API-matched spins yet. Waiting for results…
              </div>
            )}
          </div>

          {/* Lock-point reconstruction */}
          <div className="mb-4">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              Lock-Point Reconstruction (relative to physical stop)
            </div>
            <div className="grid grid-cols-4 gap-2 text-[10px]">
              {(["T-20", "T-15", "T-10", "T-5"] as const).map((lp) => {
                const key = `${lp}Reconstructed` as keyof typeof report.lockPointReconstruction;
                const moveKey = `${lp}WithMovement` as keyof typeof report.lockPointReconstruction;
                const recon = report.lockPointReconstruction[key];
                const move = report.lockPointReconstruction[moveKey];
                return (
                  <div key={lp} className="rounded-lg bg-[#0d1020] p-2 text-center">
                    <div className="text-[#5a6a99]">{lp}</div>
                    <div className="font-bold text-white">
                      {recon}/{report.spinsWithPhysicalStop}
                    </div>
                    <div className="text-[8px]" style={{
                      color: move > 0 ? "#2ed573" : "#5a6a99",
                    }}>
                      {move} with movement
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tracking quality */}
          <div className="mb-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
            <div>
              <div className="text-[9px] text-[#5a6a99]">Avg tracking rate</div>
              <div className="font-bold" style={{
                color: report.trackingQuality.avgTrackingRate > 0.3 ? "#2ed573" : "#ffa502",
              }}>
                {(report.trackingQuality.avgTrackingRate * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Avg stop confidence</div>
              <div className="font-bold" style={{
                color: report.trackingQuality.avgStopConfidence > 0.5 ? "#2ed573" : "#ffa502",
              }}>
                {(report.trackingQuality.avgStopConfidence * 100).toFixed(0)}%
              </div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Unmatched spins</div>
              <div className="font-bold" style={{
                color: report.unmatchedSpins === 0 ? "#2ed573" : "#ffa502",
              }}>
                {report.unmatchedSpins}
              </div>
            </div>
          </div>

          {/* Timeline gates */}
          <div className="mb-4 border-t border-[#1e2240]/60 pt-3">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              Timeline Success Gates
            </div>
            <div className="space-y-1.5 text-[11px]">
              <GateCheck label="Physical stop detectable" passed={gatePhysicalStop} />
              <GateCheck label="API results match physical spins" passed={gateApiMatch} />
              <GateCheck label="Lock points reconstructable (T-5)" passed={gateLockReconstruction} />
              <GateCheck label="No timestamp leakage" passed={gateLeakage} />
              <GateCheck label="20+ matched spins collected" passed={gateMinSpins} />
            </div>
          </div>

          {/* Verdict */}
          <div className={`rounded-lg border p-3 text-center text-sm font-bold ${
            allGatesPassed
              ? "border-[#2ed573]/40 bg-[#2ed573]/10 text-[#2ed573]"
              : "border-[#ffa502]/40 bg-[#ffa502]/10 text-[#ffa502]"
          }`}>
            <i className={`fas ${allGatesPassed ? "fa-check-circle" : "fa-hourglass-half"} mr-2`} />
            {allGatesPassed
              ? "READY FOR PHYSICS VALIDATION"
              : report.spinsWithApiMatch < 20
                ? `CONTINUE COLLECTION — ${report.spinsWithApiMatch}/20 matched spins`
                : "TIMELINE STILL BROKEN"}
          </div>

          {report.leakageAudit.passed && (
            <div className="mt-2 flex items-center gap-2 text-[10px]">
              <i className="fas fa-shield-halved text-[#2ed573]" />
              <span className="text-[#2ed573]">
                {report.leakageAudit.details}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DelayTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[#0d1020] p-2 text-center">
      <div className="text-[9px] text-[#5a6a99]">{label}</div>
      <div className="font-bold text-white">
        {(value / 1000).toFixed(1)}s
      </div>
    </div>
  );
}

function SpinRow({ spin }: { spin: PhysicalSpin }) {
  const matched = spin.actualOutcome !== null;
  const imgKey = spin.actualOutcome === "COIN FLIP" ? "CoinFlip"
    : spin.actualOutcome === "PACHINKO" ? "Pachinko"
    : spin.actualOutcome === "CASH HUNT" ? "CashHunt"
    : spin.actualOutcome === "CRAZY TIME" ? "CrazyTime"
    : spin.actualOutcome ?? "";

  return (
    <div className="mb-2 rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-2 text-[10px]">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          {matched && spin.actualOutcome && (
            <img
              src={GAME_CARD_IMAGES[imgKey]}
              alt={spin.actualOutcome}
              className="h-6 w-6 rounded object-contain"
            />
          )}
          <span className="font-bold text-white">
            {spin.actualOutcome ?? "unmatched"}
          </span>
        </span>
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-black"
          style={{
            background: `${PHASE_COLOR[spin.spinPhase]}20`,
            color: PHASE_COLOR[spin.spinPhase],
          }}
        >
          {spin.spinPhase}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2 text-[#5a6a99]">
        <div>
          Start: {spin.physicalSpinStart ? new Date(spin.physicalSpinStart).toLocaleTimeString() : "—"}
        </div>
        <div>
          Stop: {spin.physicalSpinStop ? new Date(spin.physicalSpinStop).toLocaleTimeString() : "—"}
        </div>
        <div>
          Delay: {spin.apiDelay !== null ? `${(spin.apiDelay / 1000).toFixed(1)}s` : "—"}
        </div>
      </div>
      <div className="mt-0.5 text-[#5a6a99]">
        Max v={spin.maxVelocity.toFixed(0)}°/s ·
        Tracking {spin.trackingFrameCount}/{spin.totalFrameCount} ·
        Stop conf {(spin.physicalStopConfidence * 100).toFixed(0)}%
      </div>
    </div>
  );
}

function GateCheck({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <i className={`fas ${passed ? "fa-check-circle text-[#2ed573]" : "fa-times-circle text-[#ff4757]"}`} />
      <span className={passed ? "text-[#2ed573]" : "text-[#8899cc]"}>{label}</span>
    </div>
  );
}
