"use client";

import { useMemo, useState } from "react";
import { formatINR } from "./lib";
import type { AppSettings, Package } from "@/lib/types";

export function RevoRecommender({
  packages,
  settings,
  onPick,
}: {
  packages: Package[];
  settings: AppSettings | null;
  onPick: (p: Package) => void;
}) {
  const usdtRate = settings?.paymentSettings?.usdtRate ?? 94.14;
  const minDepositINR = settings?.paymentSettings?.minDepositINR ?? 7000;

  const [budget, setBudget] = useState(String(minDepositINR));
  const [hoursNeeded, setHoursNeeded] = useState("2");

  const budgetNum = parseFloat(budget.replace(/[^0-9.]/g, "")) || 0;
  const hoursNum = parseFloat(hoursNeeded.replace(/[^0-9.]/g, "")) || 0;

  // Compute scored recommendations from REAL packages.
  const results = useMemo(() => {
    if (packages.length === 0) return [];
    return packages
      .map((p) => {
        const price = p.price ?? 0;
        const hours = p.hours ?? 0;
        const perHour = hours > 0 ? price / hours : Infinity;
        const affordable = budgetNum >= price;
        const coversHours = hours >= hoursNum;
        // Value score: lower ₹/hr = better; popular gets a small boost.
        const valueScore =
          perHour === Infinity ? 0 : Math.round(100000 / perHour);
        const popularBoost = p.popular ? 5 : 0;
        // Fit score: how well it matches budget + hours needed.
        const budgetFit = affordable ? 50 : Math.max(0, 50 - (price - budgetNum) / 100);
        const hoursFit = coversHours ? 50 : Math.max(0, (hours / Math.max(hoursNum, 1)) * 50);
        const totalScore = Math.round(valueScore + popularBoost + budgetFit + hoursFit);
        return {
          pkg: p,
          price,
          hours,
          perHour,
          affordable,
          coversHours,
          totalScore,
          // ROI: hours of access per ₹100 spent.
          roi: price > 0 ? (hours / price) * 100 : 0,
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore);
  }, [packages, budgetNum, hoursNum]);

  const top = results[0];
  const affordableCount = results.filter((r) => r.affordable).length;

  return (
    <section id="recommender" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <i className="fas fa-wand-magic-sparkles" /> Smart Picker
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Find your <span className="revo-gradient-gold">best-value plan</span>
          </h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-[#8899cc]">
            Enter your budget and needed hours — we score all 5 real packages by
            ₹/hr value, affordability and coverage to recommend the best fit.
          </p>
        </div>

        <div className="revo-card revo-card-glow overflow-hidden">
          <div className="grid gap-5 md:grid-cols-[1fr_1.4fr]">
            {/* Inputs */}
            <div className="space-y-4 border-b border-[#1e2240] p-5 md:border-b-0 md:border-r">
              <div>
                <label className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#5a6a99]">
                  <span>
                    <i className="fas fa-wallet mr-1.5 text-[#2ed573]" /> Budget
                  </span>
                  <span className="text-[10px] normal-case text-[#5a6a99]">
                    min {formatINR(minDepositINR)}
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="range"
                    min={minDepositINR}
                    max={40000}
                    step={500}
                    value={Math.min(Math.max(budgetNum, minDepositINR), 40000)}
                    onChange={(e) => setBudget(e.target.value)}
                    className="w-full accent-[#448AFF]"
                  />
                  <div className="mt-1 flex items-center justify-between text-[11px] text-[#5a6a99]">
                    <span>{formatINR(minDepositINR)}</span>
                    <span className="text-base font-black text-[#FFD700]">
                      {formatINR(budgetNum)}
                    </span>
                    <span>{formatINR(40000)}</span>
                  </div>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder={String(minDepositINR)}
                  className="mt-2 w-full rounded-lg border border-[#1e2240] bg-[#0d1020] px-3 py-2 text-sm font-bold text-white outline-none focus:border-[#448AFF]"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#5a6a99]">
                  <i className="fas fa-clock mr-1.5 text-[#448AFF]" /> Hours needed
                </label>
                <div className="flex flex-wrap gap-2">
                  {["1", "2", "4", "8", "24"].map((h) => (
                    <button
                      key={h}
                      onClick={() => setHoursNeeded(h)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                        hoursNeeded === h
                          ? "border-[#448AFF] bg-[#448AFF]/15 text-[#448AFF]"
                          : "border-[#1e2240] bg-[#0d1020] text-[#8899cc] hover:text-white"
                      }`}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min={1}
                  max={24}
                  step={1}
                  value={Math.min(Math.max(hoursNum, 1), 24)}
                  onChange={(e) => setHoursNeeded(e.target.value)}
                  className="mt-3 w-full accent-[#FFD700]"
                />
              </div>

              <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">
                  Affordable packages
                </div>
                <div className="text-2xl font-black text-[#2ed573]">
                  {affordableCount}
                  <span className="text-sm text-[#5a6a99]">/{packages.length}</span>
                </div>
              </div>
            </div>

            {/* Results */}
            <div className="p-5">
              {top ? (
                <>
                  {/* Top recommendation */}
                  <div className="mb-4 rounded-xl border border-[#FFD700]/40 bg-gradient-to-br from-[#FFD700]/10 to-transparent p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#FFD700]">
                        <i className="fas fa-trophy" /> Top recommendation
                      </span>
                      <span className="rounded-full bg-[#FFD700]/15 px-2 py-0.5 text-[10px] font-black text-[#FFD700]">
                        Score {top.totalScore}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <i className={`fas ${top.pkg.icon ?? "fa-bolt"} text-[#448AFF]`} />
                          <span className="text-lg font-black text-white">
                            {top.pkg.name}
                          </span>
                          {top.pkg.popular && (
                            <span className="rounded-full bg-[#448AFF]/20 px-1.5 py-0.5 text-[9px] font-bold text-[#448AFF]">
                              POPULAR
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-[#8899cc]">
                          {formatINR(top.price)} · {top.hours}h ·{" "}
                          <span className="text-[#2ed573]">
                            {formatINR(Math.round(top.perHour))}/hr
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => onPick(top.pkg)}
                        className="revo-btn-gold rounded-lg px-4 py-2 text-xs font-bold"
                      >
                        <i className="fas fa-arrow-right mr-1" /> Choose
                      </button>
                    </div>
                    {!top.affordable && (
                      <div className="mt-2 rounded-lg border border-[#ffa502]/30 bg-[#ffa502]/10 px-2.5 py-1 text-[11px] text-[#ffa502]">
                        <i className="fas fa-triangle-exclamation mr-1" />
                        {formatINR(top.price - budgetNum)} over your budget —
                        consider increasing it.
                      </div>
                    )}
                  </div>

                  {/* All ranked */}
                  <div className="space-y-2">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
                      All plans ranked by fit
                    </div>
                    {results.map((r, i) => {
                      const maxScore = results[0]?.totalScore || 1;
                      const widthPct = (r.totalScore / maxScore) * 100;
                      return (
                        <button
                          key={r.pkg.id}
                          onClick={() => onPick(r.pkg)}
                          className="group flex w-full items-center gap-3 rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-2.5 text-left transition hover:border-[#448AFF]/50 hover:bg-[#141827]"
                        >
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#1e2240] text-[10px] font-black text-[#8899cc]">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-bold text-white">
                                {r.pkg.name}
                              </span>
                              <span className="shrink-0 text-xs font-black text-white">
                                {formatINR(r.price)}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1e2240]">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${widthPct}%`,
                                    background: i === 0
                                      ? "linear-gradient(90deg,#FFD700,#ffa502)"
                                      : "linear-gradient(90deg,#448AFF,#2962FF)",
                                  }}
                                />
                              </div>
                              <span className="shrink-0 text-[10px] text-[#5a6a99]">
                                {r.affordable ? (
                                  <span className="text-[#2ed573]">✓ fits</span>
                                ) : (
                                  <span className="text-[#ff4757]">over</span>
                                )}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="grid h-full place-items-center text-sm text-[#5a6a99]">
                  Loading packages…
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-[#1e2240] bg-[#0d1020]/40 px-4 py-2 text-center text-[10px] text-[#5a6a99]">
            <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
            Scores combine ₹/hr value, budget fit, hours coverage & popularity.
            USDT rate ₹{usdtRate.toFixed(2)}/USDT.
          </div>
        </div>
      </div>
    </section>
  );
}
