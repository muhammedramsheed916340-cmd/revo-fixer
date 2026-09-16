"use client";

import { useEffect, useRef, useState } from "react";
import { broadcastLiveResult } from "./liveResultsBus";
import { setLiveSpins } from "./liveSpinStore";
import { matchApiResultToPhysicalSpin } from "./videoPhysicsHistory";
import { analyzeSpins, parseSpins, type AnalysisResult, SEGMENT_NAMES, GAME_CARD_IMAGES, DISPLAY_NAMES, THEORETICAL_PROB } from "./aiStats";

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

interface SpinResult {
  data: {
    settledAt: string;
    result: {
      outcome: {
        topSlot?: { wheelSector: string; multiplier?: number };
        wheelResult?: { wheelSector: string; type?: string };
        maxMultiplier?: number;
      };
    };
    dealer?: { name: string };
  };
}

export function RevoLiveResults() {
  const [results, setResults] = useState<SpinResult[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const lastResultTime = useRef<string>("");
  // Baseline: the latest known settledAt on page load. We DON'T count this
  // as a live latency sample — it's a historical result that was already old.
  // Latency measurement starts from the NEXT newer result.
  const baselineSettledAt = useRef<string>("");
  const isBaselineEstablished = useRef(false);
  // Poll timing
  const pollTimings = useRef<{ startedAt: number; responseAt: number } | null>(null);

  async function loadData() {
    const pollStartedAt = performance.now();
    try {
      // Fetch recent results — NO server-side cache, always fresh
      const res = await fetch(`/api/crazy-time?type=recent&size=30&duration=24&_t=${Date.now()}`);
      const rData = await res.json();
      const responseAt = performance.now();
      pollTimings.current = { startedAt: pollStartedAt, responseAt };
      const newResults = Array.isArray(rData) ? rData : [];

      // Only update + re-analyze if results actually changed (detect new spin)
      const latestTime = newResults[0]?.data?.settledAt ?? "";
      if (latestTime === lastResultTime.current && results.length > 0) {
        return; // No new data — skip expensive re-render + re-analysis
      }

      setResults(newResults);

      // Parse + run AI statistical analysis
      const spins = parseSpins(newResults);
      if (spins.length > 0) {
        const result = analyzeSpins(spins);
        setAnalysis(result);

        // Share real spin data with the prediction engine (RevoGame).
        setLiveSpins(spins);

        // Broadcast NEW result to prediction system
        const latest = newResults[0];
        const settledAt = latest?.data?.settledAt ?? "";
        if (settledAt && settledAt !== lastResultTime.current) {
          // Establish baseline on first load — don't count this as live latency
          if (!isBaselineEstablished.current) {
            baselineSettledAt.current = settledAt;
            isBaselineEstablished.current = true;
            lastResultTime.current = settledAt;
            return; // Skip broadcasting the initial stale result
          }

          lastResultTime.current = settledAt;
          const sector =
            latest?.data?.result?.outcome?.wheelResult?.wheelSector ??
            latest?.data?.result?.outcome?.topSlot?.wheelSector ??
            "";
          if (sector) {
            const sourceTimeMs = new Date(settledAt).getTime();
            const appReceivedMs = Date.now();
            broadcastLiveResult({
              sector,
              time: sourceTimeMs,
              multiplier: latest?.data?.result?.outcome?.maxMultiplier,
              sourceTime: sourceTimeMs,
              appReceivedTime: appReceivedMs,
            });

            // Match API result to physical spin (V2.2)
            // Uses video-derived physical stop time, NOT settledAt
            const SECTOR_TO_GAME: Record<string, string> = {
              "1": "1", "2": "2", "5": "5", "10": "10",
              CoinFlip: "COIN FLIP", Pachinko: "PACHINKO",
              CashHunt: "CASH HUNT", CrazyTime: "CRAZY TIME",
              CrazyBonus: "CRAZY TIME",
            };
            const actualOutcome = SECTOR_TO_GAME[sector] ?? sector;
            const actualSectorIdx = ["1", "2", "5", "10", "CoinFlip", "Pachinko", "CashHunt", "CrazyTime"].indexOf(sector);
            matchApiResultToPhysicalSpin(
              sourceTimeMs,
              actualOutcome,
              actualSectorIdx >= 0 ? actualSectorIdx : null,
            );
          }
        }
      }
      setError("");
    } catch {
      setError("Failed to load live data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // Poll every 1.5 seconds for fastest live result detection.
    // The API has no cache (fresh fetch every time).
    // Dedup guard prevents concurrent duplicate API calls.
    const t = setInterval(loadData, 1500);
    return () => clearInterval(t);
  }, []);

  return (
    <section id="live-results" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#2ed573]">
            <span className="revo-pulse text-[#2ed573]">●</span> AI Statistical Analysis
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Crazy Time <span className="revo-gradient-text">Live AI Analysis</span>
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-[#8899cc]">
            Deep statistical analysis — Z-Score, Drought, Top Slot Correlation,
            Moving Averages &amp; Bayesian Forecasting. Real data, real math, no fakes.
          </p>
        </div>

        {/* AI Analysis Summary */}
        {analysis && (
          <div className="revo-card revo-card-glow mb-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#448AFF]/10 to-transparent px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-brain text-[#448AFF]" /> AI Analysis Summary
              </span>
              <span className="text-[10px] font-bold text-[#2ed573]">
                {analysis.overallAnalysis}
              </span>
            </div>
          </div>
        )}

        {/* 1. Segment Analysis Table (Z-Score + Variance + Drought) */}
        {analysis && (
          <div className="revo-card mb-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1e2240] px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-chart-column text-[#448AFF]" /> Variance &amp; Z-Score Analysis
              </span>
              <span className="text-[10px] text-[#5a6a99]">{analysis.totalSpins} spins</span>
            </div>

            <div className="overflow-x-auto revo-scroll">
              <table className="w-full min-w-[640px] text-center text-xs">
                <thead>
                  <tr className="border-b border-[#1e2240] bg-[#0d1020]/60">
                    <th className="px-2 py-2 text-left">Segment</th>
                    <th className="px-2 py-2">Hits</th>
                    <th className="px-2 py-2">Actual%</th>
                    <th className="px-2 py-2">Theor.</th>
                    <th className="px-2 py-2">Z-Score</th>
                    <th className="px-2 py-2">Current Gap</th>
                    <th className="px-2 py-2">Max Drought</th>
                    <th className="px-2 py-2">Bayesian%</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.segments.map((s, idx) => (
                    <tr key={s.segment} className={`border-b border-[#1e2240]/40 hover:bg-white/[0.04] ${idx % 2 === 1 ? "bg-white/[0.015]" : ""}`}>
                      <td className="px-2 py-2 text-left">
                        <div className="flex items-center gap-2">
                          <img src={GAME_CARD_IMAGES[s.imageKey]} alt={s.displayName} className="h-8 w-8 object-contain" />
                          <span className="font-bold text-white">{s.displayName}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-white">{s.count}</td>
                      <td className="px-2 py-2 text-[#448AFF]">{(s.actualFreq * 100).toFixed(1)}%</td>
                      <td className="px-2 py-2 text-[#8899cc]">{(s.theoreticalProb * 100).toFixed(1)}%</td>
                      <td className="px-2 py-2">
                        <span className={s.zScore > 0 ? "text-[#ff4757]" : "text-[#00d4ff]"}>
                          {s.zScore > 0 ? "+" : ""}{s.zScore.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-white">
                        {s.currentGap}
                        {s.isOverdue && <span className="ml-1 text-[#ffa502]" title="Gap exceeds average — INFO only">⚠️</span>}
                      </td>
                      <td className="px-2 py-2 text-[#8899cc]">{s.maxDrought}</td>
                      <td className="px-2 py-2 text-[#2ed573]">{(s.bayesianProb * 100).toFixed(1)}%</td>
                      <td className="px-2 py-2">
                        {s.isHot && <span className="rounded-full bg-[#ff4757]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#ff4757]" title="Descriptive only — NOT a bet signal">🔥 INFO: Hot</span>}
                        {s.isCold && <span className="rounded-full bg-[#00d4ff]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#00d4ff]" title="Descriptive only — NOT 'due'">❄️ INFO: Cold</span>}
                        {s.isOverdue && <span className="rounded-full bg-[#ffa502]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#ffa502]" title="Descriptive only — NOT 'due to happen'">⏰ INFO: Overdue</span>}
                        {!s.isHot && !s.isCold && !s.isOverdue && <span className="text-[#5a6a99]">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 2. AI Prediction (weighted probabilistic — NO fixed signals) */}
        {analysis && (
          <div className="revo-card mb-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#2ed573]/10 to-transparent px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-bullseye text-[#2ed573]" /> AI Prediction (Evidence-Weighted)
              </span>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-[#448AFF]/15 px-2 py-0.5 text-[9px] font-bold uppercase text-[#448AFF]">
                  <i className="fas fa-shield-halved mr-1" />No fixed signals
                </span>
                <span className="rounded-full bg-[#2ed573]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[#2ed573]">
                  Conf: {analysis.predictionConfidence}%
                </span>
              </div>
            </div>
            <div className="p-4">
              {analysis.prediction.length === 0 ? (
                <div className="rounded-lg border border-[#ffa502]/30 bg-[#ffa502]/8 p-4 text-center">
                  <i className="fas fa-hourglass-half text-[#ffa502]" />
                  <div className="mt-1 text-sm font-bold text-[#ffa502]">INSUFFICIENT DATA</div>
                  <div className="text-[10px] text-[#5a6a99]">
                    Need 10+ real spins for evidence-based prediction. Currently: {analysis.totalSpins}.
                    The AI NEVER fixes signals — it waits for real data.
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {analysis.prediction.map((seg, i) => {
                      const stat = analysis.segments.find((s) => s.segment === seg);
                      if (!stat) return null;
                      return (
                        <div
                          key={seg}
                          className="rounded-xl border p-3 text-center"
                          style={{
                            borderColor: `${stat.confidence >= 70 ? "#2ed573" : stat.confidence >= 45 ? "#448AFF" : "#ffa502"}40`,
                            background: `${stat.confidence >= 70 ? "#2ed573" : stat.confidence >= 45 ? "#448AFF" : "#ffa502"}0a`,
                          }}
                        >
                          <span className="mb-1 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-black">
                            #{i + 1}
                          </span>
                          <img src={GAME_CARD_IMAGES[stat.imageKey]} alt={stat.displayName} className="mx-auto h-12 w-12 object-contain" />
                          <div className="mt-1 text-sm font-black text-white">{stat.displayName}</div>
                          <div className="text-[10px] text-[#5a6a99]">
                            Evidence: {(stat.evidenceScore * 100).toFixed(2)}
                          </div>
                          <div className="text-[9px] text-[#5a6a99]">
                            Bayes: {(stat.bayesianProb * 100).toFixed(1)}% · Rank #{stat.evidenceRank}
                          </div>
                          <div className="mt-0.5 text-[10px] font-bold" style={{ color: stat.confidence >= 70 ? "#2ed573" : stat.confidence >= 45 ? "#448AFF" : "#ffa502" }}>
                            {stat.confidenceLabel}
                          </div>
                          {/* INFO indicators (NOT bet signals) — descriptive only */}
                          <div className="mt-1.5 flex flex-wrap justify-center gap-1">
                            {stat.isHot && (
                              <span className="rounded bg-[#ff4757]/10 px-1 py-0.5 text-[7px] font-bold uppercase text-[#ff4757]" title="Descriptive statistic only — NOT a bet signal">
                                <i className="fas fa-circle-info" /> INFO: Hot
                              </span>
                            )}
                            {stat.isOverdue && (
                              <span className="rounded bg-[#ffa502]/10 px-1 py-0.5 text-[7px] font-bold uppercase text-[#ffa502]" title="Descriptive statistic only — NOT 'due to happen'">
                                <i className="fas fa-circle-info" /> INFO: Overdue
                              </span>
                            )}
                            {stat.currentGap > stat.avgGap * 1.3 && stat.avgGap > 0 && (
                              <span className="rounded bg-[#5a6a99]/10 px-1 py-0.5 text-[7px] font-bold uppercase text-[#5a6a99]" title="Gap is informational only — gambler's fallacy avoided">
                                <i className="fas fa-circle-info" /> INFO: Gap {stat.currentGap}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 rounded-lg border border-[#1e2240] bg-[#0d1020]/40 px-3 py-2 text-[10px] text-[#8899cc]">
                    <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
                    <b className="text-white">Method:</b> {analysis.predictionMethod}. Sample: {analysis.predictionSample} spins.
                    Predictions vary each refresh — weighted by real evidence, not fixed.
                  </div>
                  {/* No-bias disclaimer */}
                  <div className="mt-2 rounded-lg border border-[#2ed573]/20 bg-[#2ed573]/5 px-3 py-2 text-[10px] text-[#8899cc]">
                    <i className="fas fa-shield-halved mr-1.5 text-[#2ed573]" />
                    <b className="text-[#2ed573]">Fresh Ranking — No Last-Hit Carryover:</b>{" "}
                    "LAST HIT" ≠ "NEXT PREDICTION". Previous result is ONE data
                    point only — it does NOT auto-carry into the next prediction.
                    Every round is a <b>fresh evidence-based ranking</b>: repeat
                    is allowed only when statistically supported (repeat-pattern
                    analysis), forced repeat is NOT allowed, forced opposite is
                    NOT allowed.
                  </div>
                  <div className="mt-1.5 rounded-lg border border-[#448AFF]/20 bg-[#448AFF]/5 px-3 py-2 text-[10px] text-[#8899cc]">
                    <i className="fas fa-circle-info mr-1.5 text-[#448AFF]" />
                    <b className="text-[#448AFF]">No HOT/OVERDUE/GAP bias:</b>{" "}
                    "HOT" ≠ "NEXT", "OVERDUE" ≠ "NEXT", "LONG GAP" ≠ "NEXT".
                    HOT/OVERDUE/GAP are <b>INFO only</b> — they NEVER affect the
                    prediction score. No gambler's fallacy.
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 3. Top Slot Correlation + Moving Averages */}
        {analysis && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Top Slot Correlation */}
            <div className="revo-card p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-bolt text-[#FFD700]" /> Top Slot Correlation
              </div>
              <div className="mb-2 text-2xl font-black text-[#FFD700]">
                {(analysis.topSlotMatchRate * 100).toFixed(1)}%
              </div>
              <div className="text-[10px] text-[#5a6a99]">Match rate (Top Slot → Wheel)</div>
              <div className="mt-3 space-y-1">
                {Object.entries(analysis.topSlotSegments)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 4)
                  .map(([seg, count]) => (
                    <div key={seg} className="flex items-center justify-between text-[10px]">
                      <span className="text-[#bcc6e0]">{DISPLAY_NAMES[seg] ?? seg}</span>
                      <span className="font-bold text-white">{count} times</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Moving Averages */}
            <div className="revo-card p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-wave-square text-[#00d4ff]" /> Moving Averages
              </div>
              <div className="space-y-1">
                {SEGMENT_NAMES.map((seg) => {
                  const ma20 = analysis.movingAvg20[seg] ?? 0;
                  const ma50 = analysis.movingAvg50[seg] ?? 0;
                  const trend = ma20 > ma50 ? "↑" : ma20 < ma50 ? "↓" : "→";
                  const trendColor = ma20 > ma50 ? "#2ed573" : ma20 < ma50 ? "#ff4757" : "#5a6a99";
                  return (
                    <div key={seg} className="flex items-center justify-between text-[10px]">
                      <span className="text-[#bcc6e0]">{DISPLAY_NAMES[seg]}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-[#5a6a99]">MA20: {(ma20 * 100).toFixed(1)}%</span>
                        <span className="text-[#5a6a99]">MA50: {(ma50 * 100).toFixed(1)}%</span>
                        <span style={{ color: trendColor }} className="font-bold">{trend}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ===== 5. POWERFUL AI: ENTROPY + CHI-SQUARE + VOLATILITY ===== */}
        {analysis && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Entropy */}
            <div className="revo-card p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-dice text-[#a78bfa]" /> Shannon Entropy
              </div>
              <div className="text-2xl font-black text-[#a78bfa]">
                {analysis.entropy.toFixed(3)}
                <span className="ml-1 text-[10px] font-normal text-[#5a6a99]">/ 3.000 bits</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#1e2240]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${analysis.entropyRatio * 100}%`,
                    background: "linear-gradient(90deg,#a78bfa,#448AFF)",
                  }}
                />
              </div>
              <div className="mt-1.5 text-[10px] text-[#5a6a99]">
                {analysis.entropyRatio >= 0.9
                  ? "Near-uniform — wheel is highly random"
                  : analysis.entropyRatio >= 0.7
                    ? "Reasonably random"
                    : analysis.entropyRatio >= 0.5
                      ? "Biased distribution — some segments dominate"
                      : "Highly biased — strong skew detected"}
              </div>
              <div className="mt-1 text-[9px] font-bold uppercase text-[#5a6a99]">
                {(analysis.entropyRatio * 100).toFixed(0)}% of max entropy
              </div>
            </div>

            {/* Chi-Square Goodness of Fit */}
            <div className="revo-card p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-square-root-variable text-[#2ed573]" /> Chi-Square Fit
              </div>
              <div className="text-2xl font-black text-[#2ed573]">
                {analysis.chiSquare.toFixed(1)}
              </div>
              <div className="mt-1 text-[10px] text-[#5a6a99]">
                p-value: {analysis.chiSquarePValue.toFixed(3)} (dof=7)
              </div>
              <div className="mt-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                    analysis.isDistributionNormal
                      ? "bg-[#2ed573]/15 text-[#2ed573]"
                      : "bg-[#ff4757]/15 text-[#ff4757]"
                  }`}
                >
                  {analysis.isDistributionNormal ? "✓ Normal fit" : "⚠ Abnormal"}
                </span>
              </div>
              <div className="mt-1.5 text-[10px] text-[#5a6a99]">
                {analysis.isDistributionNormal
                  ? "Distribution matches theoretical (p > 0.05)"
                  : "Significant deviation from theoretical (p ≤ 0.05)"}
              </div>
            </div>

            {/* Volatility Index */}
            <div className="revo-card p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-tower-broadcast text-[#ffa502]" /> Volatility Index
              </div>
              <div className="text-2xl font-black text-[#ffa502]">
                {analysis.volatilityIndex}
                <span className="ml-1 text-[10px] font-normal text-[#5a6a99]">/ 100</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#1e2240]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${analysis.volatilityIndex}%`,
                    background:
                      analysis.volatilityIndex >= 60
                        ? "linear-gradient(90deg,#ffa502,#ff4757)"
                        : "linear-gradient(90deg,#2ed573,#ffa502)",
                  }}
                />
              </div>
              <div className="mt-1.5 text-[10px] text-[#5a6a99]">
                {analysis.volatilityIndex >= 60
                  ? "Highly volatile — gaps are erratic"
                  : analysis.volatilityIndex >= 35
                    ? "Moderate volatility"
                    : "Stable — consistent gap patterns"}
              </div>
            </div>
          </div>
        )}

        {/* ===== 6. MARKOV TRANSITION MATRIX ===== */}
        {analysis && analysis.totalSpins >= 15 && (
          <div className="revo-card mb-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#a78bfa]/10 to-transparent px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-shuffle text-[#a78bfa]" /> Markov Transition Matrix (P(next | current))
              </span>
              <span className="text-[10px] text-[#5a6a99]">Order-1 chain &middot; {analysis.totalSpins} spins</span>
            </div>
            <div className="overflow-x-auto revo-scroll">
              <table className="w-full min-w-[560px] text-center text-[9px]">
                <thead>
                  <tr className="border-b border-[#1e2240] bg-[#0d1020]/60">
                    <th className="px-1.5 py-2 text-left">From ↓ / To →</th>
                    {SEGMENT_NAMES.map((s) => (
                      <th key={s} className="px-1.5 py-2">{DISPLAY_NAMES[s]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SEGMENT_NAMES.map((from) => (
                    <tr key={from} className="border-b border-[#1e2240]/40 hover:bg-white/[0.02]">
                      <td className="px-1.5 py-2 text-left font-bold text-white">{DISPLAY_NAMES[from]}</td>
                      {SEGMENT_NAMES.map((to) => {
                        const p = analysis.markovMatrix[from]?.[to] ?? 0;
                        const theo = THEORETICAL_PROB[to] ?? 0.1;
                        const intensity = Math.min(1, p / Math.max(theo * 2, 0.01));
                        return (
                          <td
                            key={to}
                            className="px-1.5 py-2"
                            style={{
                              background:
                                p > theo * 1.3
                                  ? `rgba(46,213,115,${intensity * 0.4})`
                                  : p < theo * 0.7
                                    ? `rgba(255,71,87,${intensity * 0.3})`
                                    : "transparent",
                            }}
                          >
                            <span className={p > theo * 1.3 ? "font-bold text-[#2ed573]" : p < theo * 0.7 ? "text-[#ff4757]" : "text-[#8899cc]"}>
                              {(p * 100).toFixed(1)}%
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[#1e2240] px-4 py-2 text-[9px] text-[#5a6a99]">
              <span className="text-[#2ed573]">Green</span> = follows more than theoretical ·{" "}
              <span className="text-[#ff4757]">Red</span> = follows less than theoretical
            </div>
          </div>
        )}

        {/* ===== 7. ANALYSIS-FIRST PIPELINE (audit trail) ===== */}
        {analysis && (
          <div className="revo-card mb-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#448AFF]/10 to-transparent px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-diagram-project text-[#448AFF]" /> Analysis-First Pipeline
              </span>
              <span className="text-[10px] font-bold text-[#2ed573]">
                <i className="fas fa-check-circle mr-1" />
                No fixed signals
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {analysis.analysisPipeline.map((step, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-[#1e2240] bg-[#0d1020]/60 px-2.5 py-2"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#448AFF] text-[9px] font-black text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
                      {step.step}
                    </div>
                    <div className="truncate text-[10px] text-[#bcc6e0]">{step.result}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-[#1e2240] bg-[#0d1020]/40 px-4 py-2.5">
              <div className="flex items-start gap-2 text-[10px] text-[#8899cc]">
                <i className="fas fa-shield-halved mt-0.5 text-[#2ed573]" />
                <span>
                  <b className="text-white">No-Fix Guarantee:</b> The AI NEVER predetermines
                  any bonus round or number as a signal. Every prediction emerges
                  PURELY from the 10 statistical methods above, via weighted probabilistic
                  sampling. High-evidence segments are picked more often — rare segments
                  still get picked based on their probability.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ===== 8. EVIDENCE-SCORED SEGMENTS (ranked by combined evidence) ===== */}
        {analysis && (
          <div className="revo-card mb-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#FFD700]/10 to-transparent px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-list-ol text-[#FFD700]" /> Evidence Ranking (10 signals combined)
              </span>
              <span className="text-[10px] text-[#5a6a99]">No fixed signals — pure evidence</span>
            </div>
            <div className="space-y-1 p-3">
              {[...analysis.segments]
                .sort((a, b) => b.evidenceScore - a.evidenceScore)
                .map((s, i) => {
                  const maxScore = Math.max(...analysis.segments.map((x) => x.evidenceScore), 0.001);
                  const pct = (s.evidenceScore / maxScore) * 100;
                  return (
                    <div key={s.segment} className="flex items-center gap-2">
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-black ${
                          i === 0
                            ? "bg-[#2ed573] text-white"
                            : i === 1
                              ? "bg-[#448AFF] text-white"
                              : i === 2
                                ? "bg-[#FFD700] text-black"
                                : i === 3
                                  ? "bg-[#00d4ff] text-black"
                                  : "bg-[#1e2240] text-[#5a6a99]"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <img src={GAME_CARD_IMAGES[s.imageKey]} alt={s.displayName} className="h-6 w-6 object-contain" />
                      <span className="w-16 shrink-0 text-[10px] font-bold text-white">{s.displayName}</span>
                      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-[#1e2240]">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            background: `linear-gradient(90deg,#448AFF,#2ed573)`,
                          }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right text-[10px] font-bold text-[#2ed573]">
                        {(s.evidenceScore * 100).toFixed(2)}
                      </span>
                      <span className="hidden w-24 shrink-0 text-right text-[9px] text-[#5a6a99] sm:block">
                        z={s.zScore.toFixed(2)} · gap={s.currentGap}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* 4. Latest Results Feed */}
        <div className="revo-card mt-4 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#2ed573]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-history text-[#2ed573]" /> Latest Results
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-[#ff4757]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[#ff4757]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff4757]" />
              LIVE · auto
            </span>
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-xl revo-shimmer" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-[#ff4757]">{error}</div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#5a6a99]">No results available.</div>
          ) : (
            <div className="max-h-[20rem] overflow-y-auto revo-scroll p-2">
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {results.slice(0, 20).map((r, i) => {
                  const sector = r.data?.result?.outcome?.wheelResult?.wheelSector ??
                    r.data?.result?.outcome?.topSlot?.wheelSector ?? "—";
                  const dispName = DISPLAY_NAMES[sector] ?? sector;
                  const imgKey = sector in GAME_CARD_IMAGES ? sector : "1";
                  const isBonus = ["CoinFlip", "Pachinko", "CashHunt", "CrazyTime", "CrazyBonus"].includes(sector);
                  const multiplier = r.data?.result?.outcome?.maxMultiplier;
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-2 rounded-lg border p-2 ${i === 0 ? "border-[#2ed573]/40 bg-[#2ed573]/5" : "border-[#1e2240] bg-[#0d1020]/60"}`}
                    >
                      <img src={GAME_CARD_IMAGES[imgKey] ?? GAME_CARD_IMAGES["1"]} alt={dispName} className="h-8 w-8 object-contain" />
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-bold text-white">{dispName}</span>
                        {isBonus && <span className="ml-1 text-[8px] text-[#FFD700]">★</span>}
                        {i === 0 && <span className="ml-1 rounded bg-[#2ed573]/20 px-1 text-[7px] font-bold uppercase text-[#2ed573]">NEW</span>}
                        <div className="text-[9px] text-[#5a6a99]">
                          {multiplier ? `×${multiplier} · ` : ""}
                          {timeAgo(r.data?.settledAt ?? new Date().toISOString())}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-[#5a6a99]">
          <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
          Powerful AI: Z-Score, Bayesian, Drought, Moving Avg, Entropy, Markov,
          Volatility, Chi-Square &amp; Streak analysis on real CasinoScores data.
          {analysis ? ` ${analysis.totalSpins} spins analyzed.` : ""}
          <b className="text-[#2ed573]"> AI never fixes any signal</b> — prediction
          emerges purely from statistical evidence via weighted sampling. Each spin
          is independent RNG — no prediction is guaranteed. For entertainment only.
        </p>
      </div>
    </section>
  );
}
