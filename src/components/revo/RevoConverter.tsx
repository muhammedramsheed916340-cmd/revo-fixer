"use client";

import { useMemo, useState } from "react";
import { copyText, formatINR } from "./lib";
import type { AppSettings } from "@/lib/types";

export function RevoConverter({
  settings,
}: {
  settings: AppSettings | null;
}) {
  const usdtRate = settings?.paymentSettings?.usdtRate ?? 94.14;
  const minDepositINR = settings?.paymentSettings?.minDepositINR ?? 7000;

  const [direction, setDirection] = useState<"usdt_to_inr" | "inr_to_usdt">(
    "usdt_to_inr",
  );
  const [input, setInput] = useState("100");
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    const n = parseFloat(input.replace(/[^0-9.]/g, ""));
    if (!isFinite(n) || n <= 0) return null;
    if (direction === "usdt_to_inr") {
      return { value: n * usdtRate, unit: "INR", raw: n * usdtRate };
    }
    return { value: n / usdtRate, unit: "USDT", raw: n / usdtRate };
  }, [input, direction, usdtRate]);

  const formatted =
    result == null
      ? "—"
      : result.unit === "INR"
        ? formatINR(result.raw)
        : `${result.raw.toFixed(4)} USDT`;

  async function copy() {
    if (result == null) return;
    const ok = await copyText(formatted);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <section id="converter" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <i className="fas fa-right-left" /> Currency Converter
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            USDT <span className="revo-gradient-text">↔</span> INR
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-[#8899cc]">
            Live rate <b className="text-[#2ed573]">₹{usdtRate.toFixed(2)}</b> per
            1 USDT. Min deposit{" "}
            <b className="text-[#FFD700]">{formatINR(minDepositINR)}</b>.
          </p>
        </div>

        <div className="revo-card revo-card-glow p-5 sm:p-7">
          {/* Direction toggle */}
          <div className="mb-5 flex justify-center">
            <div className="flex gap-1 rounded-xl border border-[#1e2240] bg-[#0d1020] p-1">
              <button
                onClick={() => setDirection("usdt_to_inr")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  direction === "usdt_to_inr"
                    ? "bg-[#2ed573] text-[#0a0b14] shadow"
                    : "text-[#8899cc] hover:text-white"
                }`}
              >
                <i className="fab fa-monero text-base" /> USDT → INR
              </button>
              <button
                onClick={() => setDirection("inr_to_usdt")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  direction === "inr_to_usdt"
                    ? "bg-[#448AFF] text-white shadow"
                    : "text-[#8899cc] hover:text-white"
                }`}
              >
                <i className="fas fa-indian-rupee-sign" /> INR → USDT
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto_1fr]">
            {/* Input */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#5a6a99]">
                {direction === "usdt_to_inr" ? "You pay (USDT)" : "You pay (INR)"}
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-[#1e2240] bg-[#0d1020] px-4 py-4 pr-16 text-2xl font-bold text-white outline-none transition focus:border-[#448AFF] focus:ring-2 focus:ring-[#448AFF]/30"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-[#5a6a99]">
                  {direction === "usdt_to_inr" ? "USDT" : "INR"}
                </span>
              </div>
              {/* Quick chips */}
              <div className="mt-2 flex flex-wrap gap-2">
                {(direction === "usdt_to_inr"
                  ? ["50", "100", "500", "1000"]
                  : [String(minDepositINR), "5000", "10000", "40000"]
                ).map((v) => (
                  <button
                    key={v}
                    onClick={() => setInput(v)}
                    className="rounded-lg border border-[#1e2240] bg-[#141827]/60 px-2.5 py-1 text-xs font-semibold text-[#8899cc] transition hover:border-[#448AFF]/50 hover:text-white"
                  >
                    {direction === "inr_to_usdt" ? "₹" : ""}{v}
                  </button>
                ))}
              </div>
            </div>

            {/* Swap icon */}
            <div className="hidden place-items-center pb-4 sm:grid">
              <button
                onClick={() =>
                  setDirection((d) =>
                    d === "usdt_to_inr" ? "inr_to_usdt" : "usdt_to_inr",
                  )
                }
                className="grid h-11 w-11 place-items-center rounded-full border border-[#1e2240] bg-[#141827] text-[#448AFF] transition hover:rotate-180 hover:border-[#448AFF]/50"
                aria-label="Swap direction"
              >
                <i className="fas fa-arrow-right-arrow-left" />
              </button>
            </div>

            {/* Output */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#5a6a99]">
                {direction === "usdt_to_inr" ? "You receive (INR)" : "You receive (USDT)"}
              </label>
              <button
                onClick={copy}
                disabled={result == null}
                className="group relative w-full overflow-hidden rounded-xl border border-[#1e2240] bg-gradient-to-br from-[#141827] to-[#0d1020] px-4 py-4 text-left transition hover:border-[#448AFF]/50 disabled:opacity-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-2xl font-black text-white">
                    {formatted}
                  </span>
                  <span className="shrink-0 text-[#5a6a99] transition group-hover:text-[#448AFF]">
                    <i className={`fas ${copied ? "fa-check text-[#2ed573]" : "fa-copy"}`} />
                  </span>
                </div>
                <span className="mt-1 block text-[10px] uppercase tracking-wider text-[#5a6a99]">
                  Tap to copy
                </span>
              </button>
            </div>
          </div>

          {/* Rate info */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">Rate</div>
              <div className="text-base font-black text-[#2ed573]">₹{usdtRate.toFixed(2)}</div>
            </div>
            <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">1 USDT</div>
              <div className="text-base font-black text-white">≈ ₹{usdtRate.toFixed(2)}</div>
            </div>
            <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">Min deposit</div>
              <div className="text-base font-black text-[#FFD700]">{formatINR(minDepositINR)}</div>
            </div>
            <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">≈ in USDT</div>
              <div className="text-base font-black text-white">
                {(minDepositINR / usdtRate).toFixed(2)} U
              </div>
            </div>
          </div>

          <p className="mt-4 text-center text-[11px] text-[#5a6a99]">
            <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
            Rate sourced live from appSettings. Final amount may vary slightly
            due to network fees.
          </p>
        </div>
      </div>
    </section>
  );
}
