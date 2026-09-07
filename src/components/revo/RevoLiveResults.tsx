"use client";

import { useEffect, useRef, useState } from "react";
import { broadcastLiveResult } from "./liveResultsBus";
import { analyzeSpins, parseSpins, type AnalysisResult, SEGMENT_NAMES, GAME_CARD_IMAGES, DISPLAY_NAMES } from "./aiStats";

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

  async function loadData() {
    try {
      // Fetch recent results for live analysis (reduced size for speed)
      const res = await fetch("/api/crazy-time?type=recent&size=30&duration=24");
      const rData = await res.json();
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

        // Broadcast NEW result to prediction system
        const latest = newResults[0];
        const settledAt = latest?.data?.settledAt ?? "";
        if (settledAt && settledAt !== lastResultTime.current) {
          lastResultTime.current = settledAt;
          const sector =
            latest?.data?.result?.outcome?.wheelResult?.wheelSector ??
            latest?.data?.result?.outcome?.topSlot?.wheelSector ??
            "";
          if (sector) {
            broadcastLiveResult({
              sector,
              time: new Date(settledAt).getTime(),
              multiplier: latest?.data?.result?.outcome?.maxMultiplier,
            });
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
    // Poll every 4 seconds. The 8s server cache means only ONE external API
    // call happens per 8 seconds regardless of how many clients poll.
    // Stale-while-reFetching returns cached data instantly during fetches.
    const t = setInterval(loadData, 4000);
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
                  {analysis.segments.map((s) => (
                    <tr key={s.segment} className="border-b border-[#1e2240]/40 hover:bg-white/[0.02]">
                      <td className="px-2 py-2 text-left">
                        <div className="flex items-center gap-2">
                          <img src={GAME_CARD_IMAGES[s.imageKey]} alt={s.displayName} className="h-8 w-8 object-contain" />
                          <span className="font-bold text-white">{s.displayName}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-white">{s.count}</td>
                      <td className="px-2 py-2 text-[#448AFF]">{(s.actualFreq * 100).toFixed(1)}%</td>
                      <td className="px-2 py-2 text-[#5a6a99]">{(s.theoreticalProb * 100).toFixed(1)}%</td>
                      <td className="px-2 py-2">
                        <span className={s.zScore > 0 ? "text-[#ff4757]" : "text-[#00d4ff]"}>
                          {s.zScore > 0 ? "+" : ""}{s.zScore.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-white">
                        {s.currentGap}
                        {s.isOverdue && <span className="ml-1 text-[#ffa502]">⚠️</span>}
                      </td>
                      <td className="px-2 py-2 text-[#5a6a99]">{s.maxDrought}</td>
                      <td className="px-2 py-2 text-[#2ed573]">{(s.bayesianProb * 100).toFixed(1)}%</td>
                      <td className="px-2 py-2">
                        {s.isHot && <span className="rounded-full bg-[#ff4757]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#ff4757]">🔥 Hot</span>}
                        {s.isCold && <span className="rounded-full bg-[#00d4ff]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#00d4ff]">❄️ Cold</span>}
                        {s.isOverdue && <span className="rounded-full bg-[#ffa502]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#ffa502]">⏰ Overdue</span>}
                        {!s.isHot && !s.isCold && !s.isOverdue && <span className="text-[#5a6a99]">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 2. AI Prediction (Bayesian + Z-Score based) */}
        {analysis && (
          <div className="revo-card mb-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#2ed573]/10 to-transparent px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-bullseye text-[#2ed573]" /> AI Prediction (Bayesian)
              </span>
              <span className="rounded-full bg-[#2ed573]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[#2ed573]">
                Confidence: {analysis.predictionConfidence}%
              </span>
            </div>
            <div className="p-4">
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
                        Bayes: {(stat.bayesianProb * 100).toFixed(1)}%
                      </div>
                      <div className="text-[10px] font-bold" style={{ color: stat.confidence >= 70 ? "#2ed573" : stat.confidence >= 45 ? "#448AFF" : "#ffa502" }}>
                        {stat.confidenceLabel}
                      </div>
                    </div>
                  );
                })}
              </div>
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
          AI analysis uses Z-Score, Bayesian updating, drought analysis &amp; moving
          averages on real CasinoScores data. {analysis ? `${analysis.totalSpins} spins analyzed.` : ""}
          Each spin is independent RNG — no prediction is guaranteed. For entertainment only.
        </p>
      </div>
    </section>
  );
}
