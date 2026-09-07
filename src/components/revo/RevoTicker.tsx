"use client";

import { useEffect, useState } from "react";
import { formatINR, timeAgo } from "./lib";
import type { PackagePayment, TransferRequest } from "@/lib/types";

const METHOD_COLOR: Record<string, string> = {
  upi: "#448AFF",
  bkash: "#e2136e",
  usdt: "#2ed573",
};

interface ActivityData {
  payments: PackagePayment[];
  transfers: TransferRequest[];
}

function TickerItem({ kind, text, sub, color }: { kind: string; text: string; sub: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-2 px-6 text-xs">
      <span
        className="grid h-6 w-6 place-items-center rounded-full"
        style={{ background: `${color}1f`, color }}
      >
        <i className={`fas ${kind === "payment" ? "fa-credit-card" : "fa-right-left"} text-[10px]`} />
      </span>
      <span className="font-bold text-white">{text}</span>
      <span className="text-[#5a6a99]">· {sub}</span>
    </span>
  );
}

export function RevoTicker() {
  const [data, setData] = useState<ActivityData | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/activity");
        const json: ActivityData = await res.json();
        if (active) setData(json);
      } catch {
        /* ignore */
      }
    }
    load();
    const t = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  // Merge into a single timeline for the ticker.
  type Item = { kind: "payment" | "transfer"; text: string; sub: string; color: string; ts: number };
  const items: Item[] = [];
  for (const p of data?.payments ?? []) {
    items.push({
      kind: "payment" as const,
      text: `${p.packageName ?? "Package"} · ${formatINR(p.amount)}`,
      sub: `${(p.method ?? "").toUpperCase()} · ${timeAgo(p.createdAt)}`,
      color: METHOD_COLOR[(p.method ?? "").toLowerCase()] ?? "#448AFF",
      ts: p.createdAt ?? 0,
    });
  }
  for (const t of data?.transfers ?? []) {
    items.push({
      kind: "transfer" as const,
      text: `Transfer · ${formatINR(t.amount)}`,
      sub: `${t.status ?? "pending"} · ${timeAgo(t.createdAt)}`,
      color: "#ffa502",
      ts: t.createdAt ?? 0,
    });
  }
  items.sort((a, b) => b.ts - a.ts);
  const feed = items.slice(0, 10);
  // Duplicate for seamless marquee loop.
  const loop = [...feed, ...feed];

  if (feed.length === 0) {
    return null;
  }

  return (
    <div className="relative overflow-hidden border-y border-[#1e2240] bg-[#0d1020]/50 backdrop-blur-sm">
      {/* edge fade masks */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[#0a0b14] to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[#0a0b14] to-transparent"
        aria-hidden
      />
      {/* live indicator */}
      <span className="absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 items-center gap-1.5 rounded-full bg-[#2ed573]/15 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#2ed573] sm:flex">
        <span className="revo-pulse">●</span> Live
      </span>
      <div className="revo-marquee py-2.5 pl-20">
        {loop.map((it, i) => (
          <TickerItem key={i} kind={it.kind} text={it.text} sub={it.sub} color={it.color} />
        ))}
      </div>
    </div>
  );
}
