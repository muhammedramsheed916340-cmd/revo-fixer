"use client";

import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  runFusionV2Experiment,
  DEFAULT_FUSION_WEIGHTS,
  lockPrediction,
  type FusionWeights,
  type V2ExperimentResult,
  type LockRecord,
} from "./fusionEngine";
import {
  buildInitial,
  ALL_FLAGS_OFF,
  type RoundResult,
} from "./decisionEngine";
import { getLiveSpins, type SpinData } from "./liveSpinStore";
import { getVideoPhysics } from "./RevoVideoSensor";
import {
  getSynchronizedSpins,
  getSynchronizedCount,
  getBufferStats,
  subscribeToBuffer,
  clearAll,
} from "./videoPhysicsHistory";
import {
  DISPLAY_NAMES,
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

function useBufferVersion(): number {
  return useSyncExternalStore(
    subscribeToBuffer,
    () => getSynchronizedCount(),
    () => 0,
  );
}

export function RevoFusionExperiment() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<V2ExperimentResult | null>(null);
  const [weights, setWeights] = useState<FusionWeights>(DEFAULT_FUSION_WEIGHTS);
  const [liveLock, setLiveLock] = useState<LockRecord | null>(null);

  // Live buffer stats (updates when new snapshots are recorded)
  useBufferVersion();
  const syncCount = getSynchronizedCount();
  const bufferStats = getBufferStats();

  // Run the V2 experiment on REAL synchronized data
  const runExperiment = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      const syncSpins = getSynchronizedSpins();
      if (syncSpins.length < 2) {
        toast.error(
          `Need at least 2 synchronized spins (currently ${syncSpins.length}). Start the video sensor and wait for live results.`,
        );
        setRunning(false);
        return;
      }

      const liveSpins = getLiveSpins();

      // Build RoundResult[] from live spins (for history engine)
      const rounds: RoundResult[] = liveSpins
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

      const experimentResult = runFusionV2Experiment(
        syncSpins,
        rounds,
        liveSpins,
        weights,
      );

      setResult(experimentResult);

      toast.success(
        `V2 experiment complete — ${experimentResult.totalSpins} spins, ${experimentResult.spinsWithValidVideo} with valid video`,
        {
          description: experimentResult.leakageAudit.passed
            ? "Leakage PASS"
            : "LEAKAGE DETECTED!",
        },
      );
    } catch (e) {
      toast.error(`Experiment failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  }, [weights]);

  // Lock a live prediction (no-leakage)
  const lockNow = useCallback(() => {
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
  }, [weights]);

  const updateWeight = useCallback((w: number) => {
    setWeights({
      ...weights,
      videoWeight: w,
      historyWeight: 1 - w,
      version: `fusion-v2-manual-w${w.toFixed(2)}`,
      lastUpdated: Date.now(),
    });
  }, [weights]);

  const handleClear = useCallback(() => {
    clearAll();
    setResult(null);
    setLiveLock(null);
    toast.info("All synchronized data cleared");
  }, []);

  return (
    <section
      id="fusion-experiment"
      className="scroll-mt-20 px-4 py-10 sm:px-6"
      aria-label="Fusion engine experiment V2"
    >
      <div className="mx-auto max-w-5xl">
        {/* Heading */}
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#ff6b9d]">
            <i className="fas fa-flask" /> V2 · Real Synchronized Data
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Fusion <span className="text-[#ff6b9d]">Engine V2</span>
          </h2>
          <p className="mt-1 text-sm text-[#8899cc]">
            Real pre-result video physics + history → calibrated fusion → 70-combo optimizer
          </p>
        </div>

        {/* Warning banner */}
        <div className="mb-5 rounded-xl border border-[#ffa502]/40 bg-[#ffa502]/10 px-4 py-2.5 text-xs text-[#ffa502]">
          <i className="fas fa-triangle-exclamation mr-1.5" />
          <b>EXPERIMENTAL V2 —</b> Video-only shows INSUFFICIENT when no valid
          pre-result video exists. NO theoretical fallback for video. Production
          stays C1-C9 dynamic.
        </div>

        {/* Data collection status */}
        <div className="revo-card mb-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-database text-[#00d4ff]" /> Synchronized Dataset
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
              <div className="text-[9px] text-[#5a6a99]">Synchronized Spins</div>
              <div className="font-black text-white">{syncCount}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Physics Snapshots</div>
              <div className="font-black text-[#00d4ff]">{bufferStats.totalSnapshots}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Tracking Snapshots</div>
              <div className="font-black text-[#2ed573]">{bufferStats.trackingSnapshots}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Spins with Video</div>
              <div className="font-black text-[#ff6b9d]">{bufferStats.validVideoSpins}</div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-[#5a6a99]">
            Buffer time span: {bufferStats.timeSpanSeconds.toFixed(0)}s ·
            To collect data: start the Video Sensor above and wait for live results.
          </div>
        </div>

        {/* Fusion weight control */}
        <div className="revo-card mb-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-sliders text-[#a78bfa]" /> Fusion Weight
            </span>
            <span className="text-[10px] text-[#5a6a99]">
              {weights.version}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold text-[#448AFF]">History</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={weights.videoWeight}
              onChange={(e) => updateWeight(Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-[10px] font-bold text-[#ff6b9d]">Video</span>
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-[#5a6a99]">
            <span>History: {(weights.historyWeight * 100).toFixed(0)}%</span>
            <span>Video: {(weights.videoWeight * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            onClick={runExperiment}
            disabled={running}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#ff6b9d] to-[#a78bfa] px-4 py-2.5 text-sm font-bold text-white transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          >
            <i className={`fas ${running ? "fa-spinner fa-spin" : "fa-flask"}`} />
            {running ? "Running..." : "Run V2 Experiment"}
          </button>
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

        {/* V2 Experiment results */}
        {result && <V2ExperimentResults result={result} weights={weights} />}
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

        <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
          <div>
            <div className="text-[#5a6a99]">Coverage</div>
            <div className="font-bold text-[#2ed573]">
              {isFinite(lock.top4Coverage) ? `${(lock.top4Coverage * 100).toFixed(1)}%` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[#5a6a99]">History conf</div>
            <div className="font-bold text-[#448AFF]">
              {(lock.historyConfidence * 100).toFixed(0)}%
            </div>
          </div>
          <div>
            <div className="text-[#5a6a99]">Video conf</div>
            <div className="font-bold text-[#ff6b9d]">
              {lock.videoUsed ? `${(lock.videoConfidence * 100).toFixed(0)}%` : "INSUFFICIENT"}
            </div>
          </div>
          <div>
            <div className="text-[#5a6a99]">Fusion conf</div>
            <div className="font-bold text-white">
              {(lock.fusionConfidence * 100).toFixed(0)}%
            </div>
          </div>
        </div>

        {lock.stoppingPrediction && (
          <div className="mt-3 rounded-lg border border-[#ff6b9d]/30 bg-[#ff6b9d]/5 p-2 text-[10px]">
            <span className="font-bold text-[#ff6b9d]">
              <i className="fas fa-crosshairs mr-1" />
              Video stopping prediction:
            </span>{" "}
            angle {lock.stoppingPrediction.angle.toFixed(1)}° · sector #{lock.stoppingPrediction.sector} ·
            uncertainty ±{lock.stoppingPrediction.uncertainty.toFixed(0)}° ·
            physics conf {(lock.stoppingPrediction.physicsConfidence * 100).toFixed(0)}%
          </div>
        )}

        <div className="mt-2 flex items-center gap-2 text-[10px]">
          <i className="fas fa-shield-halved text-[#2ed573]" />
          <span className="text-[#2ed573]">
            No leakage: all inputs ≤ lock time
          </span>
          <span className="ml-auto text-[#5a6a99]">
            ID: {lock.predictionId.slice(0, 16)}…
          </span>
        </div>
      </div>
    </div>
  );
}

function V2ExperimentResults({
  result,
  weights,
}: {
  result: V2ExperimentResult;
  weights: FusionWeights;
}) {
  const armLabels: Record<string, string> = {
    A_theoretical: "A: [1,2,5,10]",
    B_history: "B: C1-C9",
    C_video: "C: Video-only",
    D_fusion: "D: Fusion",
  };
  const lockPoints = ["T-20", "T-15", "T-10", "T-5"];

  // Find best arm at T-5
  let bestArm = "A_theoretical";
  let bestRate = 0;
  for (const arm of Object.keys(armLabels)) {
    const rate = result.arms[arm]?.["T-5"]?.hitRate ?? 0;
    if (rate > bestRate) {
      bestRate = rate;
      bestArm = arm;
    }
  }

  return (
    <div className="space-y-4">
      {/* Dataset stats */}
      <div className="revo-card p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-chart-bar text-[#00d4ff]" /> Dataset Statistics
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <div className="text-[9px] text-[#5a6a99]">Total spins</div>
            <div className="font-black text-white">{result.totalSpins}</div>
          </div>
          <div>
            <div className="text-[9px] text-[#5a6a99]">Spins with video</div>
            <div className="font-black text-[#ff6b9d]">{result.spinsWithValidVideo}</div>
          </div>
          <div>
            <div className="text-[9px] text-[#5a6a99]">Total snapshots</div>
            <div className="font-black text-[#00d4ff]">{result.datasetStats.totalSnapshots}</div>
          </div>
          <div>
            <div className="text-[9px] text-[#5a6a99]">Avg/spin</div>
            <div className="font-black text-white">{result.datasetStats.avgSnapshotsPerSpin.toFixed(0)}</div>
          </div>
        </div>
        {/* Lock-point coverage */}
        <div className="mt-3">
          <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Lock-point video coverage
          </div>
          <div className="grid grid-cols-4 gap-2 text-[10px]">
            {lockPoints.map((lp) => (
              <div key={lp} className="rounded-lg bg-[#0d1020] p-2 text-center">
                <div className="text-[#5a6a99]">{lp}</div>
                <div className="font-bold" style={{
                  color: result.lockPointCoverage[lp] > 0.5 ? "#2ed573" :
                         result.lockPointCoverage[lp] > 0 ? "#ffa502" : "#ff4757",
                }}>
                  {(result.lockPointCoverage[lp] * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Data quality report */}
        {result.dataQuality && (
          <div className="mt-3 border-t border-[#1e2240]/60 pt-3">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              Data Quality Report
            </div>
            <div className="grid grid-cols-2 gap-3 text-[10px] sm:grid-cols-3">
              <div>
                <div className="text-[#5a6a99]">Moving spins</div>
                <div className="font-bold" style={{
                  color: result.dataQuality.movingSpinCount >= 10 ? "#2ed573" :
                         result.dataQuality.movingSpinCount > 0 ? "#ffa502" : "#ff4757",
                }}>
                  {result.dataQuality.movingSpinCount}
                </div>
              </div>
              <div>
                <div className="text-[#5a6a99]">Tracking rate</div>
                <div className="font-bold" style={{
                  color: result.dataQuality.trackingRate > 0.1 ? "#2ed573" :
                         result.dataQuality.trackingRate > 0.02 ? "#ffa502" : "#ff4757",
                }}>
                  {(result.dataQuality.trackingRate * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-[#5a6a99]">Calibration stability</div>
                <div className="font-bold" style={{
                  color: result.dataQuality.calibrationStability > 0.8 ? "#2ed573" :
                         result.dataQuality.calibrationStability > 0.5 ? "#ffa502" : "#ff4757",
                }}>
                  {(result.dataQuality.calibrationStability * 100).toFixed(0)}%
                </div>
              </div>
              <div>
                <div className="text-[#5a6a99]">Direction consistency</div>
                <div className="font-bold" style={{
                  color: result.dataQuality.directionConsistency > 0.9 ? "#2ed573" : "#ffa502",
                }}>
                  {(result.dataQuality.directionConsistency * 100).toFixed(0)}%
                </div>
              </div>
              <div>
                <div className="text-[#5a6a99]">INSUFFICIENT spins</div>
                <div className="font-bold text-[#ff4757]">
                  {result.dataQuality.insufficientCount}
                </div>
              </div>
              <div>
                <div className="text-[#5a6a99]">Moving snapshots</div>
                <div className="font-bold text-[#00d4ff]">
                  {result.datasetStats.movingSnapshots}
                </div>
              </div>
            </div>

            {/* Timing sync */}
            <div className="mt-2 grid grid-cols-3 gap-2 text-[9px]">
              <div className="rounded-lg bg-[#0d1020] p-1.5 text-center">
                <div className="text-[#5a6a99]">Avg API delay</div>
                <div className="font-bold text-white">{(result.dataQuality.timingSync.avgDelay / 1000).toFixed(1)}s</div>
              </div>
              <div className="rounded-lg bg-[#0d1020] p-1.5 text-center">
                <div className="text-[#5a6a99]">Min API delay</div>
                <div className="font-bold text-white">{(result.dataQuality.timingSync.minDelay / 1000).toFixed(1)}s</div>
              </div>
              <div className="rounded-lg bg-[#0d1020] p-1.5 text-center">
                <div className="text-[#5a6a99]">Max API delay</div>
                <div className="font-bold text-white">{(result.dataQuality.timingSync.maxDelay / 1000).toFixed(1)}s</div>
              </div>
            </div>

            {/* Sector map status */}
            <div className="mt-2 text-[10px]">
              <span className="text-[#5a6a99]">Sector map: </span>
              <span className="font-bold" style={{
                color: result.dataQuality.sectorMapStatus.confident ? "#2ed573" : "#ffa502",
              }}>
                {result.dataQuality.sectorMapStatus.totalObservations} observations
                ({result.dataQuality.sectorMapStatus.confident ? "confident" : "need 10+"})
              </span>
            </div>

            {/* Ready-for-validation banner */}
            <div className={`mt-3 rounded-lg border p-2.5 text-center text-xs font-bold ${
              result.dataQuality.readyForValidation
                ? "border-[#2ed573]/40 bg-[#2ed573]/10 text-[#2ed573]"
                : "border-[#ffa502]/40 bg-[#ffa502]/10 text-[#ffa502]"
            }`}>
              <i className={`fas ${result.dataQuality.readyForValidation ? "fa-check-circle" : "fa-hourglass-half"} mr-1`} />
              {result.dataQuality.readyForValidation
                ? "DATA SUFFICIENT — Ready for physics validation"
                : "CONTINUE COLLECTION — Need 10+ spins with movement"}
            </div>
          </div>
        )}
      </div>

      {/* Multi-lock-point comparison table */}
      <div className="revo-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#ff6b9d]/10 to-transparent px-4 py-3">
          <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
            <i className="fas fa-table text-[#ff6b9d]" /> A/B/C/D × T-20/T-15/T-10/T-5
          </span>
          <span className="text-[10px] text-[#5a6a99]">
            weights: H{(weights.historyWeight * 100).toFixed(0)}/V{(weights.videoWeight * 100).toFixed(0)}
          </span>
        </div>
        <div className="overflow-x-auto revo-scroll">
          <table className="w-full text-center text-xs">
            <thead>
              <tr className="border-b border-[#1e2240] bg-[#0d1020]/60">
                <th className="px-3 py-2 text-left">Arm</th>
                {lockPoints.map((lp) => (
                  <th key={lp} className="px-2 py-2">{lp}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(armLabels).map(([armId, armLabel]) => {
                const isBest = armId === bestArm;
                return (
                  <tr
                    key={armId}
                    className={`border-b border-[#1e2240]/40 ${isBest ? "bg-[#2ed573]/5" : ""}`}
                  >
                    <td className="px-3 py-2 text-left font-bold text-white">
                      {armLabel}
                      {isBest && <span className="ml-1 text-[#2ed573]">★</span>}
                    </td>
                    {lockPoints.map((lp) => {
                      const a = result.arms[armId]?.[lp];
                      if (!a) return <td key={lp} className="px-2 py-2 text-[#5a6a99]">—</td>;
                      const total = a.hits + a.misses;
                      const insufficient = a.insufficientCount;
                      return (
                        <td key={lp} className="px-2 py-2">
                          <div className="font-bold" style={{
                            color: a.hitRate >= 0.8 ? "#2ed573" :
                                   a.hitRate >= 0.7 ? "#ffa502" :
                                   a.hitRate > 0 ? "#ff4757" : "#5a6a99",
                          }}>
                            {total > 0 ? `${(a.hitRate * 100).toFixed(0)}%` : "—"}
                          </div>
                          <div className="text-[8px] text-[#5a6a99]">
                            {a.hits}/{total}
                          </div>
                          {insufficient > 0 && (
                            <div className="text-[7px] font-bold text-[#ff4757]">
                              {insufficient} INSUF
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* McNemar */}
      {result.mcnemar && (
        <div className="revo-card p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
            <i className="fas fa-balance-scale text-[#a78bfa]" /> McNemar (D vs B at T-5)
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <div className="text-[9px] text-[#5a6a99]">B HIT → D MISS</div>
              <div className="font-bold text-[#ff4757]">{result.mcnemar.r}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">B MISS → D HIT</div>
              <div className="font-bold text-[#2ed573]">{result.mcnemar.s}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">p-value</div>
              <div className={`font-bold ${result.mcnemar.significant ? "text-[#2ed573]" : "text-[#8899cc]"}`}>
                {result.mcnemar.pValue.toFixed(4)}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Discordant</div>
              <div className="font-bold text-white">{result.mcnemar.discordant}</div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-[#8899cc]">
            {result.mcnemar.discordant < 10
              ? `⚠ Inconclusive (${result.mcnemar.discordant} discordant, need ≥10)`
              : result.mcnemar.significant
                ? "✓ Significant — fusion genuinely differs from history-only (p < 0.05)"
                : "Not significant — fusion does NOT outperform history-only"}
          </div>
        </div>
      )}

      {/* Leakage audit */}
      <div className={`revo-card p-3 ${result.leakageAudit.passed ? "border-[#2ed573]/40" : "border-[#ff4757]/40"}`}>
        <div className="flex items-center gap-2 text-xs">
          <i className={`fas ${result.leakageAudit.passed ? "fa-check-circle text-[#2ed573]" : "fa-times-circle text-[#ff4757]"}`} />
          <span className="font-bold text-white">Leakage Audit:</span>
          <span className={result.leakageAudit.passed ? "text-[#2ed573]" : "text-[#ff4757]"}>
            {result.leakageAudit.details}
          </span>
        </div>
      </div>

      {/* Miss forensics */}
      {result.missForensics.length > 0 && (
        <div className="revo-card overflow-hidden">
          <div className="border-b border-[#1e2240] bg-gradient-to-r from-[#ff4757]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-magnifying-glass text-[#ff4757]" /> Miss Forensics ({result.missForensics.length})
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto revo-scroll p-3">
            {result.missForensics.slice(0, 25).map((m, i) => (
              <div key={i} className="mb-2 rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-2 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">
                    {m.lockPoint} · {m.arm}: actual {m.actual} (rank #{m.actualRank})
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[9px] font-black"
                    style={{
                      background: m.classification === "NO_PRE_RESULT_SIGNAL" ? "#5a6a9920" :
                                  m.classification === "PHYSICS_ERROR" ? "#ff475720" :
                                  m.classification === "TRACKING_ERROR" ? "#ffa50220" :
                                  m.classification === "CALIBRATION_ERROR" ? "#448AFF20" :
                                  m.classification === "HISTORY_ERROR" ? "#a78bfa20" : "#8899cc20",
                      color: m.classification === "NO_PRE_RESULT_SIGNAL" ? "#5a6a99" :
                             m.classification === "PHYSICS_ERROR" ? "#ff4757" :
                             m.classification === "TRACKING_ERROR" ? "#ffa502" :
                             m.classification === "CALIBRATION_ERROR" ? "#448AFF" :
                             m.classification === "HISTORY_ERROR" ? "#a78bfa" : "#8899cc",
                    }}
                  >
                    {m.classification}
                  </span>
                </div>
                {m.missingSignal && (
                  <div className="mt-1 text-[#8899cc]">{m.missingSignal}</div>
                )}
                {m.physicsSnapshot && (
                  <div className="mt-0.5 text-[#5a6a99]">
                    Video: v={m.physicsSnapshot.velocity.toFixed(0)}°/s conf={(m.physicsSnapshot.confidence * 100).toFixed(0)}%
                    {m.angularError !== null && ` · ang err ${m.angularError.toFixed(0)}°`}
                    {` · margin ${(m.margin4vs5 * 100).toFixed(1)}pp`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Production integration gate */}
      <div className="revo-card p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-traffic-light text-[#ffa502]" /> Production Integration Gate
        </div>
        <div className="space-y-1.5 text-[11px]">
          <GateCheck label="Zero leakage" passed={result.leakageAudit.passed} />
          <GateCheck label="Real video data (not theoretical fallback)" passed={result.spinsWithValidVideo > 0} />
          <GateCheck label="Video-only made predictions (not all INSUFFICIENT)" passed={
            Object.values(result.arms["C_video"] || {}).some((lp) => lp.hits + lp.misses > 0 && lp.insufficientCount < (lp.hits + lp.misses))
          } />
          <GateCheck label="Fusion outperforms history-only" passed={
            (result.arms["D_fusion"]?.["T-5"]?.hitRate ?? 0) > (result.arms["B_history"]?.["T-5"]?.hitRate ?? 0)
          } />
          <GateCheck label="Statistically significant (p < 0.05)" passed={result.mcnemar?.significant ?? false} />
          <GateCheck label="Fusion > 83.3% theoretical" passed={(result.arms["D_fusion"]?.["T-5"]?.hitRate ?? 0) > 0.833} />
        </div>
        <div className="mt-3 rounded-lg border border-[#ffa502]/30 bg-[#ffa502]/5 p-2 text-[11px] text-[#ffa502]">
          <i className="fas fa-info-circle mr-1" />
          <b>Recommendation:</b>{" "}
          {result.leakageAudit.passed && result.spinsWithValidVideo > 0 &&
           (result.arms["D_fusion"]?.["T-5"]?.hitRate ?? 0) > (result.arms["B_history"]?.["T-5"]?.hitRate ?? 0) &&
           (result.mcnemar?.significant ?? false)
            ? "Fusion shows genuine improvement — consider integration (needs 500-spin validation)"
            : "Do NOT integrate fusion — it does not meet integration criteria. Video has NOT been validated as a genuine pre-result signal."}
        </div>
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
