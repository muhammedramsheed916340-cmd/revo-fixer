"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  runPhysicsValidation,
  classifyMiss,
  type ValidationReport,
  type MissRCA,
  type PhysicsPrediction,
} from "./videoPhysicsPredictor";
import {
  getCurrentSessionSpins,
  getSynchronizedCount,
  getBufferStats,
  getSpinPhase,
  getExperimentSessionId,
  subscribeToBuffer,
  clearAll,
  type PhysicalSpin,
} from "./videoPhysicsHistory";
import { getVideoPhysics } from "./RevoVideoSensor";
import { GAME_CARD_IMAGES } from "./aiStats";

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

export function RevoPhysicsValidation() {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [running, setRunning] = useState(false);

  useBufferVersion();
  const syncCount = getSynchronizedCount();
  const bufferStats = getBufferStats();
  const completedSpins = getCurrentSessionSpins();
  const spinPhase = getSpinPhase();
  const sessionId = getExperimentSessionId();

  const livePhysics = getVideoPhysics();

  const runValidation = () => {
    setRunning(true);
    setReport(null);
    try {
      const spins = getCurrentSessionSpins();
      const matched = spins.filter(s => s.actualOutcome);
      if (matched.length < 3) {
        toast.error(`Need at least 3 matched spins from current session (currently ${matched.length})`);
        setRunning(false);
        return;
      }
      // Run walk-forward validation on CURRENT SESSION spins only
      const result = runPhysicsValidation(spins.map(s => ({
        spinId: s.spinId,
        physicalSpinStart: s.physicalSpinStart,
        physicalSpinStop: s.physicalSpinStop,
        actualOutcome: s.actualOutcome,
        actualSector: s.actualSector,
        preResultSnapshots: s.preResultSnapshots ?? [],
        snapshots: s.snapshots,
        movementStart: s.movementStart,
      })));
      setReport(result);
      toast.success(`Validation complete — ${result.matchedSpins} spins, leakage ${result.leakageAudit.passed ? "PASS" : "FAIL"}`);
    } catch (e) {
      toast.error(`Validation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const handleClear = () => {
    clearAll();
    setReport(null);
    toast.info("All data cleared");
  };

  return (
    <section
      id="physics-validation"
      className="scroll-mt-20 px-4 py-10 sm:px-6"
      aria-label="V2.4 Physics Validation"
    >
      <div className="mx-auto max-w-5xl">
        {/* Heading */}
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#00d4ff]">
            <i className="fas fa-atom" /> V2.4 · Physics Validation
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Video <span className="text-[#00d4ff]">Physics Predictor</span>
          </h2>
          <p className="mt-1 text-sm text-[#8899cc]">
            Pre-stop video physics → 54-sector probability → dynamic Top-4 · No theoretical fallback
          </p>
        </div>

        {/* Warning */}
        <div className="mb-5 rounded-xl border border-[#ffa502]/40 bg-[#ffa502]/10 px-4 py-2.5 text-xs text-[#ffa502]">
          <i className="fas fa-triangle-exclamation mr-1.5" />
          <b>EXPERIMENTAL —</b> Video physics predictor. NOT production. NOT integrated.
          Production remains C1-C9 dynamic Top-4.
        </div>

        {/* Physical Data */}
        <div className="revo-card mb-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-database text-[#00d4ff]" /> Physical Data (Session)
            </span>
            <button
              onClick={handleClear}
              className="rounded-lg border border-[#ff4757]/40 bg-[#ff4757]/10 px-2 py-1 text-[10px] font-bold text-[#ff4757] transition hover:bg-[#ff4757]/20"
            >
              <i className="fas fa-trash mr-1" /> Hard Reset
            </button>
          </div>
          <div className="mb-2 text-[9px] text-[#5a6a99]">
            Session: <span className="font-mono text-[#a78bfa]">{sessionId.slice(0, 8)}…</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <div className="text-[9px] text-[#5a6a99]">Fresh spins</div>
              <div className="font-black text-white">{completedSpins.length}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Matched spins</div>
              <div className="font-black text-[#2ed573]">{syncCount}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Tracking snapshots</div>
              <div className="font-black text-[#a78bfa]">{bufferStats.trackingSnapshots}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Moving snapshots</div>
              <div className="font-black text-[#ff6b9d]">{bufferStats.movingSnapshots}</div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-[#5a6a99]">
            Buffer: {bufferStats.totalSnapshots} snapshots · {(bufferStats.timeSpanSeconds / 60).toFixed(1)} min · Phase: {spinPhase}
          </div>
          {/* preResultSnapshots verification */}
          {completedSpins.length > 0 && (
            <div className="mt-2 text-[10px]">
              <span className="text-[#5a6a99]">preResultSnapshots: </span>
              <span className="font-bold" style={{
                color: completedSpins.every(s => s.preResultSnapshots.length > 0) ? "#2ed573" : "#ff4757",
              }}>
                {completedSpins.filter(s => s.preResultSnapshots.length > 0).length}/{completedSpins.length} spins have data
              </span>
            </div>
          )}
        </div>

        {/* Live Physics */}
        {livePhysics && (
          <div className="revo-card mb-4 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-tachometer-alt text-[#00d4ff]" /> Live Physics State
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <div className="text-[9px] text-[#5a6a99]">Angle</div>
                <div className="font-bold text-white">{livePhysics.angle.toFixed(1)}°</div>
              </div>
              <div>
                <div className="text-[9px] text-[#5a6a99]">Velocity (raw)</div>
                <div className="font-bold" style={{
                  color: Math.abs(livePhysics.velocityRaw) > 100 ? "#2ed573" : "#5a6a99",
                }}>
                  {livePhysics.velocityRaw.toFixed(0)}°/s
                </div>
              </div>
              <div>
                <div className="text-[9px] text-[#5a6a99]">Acceleration</div>
                <div className="font-bold text-[#ffa502]">{livePhysics.acceleration.toFixed(0)}°/s²</div>
              </div>
              <div>
                <div className="text-[9px] text-[#5a6a99]">Tracking conf</div>
                <div className="font-bold" style={{
                  color: livePhysics.confidence > 0.3 ? "#2ed573" : "#ffa502",
                }}>
                  {(livePhysics.confidence * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action */}
        <div className="mb-5 flex gap-2">
          <button
            onClick={runValidation}
            disabled={running}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#00d4ff] to-[#a78bfa] px-4 py-2.5 text-sm font-bold text-white transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          >
            <i className={`fas ${running ? "fa-spinner fa-spin" : "fa-atom"}`} />
            {running ? "Running..." : "Run Physics Validation"}
          </button>
        </div>

        {/* Validation Report */}
        {report && <ValidationReportView report={report} />}
      </div>
    </section>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function ValidationReportView({ report }: { report: ValidationReport }) {
  const allLPs = ["S+2", "S+3", "S+5", "S+7", "S+10", "STOP-5", "STOP-3", "STOP-2", "STOP-1"];

  return (
    <div className="space-y-4">
      {/* Lock-point summary table */}
      <div className="revo-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#00d4ff]/10 to-transparent px-4 py-3">
          <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
            <i className="fas fa-table text-[#00d4ff]" /> Lock-Point Results
          </span>
          <span className="text-[10px] text-[#5a6a99]">{report.modelVersion}</span>
        </div>
        <div className="overflow-x-auto revo-scroll">
          <table className="w-full text-center text-xs">
            <thead>
              <tr className="border-b border-[#1e2240] bg-[#0d1020]/60">
                <th className="px-2 py-2 text-left">Lock</th>
                <th className="px-2 py-2">N</th>
                <th className="px-2 py-2">HIT</th>
                <th className="px-2 py-2">Accuracy</th>
                <th className="px-2 py-2">INSUF</th>
                <th className="px-2 py-2">Bonus</th>
                <th className="px-2 py-2">Num Excl</th>
                <th className="px-2 py-2">Avg Ang Err</th>
                <th className="px-2 py-2">Top-1</th>
                <th className="px-2 py-2">Sector Acc</th>
                <th className="px-2 py-2">σ</th>
              </tr>
            </thead>
            <tbody>
              {allLPs.map((lp) => {
                const s = report.lockPointSummaries[lp];
                if (!s) return null;
                return (
                  <tr key={lp} className="border-b border-[#1e2240]/40 hover:bg-white/[0.02]">
                    <td className="px-2 py-2 text-left font-bold text-white">{lp}</td>
                    <td className="px-2 py-2 text-white">{s.sampleSize}</td>
                    <td className="px-2 py-2 text-[#2ed573]">{s.hits}</td>
                    <td className="px-2 py-2 font-bold" style={{
                      color: s.hitRate > 0.8 ? "#2ed573" : s.hitRate > 0.6 ? "#ffa502" : "#ff4757",
                    }}>
                      {(s.hitRate * 100).toFixed(1)}%
                    </td>
                    <td className="px-2 py-2 text-[#ff4757]">{s.insufficientCount}</td>
                    <td className="px-2 py-2 text-[#a78bfa]">{s.bonusInclusion}</td>
                    <td className="px-2 py-2 text-[#ffa502]">{s.numberExclusion}</td>
                    <td className="px-2 py-2 text-[#8899cc]">
                      {s.avgAngularError !== null ? `${s.avgAngularError.toFixed(0)}°` : "—"}
                    </td>
                    <td className="px-2 py-2 text-[#ff6b9d]">
                      {(s.top1OutcomeAccuracy * 100).toFixed(0)}%
                    </td>
                    <td className="px-2 py-2 text-[#00d4ff]">
                      {(s.sectorAccuracy * 100).toFixed(0)}%
                    </td>
                    <td className="px-2 py-2 text-[#5a6a99]">
                      {s.avgUncertainty.toFixed(0)}°
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Arm comparison */}
      <div className="revo-card p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-balance-scale text-[#a78bfa]" /> Arm Comparison (STOP-3)
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="rounded-lg bg-[#0d1020] p-3 text-center">
            <div className="text-[9px] text-[#5a6a99]">Video Physics</div>
            <div className="text-lg font-black" style={{
              color: report.armComparison.video.hitRate > 0.8 ? "#2ed573" : "#ffa502",
            }}>
              {(report.armComparison.video.hitRate * 100).toFixed(1)}%
            </div>
            <div className="text-[9px] text-[#5a6a99]">
              {report.armComparison.video.hits}/{report.armComparison.video.total}
            </div>
            {report.armComparison.video.insufficient > 0 && (
              <div className="text-[8px] font-bold text-[#ff4757]">
                {report.armComparison.video.insufficient} INSUF
              </div>
            )}
          </div>
          <div className="rounded-lg bg-[#0d1020] p-3 text-center">
            <div className="text-[9px] text-[#5a6a99]">Theoretical [1,2,5,10]</div>
            <div className="text-lg font-black text-[#448AFF]">
              {(report.armComparison.theoretical.hitRate * 100).toFixed(1)}%
            </div>
            <div className="text-[9px] text-[#5a6a99]">
              {report.armComparison.theoretical.hits}/{report.armComparison.theoretical.total}
            </div>
          </div>
          <div className="rounded-lg bg-[#0d1020] p-3 text-center">
            <div className="text-[9px] text-[#5a6a99]">C1-C9 History</div>
            <div className="text-lg font-black text-[#a78bfa]">
              {(report.armComparison.history.hitRate * 100).toFixed(1)}%
            </div>
            <div className="text-[9px] text-[#5a6a99]">
              {report.armComparison.history.hits}/{report.armComparison.history.total}
            </div>
          </div>
        </div>
        <div className="mt-2 text-[10px] text-[#5a6a99]">
          No statistical significance claimed. Raw differences only. McNemar requires 10+ discordant pairs.
        </div>
      </div>

      {/* Angular error distribution */}
      {report.angularErrors.length > 0 && (
        <div className="revo-card p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
            <i className="fas fa-ruler text-[#ffa502]" /> Angular Error Distribution (STOP-3)
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-[9px] text-[#5a6a99]">MAE</div>
              <div className="font-bold text-white">
                {(report.angularErrors.reduce((s, v) => s + v, 0) / report.angularErrors.length).toFixed(0)}°
              </div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">Median</div>
              <div className="font-bold text-white">
                {report.angularErrors.sort((a, b) => a - b)[Math.floor(report.angularErrors.length / 2)].toFixed(0)}°
              </div>
            </div>
            <div>
              <div className="text-[9px] text-[#5a6a99]">P90</div>
              <div className="font-bold text-white">
                {report.angularErrors[Math.floor(report.angularErrors.length * 0.9)]?.toFixed(0) ?? "—"}°
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sensor quality breakdown */}
      <div className="revo-card p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-signal text-[#2ed573]" /> Sensor Quality Breakdown (STOP-3)
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="rounded-lg bg-[#2ed573]/10 p-3 text-center">
            <div className="text-[9px] text-[#2ed573]">HIGH (&gt;50% conf)</div>
            <div className="text-lg font-black text-white">{report.sensorQuality.high.count}</div>
            <div className="text-[9px] text-[#5a6a99]">
              {report.sensorQuality.high.count > 0
                ? `${(report.sensorQuality.high.hitRate * 100).toFixed(0)}% HIT`
                : "—"}
            </div>
          </div>
          <div className="rounded-lg bg-[#ffa502]/10 p-3 text-center">
            <div className="text-[9px] text-[#ffa502]">MEDIUM (20-50%)</div>
            <div className="text-lg font-black text-white">{report.sensorQuality.medium.count}</div>
            <div className="text-[9px] text-[#5a6a99]">
              {report.sensorQuality.medium.count > 0
                ? `${(report.sensorQuality.medium.hitRate * 100).toFixed(0)}% HIT`
                : "—"}
            </div>
          </div>
          <div className="rounded-lg bg-[#ff4757]/10 p-3 text-center">
            <div className="text-[9px] text-[#ff4757]">LOW (&lt;20%)</div>
            <div className="text-lg font-black text-white">{report.sensorQuality.low.count}</div>
            <div className="text-[9px] text-[#5a6a99]">
              {report.sensorQuality.low.count > 0
                ? `${(report.sensorQuality.low.hitRate * 100).toFixed(0)}% HIT`
                : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Leakage audit */}
      <div className={`revo-card p-3 ${report.leakageAudit.passed ? "border-[#2ed573]/40" : "border-[#ff4757]/40"}`}>
        <div className="flex items-center gap-2 text-xs">
          <i className={`fas ${report.leakageAudit.passed ? "fa-check-circle text-[#2ed573]" : "fa-times-circle text-[#ff4757]"}`} />
          <span className="font-bold text-white">Leakage Audit:</span>
          <span className={report.leakageAudit.passed ? "text-[#2ed573]" : "text-[#ff4757]"}>
            {report.leakageAudit.details}
          </span>
        </div>
      </div>

      {/* Miss RCA */}
      {report.missDetails.length > 0 && (
        <div className="revo-card overflow-hidden">
          <div className="border-b border-[#1e2240] bg-gradient-to-r from-[#ff4757]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-magnifying-glass text-[#ff4757]" /> Miss RCA ({report.missDetails.length})
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto revo-scroll p-3">
            {report.missDetails.slice(0, 20).map((m, i) => {
              const rca = classifyMiss(m);
              return <MissRow key={i} rca={rca} />;
            })}
          </div>
        </div>
      )}

      {/* Verdict */}
      <div className="revo-card p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-flag-checkered text-[#ffa502]" /> Assessment
        </div>
        <div className="text-xs text-[#8899cc]">
          <p>
            <b>Video Top-4 accuracy (STOP-3):</b>{" "}
            <span className="font-bold text-white">
              {(report.armComparison.video.hitRate * 100).toFixed(1)}%
            </span>{" "}
            on {report.armComparison.video.total} spins
            {report.armComparison.video.insufficient > 0 && (
              <span className="text-[#ff4757]">
                {" "}({report.armComparison.video.insufficient} insufficient)
              </span>
            )}
          </p>
          <p className="mt-1">
            <b>Theoretical [1,2,5,10]:</b>{" "}
            <span className="font-bold text-[#448AFF]">
              {(report.armComparison.theoretical.hitRate * 100).toFixed(1)}%
            </span>
          </p>
          <p className="mt-1">
            <b>Observed result on {report.matchedSpins} spins; not a guarantee.</b>
          </p>
          <p className="mt-2 text-[10px]">
            Model: {report.modelVersion} · Frozen parameters · No tuning on validation set
          </p>
        </div>
      </div>
    </div>
  );
}

function MissRow({ rca }: { rca: MissRCA }) {
  const classColor: Record<string, string> = {
    SENSOR: "#ffa502",
    TIMING: "#448AFF",
    SECTOR_MAP: "#a78bfa",
    PHYSICS: "#ff4757",
    UNCERTAINTY: "#00d4ff",
    MODEL: "#8899cc",
  };
  const color = classColor[rca.classification] ?? "#8899cc";

  return (
    <div className="mb-2 rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-2 text-[10px]">
      <div className="flex items-center justify-between">
        <span className="font-bold text-white">
          {rca.lockPoint} · actual {rca.actual}
        </span>
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-black"
          style={{ background: `${color}20`, color }}
        >
          {rca.classification}
        </span>
      </div>
      <div className="mt-1 text-[#8899cc]">{rca.explanation}</div>
      <div className="mt-0.5 text-[#5a6a99]">
        v={rca.velocity.toFixed(0)}°/s · decel={rca.deceleration.toFixed(0)}°/s² ·
        conf={(rca.trackingConfidence * 100).toFixed(0)}% ·
        σ={rca.uncertainty.toFixed(0)}°
        {rca.angularError !== null && ` · err=${rca.angularError.toFixed(0)}°`}
      </div>
      {rca.top4.length > 0 && (
        <div className="mt-0.5 text-[#5a6a99]">
          Top-4: [{rca.top4.join(", ")}]
        </div>
      )}
    </div>
  );
}
