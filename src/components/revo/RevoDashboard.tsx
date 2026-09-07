"use client";

import { useEffect, useState } from "react";
import { formatINR, formatDateTime, formatDuration, timeAgo } from "./lib";
import type { ActivityEntry, UserRecord } from "@/lib/types";

function statusColor(status?: string): string {
  switch (status) {
    case "approved":
      return "#2ed573";
    case "expired":
      return "#ff4757";
    case "pending":
      return "#ffa502";
    default:
      return "#8899cc";
  }
}

export function RevoDashboard({
  licenseKey,
  uid,
  onLogout,
  onBuy,
}: {
  licenseKey: string;
  uid: string;
  onLogout: () => void;
  onBuy: () => void;
}) {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/user?uid=${encodeURIComponent(uid)}`);
        const json: UserRecord | null = await res.json();
        if (!active) return;
        setUser(json);
      } catch {
        if (active) setError("Could not load user record.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [uid]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const pkg = user?.package;
  const remaining = pkg?.endTime ? pkg.endTime - now : 0;
  const total = pkg?.startTime && pkg?.endTime ? pkg.endTime - pkg.startTime : 0;
  const progress = total > 0 ? Math.max(0, Math.min(100, (1 - remaining / total) * 100)) : 0;
  const isActive = remaining > 0 && pkg?.status === "approved";

  const activity: ActivityEntry[] = user?.activity
    ? Object.values(user.activity).sort(
        (a, b) => (b.time ?? 0) - (a.time ?? 0),
      )
    : [];

  return (
    <section className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#2ed573]">
              <span className="revo-pulse">●</span> Active Session
            </div>
            <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
              Welcome back, <span className="revo-gradient-text">{user?.username ?? "User"}</span>
            </h2>
            <p className="mt-1 text-sm text-[#8899cc]">
              Your real account data from the Revo Fixer platform.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onBuy}
              className="revo-btn-gold rounded-xl px-4 py-2 text-sm font-bold"
            >
              <i className="fas fa-plus mr-1.5" /> Extend
            </button>
            <button
              onClick={onLogout}
              className="rounded-xl border border-[#1e2240] bg-[#141827] px-4 py-2 text-sm font-semibold text-[#bcc6e0] transition hover:bg-[#1e2240] hover:text-white"
            >
              <i className="fas fa-right-from-bracket mr-1.5" /> Logout
            </button>
          </div>
        </div>

        {/* License banner */}
        <div className="revo-card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#448AFF]/15 text-[#448AFF]">
              <i className="fas fa-key" />
            </span>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">
                Active license key
              </div>
              <div className="font-mono text-sm font-bold tracking-wider text-white">
                {licenseKey}
              </div>
            </div>
          </div>
          <span
            className="rounded-full px-3 py-1 text-xs font-bold"
            style={{
              background: `${statusColor(user ? "approved" : undefined)}22`,
              color: statusColor(user ? "approved" : undefined),
            }}
          >
            {user?.package?.status?.toUpperCase() ?? "VERIFIED"}
          </span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="revo-card h-40 revo-shimmer" />
            <div className="revo-card h-40 revo-shimmer" />
            <div className="revo-card h-40 revo-shimmer" />
          </div>
        ) : error ? (
          <div className="revo-card p-6 text-center text-sm text-[#ff4757]">
            {error}
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="revo-card p-5">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[#5a6a99]">
                  <i className="fas fa-wallet text-[#2ed573]" /> Wallet balance
                </div>
                <div className="mt-2 text-3xl font-black text-[#2ed573]">
                  {formatINR(user?.balance)}
                </div>
                <div className="mt-1 text-[11px] text-[#5a6a99]">
                  Available for transfers
                </div>
              </div>
              <div className="revo-card p-5">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[#5a6a99]">
                  <i className="fas fa-tag text-[#448AFF]" /> Package
                </div>
                <div className="mt-2 text-xl font-black text-white">
                  {pkg?.name ?? "No active package"}
                </div>
                <div className="mt-1 text-[11px] text-[#5a6a99]">
                  {pkg?.price ? `${formatINR(pkg.price)} · ` : ""}
                  {pkg?.hours ? `${pkg.hours}h access` : "—"}
                </div>
              </div>
              <div className="revo-card p-5">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[#5a6a99]">
                  <i
                    className="fas fa-circle"
                    style={{ color: statusColor(pkg?.status) }}
                  />{" "}
                  Status
                </div>
                <div
                  className="mt-2 text-xl font-black"
                  style={{ color: statusColor(pkg?.status) }}
                >
                  {isActive ? "ACTIVE" : (pkg?.status ?? "—").toUpperCase()}
                </div>
                <div className="mt-1 text-[11px] text-[#5a6a99]">
                  {pkg?.endTime ? `Until ${formatDateTime(pkg.endTime)}` : "—"}
                </div>
              </div>
            </div>

            {/* Timer */}
            <div className="revo-card revo-card-glow mt-4 p-6">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
                  <i className="fas fa-stopwatch" /> Access Timer
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{
                    background: `${statusColor(isActive ? "approved" : "expired")}22`,
                    color: statusColor(isActive ? "approved" : "expired"),
                  }}
                >
                  {isActive ? "COUNTING DOWN" : "EXPIRED"}
                </span>
              </div>
              <div className="text-center">
                <div
                  className={`font-mono text-5xl font-black tabular-nums sm:text-6xl ${
                    isActive ? "revo-gradient-text" : "text-[#5a6a99]"
                  }`}
                >
                  {formatDuration(remaining)}
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#0d1020]">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${progress}%`,
                    background:
                      "linear-gradient(90deg,#2ed573,#448AFF)",
                  }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-[#5a6a99]">
                <span>
                  Started: {formatDateTime(pkg?.startTime)}
                </span>
                <span>{Math.round(progress)}% used</span>
                <span>
                  Ends: {formatDateTime(pkg?.endTime)}
                </span>
              </div>
            </div>

            {/* Activity log */}
            <div className="revo-card mt-4 overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#1e2240] px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <i className="fas fa-clock-rotate-left text-[#448AFF]" /> Activity log
                </div>
                <span className="text-[11px] text-[#5a6a99]">
                  {activity.length} entries
                </span>
              </div>
              <div className="max-h-80 overflow-y-auto revo-scroll">
                {activity.length === 0 ? (
                  <div className="p-6 text-center text-sm text-[#5a6a99]">
                    No activity yet.
                  </div>
                ) : (
                  <ul className="divide-y divide-[#1e2240]">
                    {activity.slice(0, 30).map((a, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3 px-4 py-3"
                      >
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#448AFF]" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-[#bcc6e0]">
                            {a.text ?? "—"}
                          </div>
                          <div className="text-[11px] text-[#5a6a99]">
                            {timeAgo(a.time)} · {formatDateTime(a.time)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
