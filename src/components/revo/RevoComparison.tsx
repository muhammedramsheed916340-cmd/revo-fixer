"use client";

import { useState } from "react";
import { formatINR } from "./lib";
import type { Package } from "@/lib/types";

// Standardized feature rows for side-by-side comparison.
const ROWS: {
  label: string;
  icon: string;
  get: (p: Package) => string | boolean;
}[] = [
  { label: "Price", icon: "fa-indian-rupee-sign", get: (p) => formatINR(p.price) },
  { label: "Access duration", icon: "fa-clock", get: (p) => `${p.hours} hour${(p.hours ?? 0) > 1 ? "s" : ""}` },
  { label: "Price per hour", icon: "fa-calculator", get: (p) => formatINR(Math.round((p.price ?? 0) / (p.hours || 1))) },
  { label: "Priority queue", icon: "fa-bolt", get: (p) => (p.features ?? []).some((f) => /priority queue/i.test(f)) },
  { label: "Basic support", icon: "fa-headset", get: (p) => (p.features ?? []).some((f) => /basic support/i.test(f)) },
  { label: "Priority support", icon: "fa-headset", get: (p) => (p.features ?? []).some((f) => /priority support/i.test(f)) },
  { label: "Premium support", icon: "fa-headset", get: (p) => (p.features ?? []).some((f) => /premium support/i.test(f)) },
  { label: "VIP support", icon: "fa-crown", get: (p) => (p.features ?? []).some((f) => /vip support/i.test(f)) },
  { label: "24/7 support", icon: "fa-headset", get: (p) => (p.features ?? []).some((f) => /24\/7 support/i.test(f)) },
  { label: "All features", icon: "fa-star", get: (p) => (p.features ?? []).some((f) => /all features/i.test(f)) },
  { label: "Unlimited requests", icon: "fa-infinity", get: (p) => (p.features ?? []).some((f) => /unlimited requests/i.test(f)) },
  { label: "Best value", icon: "fa-tags", get: (p) => (p.features ?? []).some((f) => /best value/i.test(f)) },
  { label: "Extended coverage", icon: "fa-shield-halved", get: (p) => (p.features ?? []).some((f) => /extended coverage/i.test(f)) },
  { label: "Pro features", icon: "fa-wand-magic-sparkles", get: (p) => (p.features ?? []).some((f) => /pro features/i.test(f)) },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true)
    return <i className="fas fa-check text-[#2ed573]" aria-label="yes" />;
  if (value === false)
    return <i className="fas fa-minus text-[#3a3f5c]" aria-label="no" />;
  return <span className="text-sm font-bold text-white">{value}</span>;
}

export function RevoComparison({
  packages,
  onBuy,
}: {
  packages: Package[];
  onBuy: (p: Package) => void;
}) {
  const [highlight, setHighlight] = useState<string | null>(null);

  if (packages.length === 0) return null;

  return (
    <section id="compare" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <i className="fas fa-table-columns" /> Compare Plans
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Full feature <span className="revo-gradient-text">comparison</span>
          </h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-[#8899cc]">
            Side-by-side breakdown of all 5 real packages. Tap a column to
            highlight a plan.
          </p>
        </div>

        {/* Desktop: scrollable table */}
        <div className="revo-card overflow-hidden">
          <div className="overflow-x-auto revo-scroll">
            <table className="w-full min-w-[640px] border-collapse text-center">
              <thead>
                <tr className="border-b border-[#1e2240] bg-[#0d1020]/60">
                  <th className="sticky left-0 z-10 bg-[#0d1020]/95 px-4 py-4 text-left text-xs font-bold uppercase tracking-wider text-[#5a6a99] backdrop-blur">
                    Feature
                  </th>
                  {packages.map((p) => (
                    <th
                      key={p.id}
                      onMouseEnter={() => setHighlight(p.id)}
                      onMouseLeave={() => setHighlight(null)}
                      className={`relative px-3 py-3 align-bottom transition ${
                        highlight === p.id ? "bg-[#448AFF]/10" : ""
                      } ${p.popular ? "bg-[#448AFF]/5" : ""}`}
                    >
                      {p.popular && (
                        <span className="absolute -top-px left-0 right-0 h-0.5 bg-gradient-to-r from-[#448AFF] to-[#2962FF]" />
                      )}
                      <div className="flex flex-col items-center gap-1">
                        <span
                          className="grid h-9 w-9 place-items-center rounded-lg text-[#448AFF]"
                          style={{ background: "rgba(68,138,255,0.12)" }}
                        >
                          <i className={`fas ${p.icon ?? "fa-bolt"}`} />
                        </span>
                        <span className="text-sm font-black text-white">{p.name}</span>
                        {p.popular && (
                          <span className="rounded-full bg-[#448AFF] px-1.5 py-0.5 text-[8px] font-black uppercase text-white">
                            Popular
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row, ri) => (
                  <tr
                    key={row.label}
                    className={`border-b border-[#1e2240]/60 transition ${
                      ri % 2 === 1 ? "bg-white/[0.015]" : ""
                    }`}
                  >
                    <td className="sticky left-0 z-10 bg-[#141827]/95 px-4 py-3 text-left text-xs font-medium text-[#8899cc] backdrop-blur">
                      <span className="inline-flex items-center gap-2">
                        <i className={`fas ${row.icon} w-4 text-[#5a6a99]`} />
                        {row.label}
                      </span>
                    </td>
                    {packages.map((p) => (
                      <td
                        key={p.id}
                        onMouseEnter={() => setHighlight(p.id)}
                        onMouseLeave={() => setHighlight(null)}
                        className={`px-3 py-3 transition ${
                          highlight === p.id ? "bg-[#448AFF]/10" : ""
                        }`}
                      >
                        <Cell value={row.get(p)} />
                      </td>
                    ))}
                  </tr>
                ))}
                {/* Buy row */}
                <tr>
                  <td className="sticky left-0 z-10 bg-[#141827]/95 px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-[#5a6a99] backdrop-blur">
                    <span className="inline-flex items-center gap-2">
                      <i className="fas fa-cart-shopping w-4 text-[#5a6a99]" />
                      Choose
                    </span>
                  </td>
                  {packages.map((p) => (
                    <td
                      key={p.id}
                      className={`px-3 py-4 transition ${
                        highlight === p.id ? "bg-[#448AFF]/10" : ""
                      }`}
                    >
                      <button
                        onClick={() => onBuy(p)}
                        className={`w-full rounded-lg px-3 py-2 text-xs font-bold transition ${
                          p.popular
                            ? "revo-btn"
                            : "border border-[#1e2240] bg-[#141827] text-[#bcc6e0] hover:bg-[#1e2240] hover:text-white"
                        }`}
                      >
                        <i className="fas fa-bolt mr-1" /> Buy
                      </button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-[11px] text-[#5a6a99]">
          <span>
            <i className="fas fa-check text-[#2ed573] mr-1" /> Included
          </span>
          <span>
            <i className="fas fa-minus text-[#3a3f5c] mr-1" /> Not included
          </span>
          <span>
            <i className="fas fa-info-circle text-[#448AFF] mr-1" /> Hover a
            column to highlight
          </span>
        </div>
      </div>
    </section>
  );
}
