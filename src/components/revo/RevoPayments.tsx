"use client";

import { useState } from "react";
import { copyText } from "./lib";
import type { PaymentMethods, PaymentNumber } from "@/lib/types";

const META: Record<
  string,
  { label: string; icon: string; color: string }
> = {
  upi: { label: "UPI", icon: "fa-google-pay", color: "#448AFF" },
  bkash: { label: "Bkash", icon: "fa-mobile-screen", color: "#e2136e" },
  usdt: { label: "USDT", icon: "fa-coins", color: "#2ed573" },
};

function NumberRow({ entry }: { entry: PaymentNumber }) {
  const [copied, setCopied] = useState(false);
  const text = entry.number ?? "";
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">{text}</span>
          {entry.isActive ? (
            <span className="rounded-full bg-[#2ed573]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#2ed573]">
              Active
            </span>
          ) : (
            <span className="rounded-full bg-[#ff4757]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#ff4757]">
              Inactive
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-[#5a6a99]">
          {entry.label ? `${entry.label} · ` : ""}
          {entry.instruction ?? ""}
        </div>
      </div>
      <button
        onClick={async () => {
          const ok = await copyText(text);
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#1e2240] bg-[#141827] text-[#448AFF] transition hover:bg-[#1e2240]"
        aria-label="Copy"
      >
        <i className={`fas ${copied ? "fa-check text-[#2ed573]" : "fa-copy"} text-sm`} />
      </button>
    </div>
  );
}

export function RevoPayments({
  methods,
  loading,
}: {
  methods: PaymentMethods | null;
  loading: boolean;
}) {
  const keys = methods ? (Object.keys(methods) as (keyof PaymentMethods)[]) : [];

  return (
    <section id="payments" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <i className="fas fa-wallet" /> Payment Methods
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Pay with <span className="revo-gradient-text">UPI · Bkash · USDT</span>
          </h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-[#8899cc]">
            Real payment destinations from the live platform. Send the exact
            amount, then share the screenshot with @RevoAgent.
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="revo-card h-48 revo-shimmer" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {keys.map((k) => {
              const meta = META[k] ?? { label: k, icon: "fa-money-bill", color: "#448AFF" };
              const entry = methods?.[k];
              const numbers = entry?.numbers ? Object.values(entry.numbers) : [];
              return (
                <div key={k} className="revo-card p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <span
                      className="grid h-11 w-11 place-items-center rounded-xl text-lg"
                      style={{ background: `${meta.color}22`, color: meta.color }}
                    >
                      <i className={`fas ${meta.icon}`} />
                    </span>
                    <div>
                      <div className="text-base font-black text-white">
                        {meta.label}
                      </div>
                      <div className="text-[11px] uppercase tracking-wider text-[#5a6a99]">
                        {numbers.length} destination{numbers.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {numbers.map((n, i) => (
                      <NumberRow key={i} entry={n} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
