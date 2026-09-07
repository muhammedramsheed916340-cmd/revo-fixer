"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatINR } from "./lib";

interface RevenueSummary {
  totalRevenue: number;
  totalPayments: number;
  avgTicket: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  byMethod: { method: string; revenue: number; count: number }[];
  byPackage: { package: string; revenue: number; count: number }[];
  byDay: { day: string; revenue: number; count: number }[];
  byPackageMethod: {
    package: string;
    methods: { method: string; revenue: number; count: number }[];
    total: number;
    count: number;
  }[];
}

const METHOD_COLORS: Record<string, string> = {
  upi: "#448AFF",
  bkash: "#e2136e",
  usdt: "#2ed573",
  unknown: "#5a6a99",
};
const PKG_COLORS = ["#448AFF", "#FFD700", "#2ed573", "#ffa502", "#00d4ff", "#a78bfa"];

function TooltipBox({
  active,
  payload,
  label,
  fmt,
}: {
  active?: boolean;
  payload?: { value: number; name: string }[];
  label?: string;
  fmt: (n: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md">
      {label && <div className="mb-1 font-bold text-white">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="text-[#bcc6e0]">
          <span className="font-semibold text-white">{p.name}:</span> {fmt(p.value)}
        </div>
      ))}
    </div>
  );
}

function MiniStat({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color: string;
  icon: string;
}) {
  return (
    <div className="revo-card flex items-center gap-3 p-4">
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base"
        style={{ background: `${color}1f`, color }}
      >
        <i className={`fas ${icon}`} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-lg font-black text-white sm:text-xl">
          {value}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">
          {label}
        </div>
      </div>
    </div>
  );
}

