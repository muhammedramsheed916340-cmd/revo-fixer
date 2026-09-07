"use client";

import { useState } from "react";
import { formatINR, copyText } from "./lib";
import type { AppSettings, Package } from "@/lib/types";

const ICON_FALLBACK: Record<string, string> = {
  "fa-bolt": "fa-bolt",
  "fa-chart-line": "fa-chart-line",
  "fa-star": "fa-star",
  "fa-crown": "fa-crown",
  "fa-infinity": "fa-infinity",
};

function PackageCard({
  pkg,
  discountPercent,
  onBuy,
}: {
  pkg: Package;
  discountPercent: number;
  onBuy: (p: Package, finalPrice: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const original = pkg.price ?? 0;
  const hasDiscount = discountPercent > 0;
  const finalPrice = hasDiscount
    ? Math.round(original * (1 - discountPercent / 100))
    : original;
  const save = hasDiscount ? original - finalPrice : 0;

  return (
    <div
      className={`revo-card group relative flex flex-col overflow-hidden p-5 transition hover:-translate-y-1.5 hover:ring-1 hover:ring-[#448AFF]/40 ${
        pkg.popular ? "revo-card-glow ring-1 ring-[#448AFF]/40" : ""
      }`}
    >
      {/* top gradient strip on hover */}
      <span
        className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-gradient-to-r from-[#448AFF] via-[#00d4ff] to-[#FFD700] transition-transform duration-500 group-hover:scale-x-100"
        aria-hidden
      />
      {pkg.popular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#448AFF] to-[#2962FF] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-lg">
          ★ Most Popular
        </span>
      )}

      <div className="mb-3 flex items-center gap-3">
        <span
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-xl text-[#448AFF]"
          style={{ background: "rgba(68,138,255,0.12)" }}
        >
          <i className={`fas ${ICON_FALLBACK[pkg.icon ?? "fa-bolt"] ?? "fa-bolt"}`} />
        </span>
        <div>
          <div className="text-lg font-black text-white">{pkg.name}</div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-[#5a6a99]">
            {pkg.hours === 24
              ? "Full day"
              : `${pkg.hours} hour${(pkg.hours ?? 0) > 1 ? "s" : ""} access`}
          </div>
        </div>
      </div>

      <p className="mb-4 min-h-[36px] text-xs text-[#8899cc]">{pkg.desc ?? ""}</p>

      <div className="mb-4">
        <div className="flex items-end gap-2">
          {hasDiscount ? (
            <>
              <span className="revo-gradient-gold text-3xl font-black">
                {formatINR(finalPrice)}
              </span>
              <span className="mb-1 text-sm text-[#5a6a99] line-through">
                {formatINR(original)}
              </span>
            </>
          ) : (
            <span className="revo-gradient-text text-3xl font-black">
              {formatINR(original)}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px]">
          {pkg.hours ? (
            <span className="text-[#5a6a99]">
              ≈ {formatINR(Math.round(original / (pkg.hours || 1)))}/hr
            </span>
          ) : null}
          {save > 0 && (
            <span className="rounded-full bg-[#2ed573]/15 px-2 py-0.5 font-bold text-[#2ed573]">
              Save {formatINR(save)}
            </span>
          )}
        </div>
      </div>

      <ul className="mb-5 flex-1 space-y-2">
        {(pkg.features ?? []).map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-[#bcc6e0]">
            <i className="fas fa-check-circle mt-0.5 text-[#2ed573]" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={() => onBuy(pkg, finalPrice)}
        className={`w-full rounded-xl px-4 py-3 text-sm font-bold transition ${
          pkg.popular ? "revo-btn" : "revo-btn-gold"
        }`}
      >
        <i className="fas fa-bolt mr-1.5" /> Buy {pkg.name}
      </button>

      <button
        onClick={async () => {
          const ok = await copyText(`${pkg.name} • ${formatINR(finalPrice)}`);
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
        className="mt-2 text-center text-[11px] font-medium text-[#5a6a99] transition hover:text-[#448AFF]"
      >
        <i className={`fas ${copied ? "fa-check" : "fa-copy"} mr-1`} />
        {copied ? "Copied!" : "Copy details"}
      </button>
    </div>
  );
}

export function RevoPackages({
  packages,
  settings,
  onBuy,
}: {
  packages: Package[];
  settings: AppSettings | null;
  onBuy: (p: Package, finalPrice: number) => void;
}) {
  const discountPercent =
    settings?.discount?.active && (settings.discount.percent ?? 0) > 0
      ? settings.discount.percent
      : 0;

  return (
    <section id="packages" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <i className="fas fa-crown" /> Premium Plans
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Choose your <span className="revo-gradient-gold">access plan</span>
          </h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-[#8899cc]">
            Real prices from the live Revo Fixer platform. Timed access with
            priority queue &amp; premium support.
          </p>
        </div>

        {discountPercent > 0 && (
          <div className="revo-card-glow mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#FFD700]/40 bg-[#FFD700]/8 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-bold text-[#FFD700]">
              <i className="fas fa-tags" /> {discountPercent}% OFF —{" "}
              <span className="font-medium text-[#bcc6e0]">
                {settings?.discount?.message ?? "Limited time offer"}
              </span>
            </div>
            <span className="rounded-full bg-[#FFD700] px-2.5 py-0.5 text-xs font-black text-[#1a1a2e]">
              -{discountPercent}%
            </span>
          </div>
        )}

        {packages.length === 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="revo-card h-72 revo-shimmer" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {packages.map((p) => (
              <PackageCard
                key={p.id}
                pkg={p}
                discountPercent={discountPercent}
                onBuy={onBuy}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
