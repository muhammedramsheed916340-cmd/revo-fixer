"use client";

import type { AppSettings } from "@/lib/types";

export function RevoHero({
  settings,
  onBuy,
  onSupport,
  onExplore,
}: {
  settings: AppSettings | null;
  onBuy: () => void;
  onSupport: () => void;
  onExplore: () => void;
}) {
  const usdtRate = settings?.paymentSettings?.usdtRate ?? 94.14;
  const minDeposit = settings?.paymentSettings?.minDepositINR ?? 7000;

  return (
    <section id="home" className="relative scroll-mt-20 px-4 pt-10 sm:px-6 sm:pt-16">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-[#1e2240] bg-[#141827]/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8899cc]">
          <span className="text-[#2ed573] revo-pulse">●</span>
          Live Platform · v{settings?.appVersion ?? "2.0.0"}
        </div>

        <div className="mb-4 flex justify-center">
          <span
            className="grid h-20 w-20 place-items-center rounded-2xl text-4xl text-white shadow-2xl"
            style={{
              background: "linear-gradient(135deg,#448AFF,#2962FF)",
              boxShadow: "0 20px 50px -12px rgba(68,138,255,0.7)",
            }}
          >
            <i className="fas fa-crown" />
          </span>
        </div>

        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
          <span className="revo-gradient-animate">REVO</span>{" "}
          <span className="text-white">FIXER</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm font-semibold uppercase tracking-[0.25em] text-[#448AFF] sm:text-base">
          ⚡ CRAZY TIME REVO FIXER ⚡
        </p>
        <p className="mx-auto mt-4 max-w-xl text-sm text-[#8899cc] sm:text-base">
          Explore the live Revo Fixer platform — real packages, real revenue,
          real transactions &amp; live platform stats. Browse everything below,
          no login required.
        </p>

        {/* Primary CTAs — no license key / no activation */}
        <div className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <button
            onClick={onExplore}
            className="revo-btn flex w-full items-center justify-center gap-2 px-6 py-3.5 text-base sm:w-auto"
          >
            <i className="fas fa-compass" /> Explore Live Platform
          </button>
          <button
            onClick={onBuy}
            className="revo-btn-gold flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base sm:w-auto"
          >
            <i className="fas fa-crown" /> View Packages
          </button>
          <button
            onClick={onSupport}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#1e2240] bg-[#141827] px-6 py-3.5 text-base font-semibold text-[#bcc6e0] transition hover:bg-[#1e2240] hover:text-white sm:w-auto"
          >
            <i className="fab fa-telegram text-[#29b6f6]" /> Support
          </button>
        </div>

        {/* Live platform snapshot (real values) */}
        <div className="revo-card revo-card-glow mx-auto mt-8 grid max-w-2xl grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5">
          {[
            { label: "USDT Rate", value: `₹${usdtRate.toFixed(2)}`, icon: "fa-coins", color: "#2ed573" },
            { label: "Min Deposit", value: `₹${minDeposit.toLocaleString("en-IN")}`, icon: "fa-wallet", color: "#FFD700" },
            { label: "Version", value: `v${settings?.appVersion ?? "2.0.0"}`, icon: "fa-tag", color: "#448AFF" },
            { label: "Support", value: "24/7", icon: "fa-headset", color: "#00d4ff" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <span
                className="mx-auto mb-1.5 grid h-9 w-9 place-items-center rounded-lg text-sm"
                style={{ background: `${s.color}1f`, color: s.color }}
              >
                <i className={`fas ${s.icon}`} />
              </span>
              <div className="text-base font-black text-white sm:text-lg">{s.value}</div>
              <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Trust badges */}
        <div className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { icon: "fa-shield-halved", color: "#2ed573", label: "Secure", sub: "Real platform" },
            { icon: "fa-bolt", color: "#ffa502", label: "Live Data", sub: "From Firebase" },
            { icon: "fa-headset", color: "#448AFF", label: "24/7", sub: "Live support" },
            { icon: "fa-globe", color: "#00d4ff", label: "UPI · USDT", sub: "Bkash crypto" },
          ].map((b) => (
            <div
              key={b.label}
              className="revo-card flex items-center gap-2.5 px-3 py-2.5"
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm"
                style={{ background: `${b.color}1f`, color: b.color }}
              >
                <i className={`fas ${b.icon}`} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-white">{b.label}</div>
                <div className="truncate text-[10px] text-[#5a6a99]">{b.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
