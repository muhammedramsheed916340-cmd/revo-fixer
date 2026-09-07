"use client";

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

export function RevoActivity({
  data,
  notifications,
  loading,
}: {
  data: ActivityData | null;
  notifications: NotificationItem[];
  loading: boolean;
}) {
  const payments = data?.payments ?? [];
  const transfers = data?.transfers ?? [];

  // Merge into a single timeline of {ts, kind, icon, text, color}
  type Item = {
    ts: number;
    icon: string;
    color: string;
    title: string;
    sub: string;
  };
  const items: Item[] = [];
  for (const p of payments) {
    items.push({
      ts: p.createdAt,
      icon: "fa-credit-card",
      color: METHOD_COLOR[p.method] ?? "#448AFF",
      title: `${p.packageName} · ${formatINR(p.amount)}`,
      sub: `Package purchase · ${p.method.toUpperCase()}${p.discountPercent ? ` · -${p.discountPercent}%` : ""}`,
    });
  }
  for (const t of transfers) {
    items.push({
      ts: t.createdAt,
      icon: "fa-right-left",
      color: "#ffa502",
      title: `Transfer · ${formatINR(t.amount)}`,
      sub: `Wallet transfer · ${t.status ?? "pending"}`,
    });
  }
  for (const n of notifications) {
    items.push({
      ts: n.timestamp,
      icon: "fa-bell",
      color: "#00d4ff",
      title: n.title,
      sub: n.message ?? "",
    });
  }
  items.sort((a, b) => b.ts - a.ts);
  const feed = items.slice(0, 16);

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
          <div className="flex gap-2">
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
                No recent activity.
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
