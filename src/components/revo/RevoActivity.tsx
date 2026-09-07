"use client";

import { useMemo, useState } from "react";
import { formatINR, timeAgo } from "./lib";
import type {
  NotificationItem,
  PackagePayment,
  TransferRequest,
} from "@/lib/types";

interface ActivityData {
  payments: PackagePayment[];
  transfers: TransferRequest[];
}

const METHOD_COLOR: Record<string, string> = {
  upi: "#448AFF",
  bkash: "#e2136e",
  usdt: "#2ed573",
};

type FilterKind = "all" | "payment" | "transfer" | "notification";

export function RevoActivity({
  data,
  notifications,
  loading,
}: {
  data: ActivityData | null;
  notifications: NotificationItem[];
  loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKind>("all");

  const payments = data?.payments ?? [];
  const transfers = data?.transfers ?? [];

  // Merge into a single timeline of {ts, kind, icon, text, color, searchable}
  type Item = {
    ts: number;
    kind: "payment" | "transfer" | "notification";
    icon: string;
    color: string;
    title: string;
    sub: string;
    search: string;
  };
  const items: Item[] = useMemo(() => {
    const list: Item[] = [];
    for (const p of payments) {
      const method = (p.method ?? "").toLowerCase();
      list.push({
        ts: p.createdAt,
        kind: "payment",
        icon: "fa-credit-card",
        color: METHOD_COLOR[method] ?? "#448AFF",
        title: `${p.packageName} · ${formatINR(p.amount)}`,
        sub: `Package purchase · ${p.method.toUpperCase()}${p.discountPercent ? ` · -${p.discountPercent}%` : ""}`,
        search: `${p.packageName ?? ""} ${p.method ?? ""} ${p.amount ?? ""} package purchase`.toLowerCase(),
      });
    }
    for (const t of transfers) {
      list.push({
        ts: t.createdAt,
        kind: "transfer",
        icon: "fa-right-left",
        color: "#ffa502",
        title: `Transfer · ${formatINR(t.amount)}`,
        sub: `Wallet transfer · ${t.status ?? "pending"}`,
        search: `transfer wallet ${t.amount ?? ""} ${t.status ?? ""} ${t.username ?? ""}`.toLowerCase(),
      });
    }
    for (const n of notifications) {
      list.push({
        ts: n.timestamp,
        kind: "notification",
        icon: "fa-bell",
        color: "#00d4ff",
        title: n.title,
        sub: n.message ?? "",
        search: `${n.title ?? ""} ${n.message ?? ""} ${n.type ?? ""}`.toLowerCase(),
      });
    }
    list.sort((a, b) => b.ts - a.ts);
    return list;
  }, [payments, transfers, notifications]);

  // Apply filter + search
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (filter !== "all" && it.kind !== filter) return false;
      if (q && !it.search.includes(q)) return false;
      return true;
    });
  }, [items, filter, query]);

  const feed = filtered.slice(0, 30);
  const counts = {
    all: items.length,
    payment: items.filter((i) => i.kind === "payment").length,
    transfer: items.filter((i) => i.kind === "transfer").length,
    notification: items.filter((i) => i.kind === "notification").length,
  };

  const totalRevenue = payments.reduce((s, p) => s + (p.amount ?? 0), 0);
  const avgTicket = payments.length
    ? Math.round(totalRevenue / payments.length)
    : 0;

  return (
    <section id="activity" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
              <span className="revo-pulse text-[#2ed573]">●</span> Live Activity
            </div>
            <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
              Recent <span className="revo-gradient-text">transactions</span>
            </h2>
            <p className="mt-1 text-sm text-[#8899cc]">
              Latest real package payments, transfers &amp; notifications.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="revo-card px-4 py-2">
              <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">
                Tracked revenue
              </div>
              <div className="text-lg font-black text-[#2ed573]">
                {formatINR(totalRevenue)}
              </div>
            </div>
            <div className="revo-card px-4 py-2">
              <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">
                Avg ticket
              </div>
              <div className="text-lg font-black text-[#FFD700]">
                {formatINR(avgTicket)}
              </div>
            </div>
            <a
              href="/api/export-pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="revo-btn flex items-center gap-2 self-center rounded-lg px-4 py-2.5 text-xs font-bold"
            >
              <i className="fas fa-file-pdf" /> PDF
            </a>
            <a
              href="/api/export-csv"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 self-center rounded-lg border border-[#2ed573]/40 bg-[#2ed573]/10 px-4 py-2.5 text-xs font-bold text-[#2ed573] transition hover:bg-[#2ed573]/20"
            >
              <i className="fas fa-file-csv" /> CSV
            </a>
          </div>
        </div>

        {/* Search + filter bar */}
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <i className="fas fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-[#5a6a99]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search transactions, methods, amounts…"
              className="w-full rounded-xl border border-[#1e2240] bg-[#0d1020] py-2.5 pl-9 pr-9 text-sm text-white outline-none transition placeholder:text-[#5a6a99] focus:border-[#448AFF] focus:ring-2 focus:ring-[#448AFF]/30"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5a6a99] transition hover:text-white"
                aria-label="Clear search"
              >
                <i className="fas fa-xmark" />
              </button>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto revo-scroll rounded-xl border border-[#1e2240] bg-[#0d1020] p-1">
            {(
              [
                ["all", "All", "fa-layer-group"],
                ["payment", "Payments", "fa-credit-card"],
                ["transfer", "Transfers", "fa-right-left"],
                ["notification", "Alerts", "fa-bell"],
              ] as const
            ).map(([k, label, icon]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  filter === k
                    ? "bg-[#448AFF] text-white shadow"
                    : "text-[#8899cc] hover:text-white"
                }`}
              >
                <i className={`fas ${icon} text-[10px]`} />
                {label}
                <span className="rounded-full bg-black/20 px-1.5 py-0.5 text-[9px]">
                  {counts[k]}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="revo-card overflow-hidden">
          <div className="max-h-[28rem] overflow-y-auto revo-scroll">
            {loading ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-14 rounded-xl revo-shimmer" />
                ))}
              </div>
            ) : feed.length === 0 ? (
              <div className="p-10 text-center text-sm text-[#5a6a99]">
                {query || filter !== "all"
                  ? "No matching transactions. Try a different search or filter."
                  : "No recent activity."}
              </div>
            ) : (
              <ul className="relative">
                {/* timeline vertical connector */}
                <span
                  className="pointer-events-none absolute left-[2.05rem] top-3 bottom-3 w-px bg-gradient-to-b from-[#448AFF]/40 via-[#448AFF]/15 to-transparent"
                  aria-hidden
                />
                {feed.map((it, i) => (
                  <li
                    key={i}
                    className="group relative flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.03]"
                  >
                    <span
                      className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base ring-2 ring-[#0a0b14]"
                      style={{ background: `${it.color}1a`, color: it.color }}
                    >
                      <i className={`fas ${it.icon}`} />
                      {i === 0 && (
                        <span
                          className="absolute inset-0 rounded-xl"
                          style={{ boxShadow: `0 0 0 2px ${it.color}40` }}
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-white">
                        {it.title}
                      </div>
                      <div className="truncate text-[11px] text-[#5a6a99]">
                        {it.sub}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-[#1e2240] bg-[#0d1020]/60 px-2 py-0.5 text-[10px] font-medium text-[#5a6a99]">
                      {timeAgo(it.ts)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
