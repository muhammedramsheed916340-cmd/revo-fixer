"use client";

import { useEffect, useRef, useState } from "react";
import { timeAgo } from "./lib";
import type { NotificationItem } from "@/lib/types";

const TYPE_META: Record<string, { icon: string; color: string }> = {
  payment_approved: { icon: "fa-circle-check", color: "#2ed573" },
  payment_rejected: { icon: "fa-circle-xmark", color: "#ff4757" },
  package_activated: { icon: "fa-box-open", color: "#448AFF" },
  package_expired: { icon: "fa-clock", color: "#ff4757" },
  payment_request: { icon: "fa-credit-card", color: "#ffa502" },
  default: { icon: "fa-bell", color: "#00d4ff" },
};

function meta(type?: string) {
  return (type && TYPE_META[type]) || TYPE_META.default;
}

export function RevoNotificationsBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [read, setRead] = useState<Set<string>>(() => {
    // Persist read-ids locally so the unread badge is meaningful across reloads.
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem("revo_notif_read");
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/notifications");
        const json: NotificationItem[] = await res.json();
        if (active) setItems(json);
      } catch {
        /* ignore */
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = items.filter((n) => !read.has(idKey(n))).length;

  function markAllRead() {
    const next = new Set(items.map(idKey));
    setRead(next);
    try {
      localStorage.setItem("revo_notif_read", JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-10 w-10 place-items-center rounded-lg border border-[#1e2240] bg-[#141827]/60 text-[#bcc6e0] transition hover:bg-[#1e2240] hover:text-white"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
      >
        <i className="fas fa-bell text-base" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff4757] px-1 text-[9px] font-black text-white shadow-lg">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
        {/* pulse ring when unread */}
        {unread > 0 && (
          <span className="absolute inset-0 rounded-lg ring-2 ring-[#ff4757]/40 animate-ping" style={{ animationDuration: "2s" }} />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-1.5rem)] sm:w-96">
          <div className="revo-card revo-card-glow overflow-hidden">
            {/* header */}
            <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#448AFF]/10 to-transparent px-4 py-3">
              <div className="flex items-center gap-2">
                <i className="fas fa-bell text-[#448AFF]" />
                <span className="text-sm font-black text-white">Notifications</span>
                {unread > 0 && (
                  <span className="rounded-full bg-[#ff4757]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#ff4757]">
                    {unread} new
                  </span>
                )}
              </div>
              {items.length > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] font-semibold text-[#8899cc] transition hover:text-[#448AFF]"
                >
                  <i className="fas fa-check-double mr-1" /> Mark all read
                </button>
              )}
            </div>

            {/* list */}
            <div className="max-h-80 overflow-y-auto revo-scroll">
              {loading ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-14 rounded-xl revo-shimmer" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="p-8 text-center">
                  <i className="fas fa-bell-slash mb-2 text-2xl text-[#3a3f5c]" />
                  <div className="text-sm text-[#5a6a99]">No notifications yet</div>
                </div>
              ) : (
                <ul className="divide-y divide-[#1e2240]/60">
                  {items.slice(0, 30).map((n, i) => {
                    const id = idKey(n);
                    const isUnread = !read.has(id);
                    const m = meta(n.type);
                    return (
                      <li
                        key={i}
                        className={`flex gap-3 px-4 py-3 transition hover:bg-white/[0.03] ${
                          isUnread ? "bg-[#448AFF]/[0.06]" : ""
                        }`}
                      >
                        <span
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm"
                          style={{ background: `${m.color}1f`, color: m.color }}
                        >
                          <i className={`fas ${m.icon}`} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate text-xs font-bold text-white">
                              {n.title}
                            </span>
                            {isUnread && (
                              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#448AFF]" />
                            )}
                          </div>
                          {n.message && (
                            <p className="mt-0.5 line-clamp-2 text-[11px] text-[#8899cc]">
                              {n.message}
                            </p>
                          )}
                          <div className="mt-1 text-[10px] text-[#5a6a99]">
                            {timeAgo(n.timestamp)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* footer */}
            {!loading && items.length > 0 && (
              <div className="border-t border-[#1e2240] bg-[#0d1020]/40 px-4 py-2 text-center text-[10px] text-[#5a6a99]">
                <i className="fas fa-circle-info mr-1" />
                Live from the Revo Fixer platform · auto-refresh 30s
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function idKey(n: NotificationItem): string {
  return `${n.timestamp}-${n.title}-${n.type ?? ""}`;
}
