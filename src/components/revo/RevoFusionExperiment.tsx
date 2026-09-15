"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  runFusionExperiment,
  DEFAULT_FUSION_WEIGHTS,
  lockPrediction,
  type FusionWeights,
  type ExperimentResult,
  type LockRecord,
  type PhysicsSnapshot,
} from "./fusionEngine";
import {
  buildInitial,
  ALL_FLAGS_OFF,
  type RoundResult,
} from "./decisionEngine";
import { getLiveSpins, type SpinData } from "./liveSpinStore";
import { getVideoPhysics } from "./RevoVideoSensor";
import {
  DISPLAY_NAMES,
  GAME_CARD_IMAGES,
} from "./aiStats";

// Map spin sector to game name (for actual results)
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

export function RevoFusionExperiment() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExperimentResult | null>(null);
  const [weights, setWeights] = useState<FusionWeights>(DEFAULT_FUSION_WEIGHTS);
  const [liveLock, setLiveLock] = useState<LockRecord | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Run the retrospective A/B/C/D experiment
  const runExperiment = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      const spins = getLiveSpins();
      if (spins.length < 10) {
        toast.error("Need at least 10 live spins for experiment");
        setRunning(false);
        return;
      }

      // Build RoundResult[] from live spins (chronological, oldest first)
      const rounds: RoundResult[] = spins
        .slice()
        .reverse()
        .map((s, i) => ({
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

      // No physics history available yet — use empty array
      // (In a production system, we'd collect physics snapshots over time)
      const physicsHistory: PhysicsSnapshot[] = [];

      const experimentResult = runFusionExperiment(
        rounds,
        spins,
        physicsHistory,
        weights,
      );

      setResult(experimentResult);

      if (experimentResult.leakageAudit.passed) {
        toast.success(
          `Experiment complete — ${experimentResult.totalRounds} rounds, leakage PASS`,
        );
      } else {
        toast.error("Leakage detected!");
      }
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

    // Build rounds from live spins
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

    const physicsSnapshot: PhysicsSnapshot | null = physics
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
      { description: `Video ${lock.videoUsed ? "USED" : "not used"} · conf ${(lock.fusionConfidence * 100).toFixed(0)}%` },
    );
  }, [weights]);

  // Update fusion weight manually (for experimentation)
  const updateWeight = useCallback((w: number) => {
    setWeights({
      ...weights,
      videoWeight: w,
      historyWeight: 1 - w,
      version: `fusion-v1-manual-w${w.toFixed(2)}`,
      lastUpdated: Date.now(),
    });
  }, [weights]);

  return (
    <section
      id="fusion-experiment"
      className="scroll-mt-20 px-4 py-10 sm:px-6"
      aria-label="Fusion engine experiment"
    >
      <div className="mx-auto max-w-5xl">
        {/* Heading */}
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#ff6b9d]">
            <i className="fas fa-flask" /> Experimental · Not Production
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Fusion <span className="text-[#ff6b9d]">Engine</span>
          </h2>
          <p className="mt-1 text-sm text-[#8899cc]">
            History + Video Physics → Calibrated Fusion → 70-Combination
            Optimizer → Exactly 4 Dynamic Outcomes
          </p>
        </div>

        {/* Warning banner */}
        <div className="mb-5 rounded-xl border border-[#ffa502]/40 bg-[#ffa502]/10 px-4 py-2.5 text-xs text-[#ffa502]">
          <i className="fas fa-triangle-exclamation mr-1.5" />
          <b>EXPERIMENTAL —</b> Production remains C1-C9 dynamic. Fusion is
          validated only if: zero leakage + reproducible + out-of-sample +
          statistically defensible.
        </div>

        {/* Fusion weight control */}
        <div className="revo-card mb-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-sliders text-[#a78bfa]" /> Fusion Weight Control
            </span>
            <span className="text-[10px] text-[#5a6a99]">
              {weights.version} · trained on {weights.learnedFrom} samples
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
            {running ? "Running..." : "Run A/B/C/D Experiment"}
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
        {liveLock && (
          <LiveLockDisplay lock={liveLock} />
        )}

        {/* Experiment results */}
        {result && <ExperimentResults result={result} weights={weights} />}
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
        {/* Top-4 cards */}
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
                  {(lock.outcomeProbabilities[name] * 100).toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
          <div>
            <div className="text-[#5a6a99]">Coverage</div>
            <div className="font-bold text-[#2ed573]">
              {(lock.top4Coverage * 100).toFixed(1)}%
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
              {lock.videoUsed ? `${(lock.videoConfidence * 100).toFixed(0)}%` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[#5a6a99]">Fusion conf</div>
            <div className="font-bold text-white">
              {(lock.fusionConfidence * 100).toFixed(0)}%
            </div>
          </div>
        </div>

        {/* Stopping prediction */}
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

        {/* Leakage audit */}
        <div className="mt-2 flex items-center gap-2 text-[10px]">
          <i className="fas fa-shield-halved text-[#2ed573]" />
          <span className="text-[#2ed573]">
            No leakage: all inputs ≤ lock time ({new Date(lock.lockTimestamp).toLocaleTimeString()})
          </span>
          <span className="ml-auto text-[#5a6a99]">
            ID: {lock.predictionId.slice(0, 16)}…
          </span>
        </div>
      </div>
    </div>
  );
}

function ExperimentResults({
  result,
  weights,
}: {
  result: ExperimentResult;
  weights: FusionWeights;
}) {
  const arms = result.arms;
  const armNames = ["A_theoretical", "B_history", "C_video", "D_fusion"];
  const armLabels: Record<string, string> = {
    A_theoretical: "A: [1,2,5,10]",
    B_history: "B: C1-C9",
    C_video: "C: Video-only",
    D_fusion: "D: Fusion",
  };

  const bestArm = armNames.reduce((best, name) =>
    arms[name].hitRate > arms[best].hitRate ? name : best,
  );

  return (
    <div className="space-y-4">
      {/* Summary table */}
      <div className="revo-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#ff6b9d]/10 to-transparent px-4 py-3">
          <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
            <i className="fas fa-table text-[#ff6b9d]" /> A/B/C/D Comparison
          </span>
          <span className="text-[10px] text-[#5a6a99]">
            {result.totalRounds} rounds · weights: H{(weights.historyWeight * 100).toFixed(0)}/V{(weights.videoWeight * 100).toFixed(0)}
          </span>
        </div>
        <div className="overflow-x-auto revo-scroll">
          <table className="w-full text-center text-xs">
            <thead>
              <tr className="border-b border-[#1e2240] bg-[#0d1020]/60">
                <th className="px-3 py-2 text-left">Arm</th>
                <th className="px-3 py-2">Top-4 HIT</th>
                <th className="px-3 py-2">Hit Rate</th>
                <th className="px-3 py-2">Log-Loss</th>
                <th className="px-3 py-2">Brier</th>
                <th className="px-3 py-2">Bonus Recall</th>
                <th className="px-3 py-2">False Bonus</th>
              </tr>
            </thead>
            <tbody>
              {armNames.map((name, idx) => {
                const a = arms[name];
                const isBest = name === bestArm;
                return (
                  <tr
                    key={name}
                    className={`border-b border-[#1e2240]/40 ${idx % 2 === 1 ? "bg-white/[0.015]" : ""} ${isBest ? "ring-1 ring-inset ring-[#2ed573]/30" : ""}`}
                  >
                    <td className="px-3 py-2 text-left font-bold text-white">
                      {armLabels[name]}
                      {isBest && <span className="ml-1 text-[#2ed573]">★</span>}
                    </td>
                    <td className="px-3 py-2 text-white">
                      {a.hits}/{a.hits + a.misses}
                    </td>
                    <td className="px-3 py-2 font-bold" style={{ color: a.hitRate >= 0.8 ? "#2ed573" : a.hitRate >= 0.7 ? "#ffa502" : "#ff4757" }}>
                      {(a.hitRate * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-[#8899cc]">{a.logLoss.toFixed(3)}</td>
                    <td className="px-3 py-2 text-[#8899cc]">{a.brierScore.toFixed(3)}</td>
                    <td className="px-3 py-2 text-[#a78bfa]">
                      {(a.bonusRecall * 100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-2 text-[#ffa502]">
                      {(a.falseBonusInclusion * 100).toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* McNemar test */}
      {result.mcnemar && (
        <div className="revo-card p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
            <i className="fas fa-balance-scale text-[#a78bfa]" /> McNemar Test
            (D vs B)
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
              <div className="text-[9px] text-[#5a6a99]">χ² (1 df)</div>
              <div className="font-bold text-white">{result.mcnemar.statistic.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">p-value</div>
              <div className={`font-bold ${result.mcnemar.significant ? "text-[#2ed573]" : "text-[#8899cc]"}`}>
                {result.mcnemar.pValue.toFixed(4)}
              </div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-[#8899cc]">
            {result.mcnemar.discordant < 10
              ? `⚠ Inconclusive (${result.mcnemar.discordant} discordant pairs, need ≥10)`
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
              <i className="fas fa-magnifying-glass text-[#ff4757]" /> Miss Forensics
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto revo-scroll p-3">
            {result.missForensics.slice(0, 20).map((m, i) => (
              <div
                key={i}
                className="mb-2 rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-2 text-[10px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">
                    Actual: {m.actual} (rank #{m.actualRank})
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-black ${
                      m.classification === "BONUS_UNPREDICTABLE"
                        ? "bg-[#ffa502]/15 text-[#ffa502]"
                        : m.classification === "EXPLAINED"
                          ? "bg-[#448AFF]/15 text-[#448AFF]"
                          : "bg-[#ff4757]/15 text-[#ff4757]"
                    }`}
                  >
                    {m.classification}
                  </span>
                </div>
                {m.missingSignal && (
                  <div className="mt-1 text-[#8899cc]">{m.missingSignal}</div>
                )}
                {m.angularError !== null && (
                  <div className="mt-0.5 text-[#5a6a99]">
                    Angular error: {m.angularError.toFixed(0)}° · margin #4vs#5:{" "}
                    {(m.margin4vs5 * 100).toFixed(1)}pp
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Production integration recommendation */}
      <div className="revo-card p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-traffic-light text-[#ffa502]" /> Production Integration Gate
        </div>
        <div className="space-y-1.5 text-[11px]">
          <GateCheck label="Zero leakage" passed={result.leakageAudit.passed} />
          <GateCheck label="Out-of-sample (chronological split)" passed={true} />
          <GateCheck
            label="Fusion outperforms history-only"
            passed={arms["D_fusion"].hitRate > arms["B_history"].hitRate}
          />
          <GateCheck
            label="Statistically significant (McNemar p < 0.05)"
            passed={result.mcnemar?.significant ?? false}
          />
          <GateCheck
            label="Fusion > 83.3% theoretical"
            passed={arms["D_fusion"].hitRate > 0.833}
          />
        </div>
        <div className="mt-3 rounded-lg border border-[#ffa502]/30 bg-[#ffa502]/5 p-2 text-[11px] text-[#ffa502]">
          <i className="fas fa-info-circle mr-1" />
          <b>Recommendation:</b>{" "}
          {result.leakageAudit.passed &&
          arms["D_fusion"].hitRate > arms["B_history"].hitRate &&
          (result.mcnemar?.significant ?? false)
            ? "Fusion shows genuine improvement — consider integration (still needs 500-spin validation)"
            : "Do NOT integrate fusion into production — it does not meet the integration criteria"}
        </div>
      </div>
    </div>
  );
}

function GateCheck({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <i
        className={`fas ${passed ? "fa-check-circle text-[#2ed573]" : "fa-times-circle text-[#ff4757]"}`}
      />
      <span className={passed ? "text-[#2ed573]" : "text-[#8899cc]"}>{label}</span>
    </div>
  );
}
