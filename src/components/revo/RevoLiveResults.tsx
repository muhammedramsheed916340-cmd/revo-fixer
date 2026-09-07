"use client";

import { useEffect, useState } from "react";

const GAME_CARD_IMAGES: Record<string, string> = {
  "1": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539269/one-card_r0ffuy.png",
  "2": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539364/two-card_ayl9lu.png",
  "5": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539403/five-card_msp0cr.png",
  "10": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539416/ten-card_cx3cvj.png",
  Pachinko: "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539441/pachiko-card_zxiw7r.png",
  CoinFlip: "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539429/coin-flip-card_kbbg7m.png",
  CashHunt: "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539519/cash-hunt-card_jp8hr3.png",
  CrazyTime: "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539531/crazy-time-card_dftfw3.png",
};

// Map API sector names to display names + image keys
function sectorToDisplay(sector: string): { name: string; imgKey: string; isBonus: boolean } {
  switch (sector) {
    case "1": return { name: "1", imgKey: "1", isBonus: false };
    case "2": return { name: "2", imgKey: "2", isBonus: false };
    case "5": return { name: "5", imgKey: "5", isBonus: false };
    case "10": return { name: "10", imgKey: "10", isBonus: false };
    case "Pachinko": return { name: "PACHINKO", imgKey: "Pachinko", isBonus: true };
    case "CoinFlip": return { name: "COIN FLIP", imgKey: "CoinFlip", isBonus: true };
    case "CashHunt": return { name: "CASH HUNT", imgKey: "CashHunt", isBonus: true };
    case "CrazyTime":
    case "CrazyBonus": return { name: "CRAZY TIME", imgKey: "CrazyTime", isBonus: true };
    default: return { name: sector, imgKey: "1", isBonus: false };
  }
}

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

interface StatItem {
  wheelResult: string;
  count: number;
  percentage: number;
  lastOccurredAt: string;
  lastSeenBefore: number;
  hotFrequencyPercentage: number;
}

export function RevoLiveResults() {
  const [results, setResults] = useState<SpinResult[]>([]);
  const [stats, setStats] = useState<StatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadData() {
    try {
      const [resRes, statsRes] = await Promise.all([
        fetch("/api/crazy-time?type=recent&size=15&duration=24"),
        fetch("/api/crazy-time?type=stats&duration=24"),
      ]);
      const rData = await resRes.json();
      const sData = await statsRes.json();
      setResults(Array.isArray(rData) ? rData : []);
      setStats(sData?.aggStats ?? []);
      setError("");
    } catch {
      setError("Failed to load live results");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const t = setInterval(loadData, 15000); // refresh every 15s
    return () => clearInterval(t);
  }, []);

  const totalCount = stats.reduce((s, st) => s + st.count, 0);

  return (
    <section id="live-results" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#2ed573]">
            <span className="revo-pulse text-[#2ed573]">●</span> Live Results
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Crazy Time <span className="revo-gradient-text">Live Results</span>
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-[#8899cc]">
            Real-time Crazy Time results &amp; statistics — tracked live. Every
            spin outcome, frequency, and bonus trigger updated automatically.
          </p>
        </div>

        {/* Latest Results */}
        <div className="revo-card revo-card-glow overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#2ed573]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-bolt text-[#2ed573]" /> Latest Results
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-[#ff4757]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[#ff4757]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff4757]" />
              LIVE · auto-refresh 15s
            </span>
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 rounded-xl revo-shimmer" />
              ))}
            </div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-[#ff4757]">{error}</div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#5a6a99]">
              No recent results available.
            </div>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto revo-scroll">
              <div className="grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-2">
                {results.map((r, i) => {
                  const sector =
                    r.data?.result?.outcome?.wheelResult?.wheelSector ??
                    r.data?.result?.outcome?.topSlot?.wheelSector ??
                    "—";
                  const disp = sectorToDisplay(sector);
                  const multiplier = r.data?.result?.outcome?.maxMultiplier;
                  const topSlot = r.data?.result?.outcome?.topSlot?.wheelSector;
                  const topSlotMatched = topSlot && topSlot !== sector;

                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-2.5 transition hover:bg-white/[0.02]"
                    >
                      <img
                        src={GAME_CARD_IMAGES[disp.imgKey]}
                        alt={disp.name}
                        className="h-12 w-12 shrink-0 rounded-lg object-contain"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-white">
                            {disp.name}
                          </span>
                          {disp.isBonus && (
                            <span className="rounded-full bg-[#FFD700]/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#FFD700]">
                              ★ Bonus
                            </span>
                          )}
                          {topSlotMatched && (
                            <span className="rounded-full bg-[#448AFF]/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#448AFF]">
                              ⚡ Top Slot
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#5a6a99]">
                          {r.data?.dealer?.name ? `Dealer: ${r.data.dealer.name}` : ""}
                          {multiplier ? ` · ×${multiplier}` : ""}
                          {" · "}
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

        {/* Statistics */}
        {!loading && !error && stats.length > 0 && (
          <div className="revo-card mt-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#448AFF]/10 to-transparent px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-chart-column text-[#448AFF]" /> Statistics
                <span className="text-[10px] font-normal text-[#5a6a99]">
                  (last 24h · {totalCount.toLocaleString()} spins)
                </span>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
              {stats.map((st) => {
                const disp = sectorToDisplay(st.wheelResult);
                const isHot = st.hotFrequencyPercentage > 5;
                const isCold = st.hotFrequencyPercentage < -5;

                return (
                  <div
                    key={st.wheelResult}
                    className="rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-3 text-center"
                  >
                    <img
                      src={GAME_CARD_IMAGES[disp.imgKey]}
                      alt={disp.name}
                      className="mx-auto h-10 w-10 object-contain"
                    />
                    <div className="mt-1 text-sm font-black text-white">
                      {disp.name}
                    </div>
                    <div className="text-lg font-black text-[#448AFF]">
                      {st.percentage.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-[#5a6a99]">
                      {st.count} hits
                    </div>
                    <div className="mt-1 flex items-center justify-center gap-1">
                      {isHot && (
                        <span className="rounded-full bg-[#ff4757]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#ff4757]">
                          🔥 Hot
                        </span>
                      )}
                      {isCold && (
                        <span className="rounded-full bg-[#00d4ff]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#00d4ff]">
                          ❄️ Cold
                        </span>
                      )}
                      <span className="text-[9px] text-[#5a6a99]">
                        {st.lastSeenBefore === 0 ? "just now" : `${st.lastSeenBefore} ago`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="mt-4 text-center text-[11px] text-[#5a6a99]">
          <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
          Real-time data from CasinoScores (casino.org). Results update
          automatically every 15 seconds. For entertainment only — play
          responsibly.
        </p>
      </div>
    </section>
  );
}