export function RevoRevenue() {
  const [data, setData] = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"day" | "method" | "package">("day");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/revenue");
        const json: RevenueSummary = await res.json();
        if (active) setData(json);
      } catch {
        /* ignore */
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 45000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const dayData = (data?.byDay ?? []).map((d) => ({
    label: d.day.slice(5).replace("-", "/"),
    revenue: d.revenue,
    count: d.count,
  }));
  const methodData = (data?.byMethod ?? []).map((m) => ({
    label: m.method.toUpperCase(),
    revenue: m.revenue,
    count: m.count,
    fill: METHOD_COLORS[m.method] ?? "#5a6a99",
  }));
  const pkgData = (data?.byPackage ?? []).map((p, i) => ({
    label: p.package,
    revenue: p.revenue,
    count: p.count,
    fill: PKG_COLORS[i % PKG_COLORS.length],
  }));

  return (
    <section id="revenue" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <span className="revo-pulse text-[#2ed573]">●</span> Revenue Analytics
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Live <span className="revo-gradient-gold">revenue insights</span>
          </h2>
          <p className="mt-1 text-sm text-[#8899cc]">
            Aggregated from real package payments on the Revo Fixer platform.
          </p>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {loading ? (
            <>
              <div className="revo-card h-16 revo-shimmer" />
              <div className="revo-card h-16 revo-shimmer" />
              <div className="revo-card h-16 revo-shimmer" />
              <div className="revo-card h-16 revo-shimmer" />
            </>
          ) : (
            <>
              <MiniStat
                label="Approved Revenue"
                value={formatINR(data?.totalRevenue)}
                color="#2ed573"
                icon="fa-indian-rupee-sign"
              />
              <MiniStat
                label="Avg Ticket"
                value={formatINR(data?.avgTicket)}
                color="#FFD700"
                icon="fa-receipt"
              />
              <MiniStat
                label="Approved"
                value={String(data?.approvedCount ?? 0)}
                color="#448AFF"
                icon="fa-circle-check"
              />
              <MiniStat
                label="Rejected"
                value={String(data?.rejectedCount ?? 0)}
                color="#ff4757"
                icon="fa-circle-xmark"
              />
            </>
          )}
        </div>

        {/* Chart card */}
        <div className="revo-card revo-card-glow mt-4 p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <i className="fas fa-chart-area text-[#448AFF]" />
              {view === "day" && "Revenue by day (last 14 active)"}
              {view === "method" && "Revenue by payment method"}
              {view === "package" && "Revenue by package"}
            </div>
            <div className="flex gap-1 rounded-lg border border-[#1e2240] bg-[#0d1020] p-1">
              {(
                [
                  ["day", "By Day", "fa-calendar-days"],
                  ["method", "By Method", "fa-credit-card"],
                  ["package", "By Package", "fa-box"],
                ] as const
              ).map(([v, label, icon]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    view === v
                      ? "bg-[#448AFF] text-white shadow"
                      : "text-[#8899cc] hover:text-white"
                  }`}
                >
                  <i className={`fas ${icon} text-[10px]`} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-64 w-full sm:h-72">
            {loading ? (
              <div className="h-full w-full revo-shimmer rounded-xl" />
            ) : view === "day" ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dayData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#448AFF" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#448AFF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#5a6a99", fontSize: 11 }}
                    axisLine={{ stroke: "#1e2240" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#5a6a99", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    tickFormatter={(v) => "₹" + (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                  />
                  <Tooltip
                    content={<TooltipBox fmt={formatINR} />}
                    cursor={{ stroke: "#448AFF", strokeWidth: 1, strokeDasharray: "4 4" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke="#448AFF"
                    strokeWidth={2.5}
                    fill="url(#revGrad)"
                    dot={{ r: 3, fill: "#448AFF", strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: "#FFD700" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={view === "method" ? methodData : pkgData}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#5a6a99", fontSize: 11 }}
                    axisLine={{ stroke: "#1e2240" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#5a6a99", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    tickFormatter={(v) => "₹" + (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                  />
                  <Tooltip
                    content={<TooltipBox fmt={formatINR} />}
                    cursor={{ fill: "rgba(68,138,255,0.08)" }}
                  />
                  <Bar dataKey="revenue" name="Revenue" radius={[6, 6, 0, 0]} maxBarSize={64}>
                    {(view === "method" ? methodData : pkgData).map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Legend / breakdown list */}
          {!loading && (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(view === "method" ? methodData : view === "package" ? pkgData : dayData.slice(-6)).map(
                (item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[#1e2240] bg-[#0d1020]/60 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: (item as { fill?: string }).fill ?? "#448AFF" }}
                      />
                      <span className="font-semibold text-[#bcc6e0]">{item.label}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-white">{formatINR(item.revenue)}</div>
                      <div className="text-[10px] text-[#5a6a99]">
                        {item.count} payment{Number(item.count) !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        {/* Per-package deep-dive (expandable) */}
        {!loading && data?.byPackageMethod && data.byPackageMethod.length > 0 && (
          <div className="revo-card mt-4 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[#1e2240] bg-gradient-to-r from-[#FFD700]/10 to-transparent px-4 py-3">
              <i className="fas fa-magnifying-glass-chart text-[#FFD700]" />
              <span className="text-sm font-bold text-white">
                Per-package deep dive
              </span>
              <span className="ml-auto text-[11px] text-[#5a6a99]">
                Tap a row to expand method breakdown
              </span>
            </div>
            <DeepDive data={data.byPackageMethod} />
          </div>
        )}
      </div>
    </section>
  );
}

function DeepDive({
  data,
}: {
  data: RevenueSummary["byPackageMethod"];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const grandTotal = data.reduce((s, p) => s + p.total, 0);

  return (
    <div>
      {data.map((p) => {
        const isOpen = open === p.package;
        const sharePct = grandTotal > 0 ? (p.total / grandTotal) * 100 : 0;
        return (
          <div key={p.package} className="border-b border-[#1e2240]/60 last:border-0">
            <button
              onClick={() => setOpen(isOpen ? null : p.package)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.02]"
            >
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs text-[#FFD700]"
                style={{ background: "rgba(255,215,0,0.12)" }}
              >
                <i className="fas fa-box" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold text-white">
                    {p.package}
                  </span>
                  <span className="shrink-0 text-sm font-black text-[#FFD700]">
                    {formatINR(p.total)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1e2240]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#FFD700] to-[#ffa502] transition-all"
                      style={{ width: `${sharePct}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[10px] text-[#5a6a99]">
                    {p.count} pay · {sharePct.toFixed(1)}%
                  </span>
                </div>
              </div>
              <span
                className={`shrink-0 text-[#5a6a99] transition-transform duration-300 ${
                  isOpen ? "rotate-180 text-[#FFD700]" : ""
                }`}
              >
                <i className="fas fa-chevron-down text-xs" />
              </span>
            </button>
            <div
              className={`grid transition-all duration-300 ${
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <div className="grid grid-cols-1 gap-2 bg-[#0d1020]/40 px-4 py-3 sm:grid-cols-3">
                  {p.methods.map((m) => {
                    const color = METHOD_COLORS[m.method] ?? "#5a6a99";
                    const mShare = p.total > 0 ? (m.revenue / p.total) * 100 : 0;
                    return (
                      <div
                        key={m.method}
                        className="rounded-lg border border-[#1e2240] bg-[#141827] p-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className="flex items-center gap-1.5 text-xs font-bold uppercase text-white"
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: color }}
                            />
                            {m.method}
                          </span>
                          <span className="text-[10px] text-[#5a6a99]">
                            {mShare.toFixed(0)}%
                          </span>
                        </div>
                        <div className="mt-1 text-sm font-black text-white">
                          {formatINR(m.revenue)}
                        </div>
                        <div className="text-[10px] text-[#5a6a99]">
                          {m.count} payment{m.count !== 1 ? "s" : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
