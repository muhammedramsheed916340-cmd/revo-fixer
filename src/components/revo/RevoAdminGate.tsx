"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { formatINR, formatDateTime, timeAgo, normalizeKey } from "./lib";

const ADMIN_KEY_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

interface AdminKeyLite {
  originalKey: string;
  status: string;
  loginCount: number;
  maxLogins: number;
  label?: string;
  createdAt?: number;
  lastLogin?: number;
}
interface ActivationCode {
  originalCode: string;
  active: boolean;
  used: boolean;
  usedAt?: number;
  usedBy?: string;
  usedFor?: string;
  createdAt?: number;
  createdBy?: string;
}
interface SecurityOverview {
  total: number;
  byStatus: Record<string, number>;
  recent: {
    key: string;
    status: string;
    name?: string;
    hours?: number;
    finalPrice?: number;
    usedAt?: number;
    createdAt?: number;
    totalDevices?: number;
  }[];
}
interface PaymentReqLite {
  id: string;
  amount: number;
  method: string;
  currency?: string;
  status?: string;
  createdAt: number;
  approvedAt?: number;
}
interface AdminData {
  adminKeys: AdminKeyLite[];
  activationCodes: ActivationCode[];
  security: SecurityOverview;
  paymentRequests: PaymentReqLite[];
}

// --- Admin session persistence (SSR-safe via useSyncExternalStore) ---
const ADMIN_KEY = "revo_admin_session_v1";
let cachedRaw: string | null = null;
let cachedKey: string | null = null;
const listeners = new Set<() => void>();

function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ADMIN_KEY);
  } catch {
    return null;
  }
}
function snap(): string | null {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedKey;
  cachedRaw = raw;
  cachedKey = raw || null;
  return cachedKey;
}
function serverSnap(): string | null {
  return null;
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === ADMIN_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
function writeAdmin(key: string | null) {
  try {
    if (key) localStorage.setItem(ADMIN_KEY, key);
    else localStorage.removeItem(ADMIN_KEY);
    cachedRaw = null;
    cachedKey = null;
    listeners.forEach((l) => l());
  } catch {
    /* ignore */
  }
}

const STATUS_COLOR: Record<string, string> = {
  active: "#2ed573",
  used: "#448AFF",
  banned: "#ff4757",
  reset_required: "#ffa502",
  approved: "#2ed573",
  rejected: "#ff4757",
  pending: "#ffa502",
};

function Badge({ status }: { status: string }) {
  const color = STATUS_COLOR[status.toLowerCase()] ?? "#8899cc";
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ background: `${color}22`, color }}
    >
      {status}
    </span>
  );
}

function AdminLogin({
  onVerified,
  onClose,
}: {
  onVerified: (key: string) => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<"idle" | "verifying" | "error">("idle");
  const [msg, setMsg] = useState("");

  const verify = useCallback(async () => {
    const key = normalizeKey(raw);
    setRaw(key);
    if (!ADMIN_KEY_PATTERN.test(key)) {
      setStatus("error");
      setMsg("Invalid format. Use XXXX-XXXX-XXXX-XXXX");
      return;
    }
    setStatus("verifying");
    setMsg("Verifying admin key…");
    try {
      const res = await fetch("/api/verify-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const json: { ok: boolean; key?: string } = await res.json();
      if (json.ok && json.key) {
        writeAdmin(json.key);
        toast.success("Admin access granted", {
          description: "Loading read-only admin panel…",
        });
        onVerified(json.key);
      } else {
        setStatus("error");
        setMsg("Invalid or inactive admin key.");
      }
    } catch {
      setStatus("error");
      setMsg("Network error. Try again.");
    }
  }, [raw, onVerified]);

  return (
    <div className="revo-card revo-card-glow mx-auto max-w-lg p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#a78bfa]/15 text-[#a78bfa]">
            <i className="fas fa-user-shield" />
          </span>
          <div>
            <h3 className="text-lg font-black text-white">Admin Access</h3>
            <p className="text-[11px] text-[#5a6a99]">Read-only platform control</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="grid h-8 w-8 place-items-center rounded-lg border border-[#1e2240] bg-[#141827] text-[#8899cc] transition hover:text-white"
          aria-label="Close admin"
        >
          <i className="fas fa-xmark" />
        </button>
      </div>

      <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#8899cc]">
        Admin Key
      </label>
      <input
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={raw}
        onChange={(e) => setRaw(normalizeKey(e.target.value))}
        onKeyDown={(e) => e.key === "Enter" && verify()}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        maxLength={19}
        className="w-full rounded-xl border border-[#1e2240] bg-[#0d1020] px-4 py-3.5 font-mono text-base tracking-wider text-white outline-none transition placeholder:text-[#5a6a99] focus:border-[#a78bfa] focus:ring-2 focus:ring-[#a78bfa]/30"
      />
      <button
        onClick={verify}
        disabled={status === "verifying"}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-bold text-white transition disabled:opacity-60"
        style={{
          background: "linear-gradient(135deg,#a78bfa,#7c3aed)",
          boxShadow: "0 10px 24px -10px rgba(167,139,250,0.7)",
        }}
      >
        {status === "verifying" ? (
          <>
            <i className="fas fa-spinner fa-spin" /> Verifying…
          </>
        ) : (
          <>
            <i className="fas fa-key" /> Unlock Admin Panel
          </>
        )}
      </button>
      {msg && (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-center text-sm font-semibold ${
            status === "error"
              ? "border-[#ff4757]/50 bg-[#ff4757]/10 text-[#ff4757]"
              : "border-[#448AFF]/50 bg-[#448AFF]/10 text-[#448AFF]"
          }`}
        >
          {msg}
        </div>
      )}
      <p className="mt-3 text-center text-[11px] text-[#5a6a99]">
        <i className="fas fa-lock mr-1" />
        Read-only. No writes to the live database.
      </p>
    </div>
  );
}

function Panel({
  adminKey,
  data,
  loading,
  onLogout,
}: {
  adminKey: string;
  data: AdminData | null;
  loading: boolean;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<"security" | "admins" | "codes" | "requests">(
    "security",
  );
  const sec = data?.security;
  const totalAdminKeys = data?.adminKeys.length ?? 0;
  const totalCodes = data?.activationCodes.length ?? 0;
  const usedCodes = data?.activationCodes.filter((c) => c.used).length ?? 0;

  return (
    <div className="revo-card overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e2240] bg-gradient-to-r from-[#a78bfa]/10 to-transparent px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#a78bfa]/15 text-[#a78bfa]">
            <i className="fas fa-user-shield" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-white">Admin Panel</span>
              <span className="rounded-full bg-[#2ed573]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#2ed573]">
                Live · Read-only
              </span>
            </div>
            <div className="font-mono text-[11px] text-[#5a6a99]">{adminKey}</div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="rounded-lg border border-[#1e2240] bg-[#141827] px-3 py-1.5 text-xs font-semibold text-[#8899cc] transition hover:bg-[#1e2240] hover:text-white"
        >
          <i className="fas fa-right-from-bracket mr-1" /> Lock
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-[#1e2240] bg-[#0d1020]/40 p-2 revo-scroll">
        {(
          [
            ["security", "License Keys", `fa-key`, sec?.total ?? 0],
            ["admins", "Admin Keys", `fa-user-shield`, totalAdminKeys],
            ["codes", "Signal Codes", `fa-signal`, totalCodes],
            ["requests", "Pay Requests", `fa-credit-card`, data?.paymentRequests.length ?? 0],
          ] as const
        ).map(([id, label, icon, count]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              tab === id
                ? "bg-[#a78bfa]/20 text-[#a78bfa]"
                : "text-[#8899cc] hover:text-white"
            }`}
          >
            <i className={`fas ${icon} text-[10px]`} />
            {label}
            <span className="rounded-full bg-[#1e2240] px-1.5 py-0.5 text-[9px] text-[#bcc6e0]">
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="max-h-[32rem] overflow-y-auto revo-scroll p-4">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 rounded-xl revo-shimmer" />
            ))}
          </div>
        ) : tab === "security" ? (
          <SecurityTab data={data} />
        ) : tab === "admins" ? (
          <AdminsTab data={data} />
        ) : tab === "codes" ? (
          <CodesTab data={data} />
        ) : (
          <RequestsTab data={data} />
        )}
      </div>

      {/* Summary strip */}
      {!loading && sec && (
        <div className="grid grid-cols-2 gap-2 border-t border-[#1e2240] bg-[#0d1020]/40 p-3 sm:grid-cols-4">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">
              Total keys
            </div>
            <div className="text-base font-black text-white">{sec.total}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">
              Active
            </div>
            <div className="text-base font-black text-[#2ed573]">
              {sec.byStatus.active ?? 0}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">
              Used
            </div>
            <div className="text-base font-black text-[#448AFF]">
              {sec.byStatus.used ?? 0}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">
              Banned
            </div>
            <div className="text-base font-black text-[#ff4757]">
              {sec.byStatus.banned ?? 0}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SecurityTab({ data }: { data: AdminData | null }) {
  const recent = data?.security.recent ?? [];
  if (!recent.length)
    return <div className="p-6 text-center text-sm text-[#5a6a99]">No keys found.</div>;
  return (
    <div className="space-y-2">
      {recent.map((k) => (
        <div
          key={k.key}
          className="flex items-center justify-between gap-3 rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-sm font-bold text-white">
                {k.key}
              </span>
              <Badge status={k.status} />
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[#5a6a99]">
              {k.name ?? "—"} · {k.hours ?? 0}h
              {k.finalPrice ? ` · ${formatINR(k.finalPrice)}` : ""}
              {k.totalDevices ? ` · ${k.totalDevices} device${k.totalDevices !== 1 ? "s" : ""}` : ""}
            </div>
          </div>
          <div className="shrink-0 text-right text-[10px] text-[#5a6a99]">
            <div>Created</div>
            <div>{timeAgo(k.createdAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminsTab({ data }: { data: AdminData | null }) {
  const list = data?.adminKeys ?? [];
  if (!list.length)
    return <div className="p-6 text-center text-sm text-[#5a6a99]">No admin keys.</div>;
  const sorted = [...list].sort((a, b) => (b.lastLogin ?? 0) - (a.lastLogin ?? 0));
  return (
    <div className="space-y-2">
      {sorted.map((a) => {
        const pct = a.maxLogins ? Math.min(100, (a.loginCount / a.maxLogins) * 100) : 0;
        return (
          <div
            key={a.originalKey}
            className="rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-sm font-bold text-white">
                {a.originalKey}
              </span>
              <Badge status={a.status} />
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-[#5a6a99]">
              <span>{a.label ?? "Admin"}</span>
              <span>
                {a.loginCount}/{a.maxLogins} logins · last {timeAgo(a.lastLogin)}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#1e2240]">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${pct}%`,
                  background:
                    pct >= 90
                      ? "linear-gradient(90deg,#ff4757,#ffa502)"
                      : "linear-gradient(90deg,#a78bfa,#448AFF)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CodesTab({ data }: { data: AdminData | null }) {
  const list = data?.activationCodes ?? [];
  if (!list.length)
    return <div className="p-6 text-center text-sm text-[#5a6a99]">No signal codes.</div>;
  const sorted = [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return (
    <div className="space-y-2">
      {sorted.map((c) => (
        <div
          key={c.originalCode}
          className="flex items-center justify-between gap-3 rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-sm font-bold text-white">
                {c.originalCode}
              </span>
              {c.used ? (
                <Badge status="used" />
              ) : (
                <Badge status="active" />
              )}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[#5a6a99]">
              {c.usedFor ?? "Crazy Time Revo Signal"}
              {c.createdBy ? ` · by ${c.createdBy}` : ""}
            </div>
          </div>
          <div className="shrink-0 text-right text-[10px] text-[#5a6a99]">
            <div>{c.used ? "Used" : "Created"}</div>
            <div>{timeAgo(c.used ? c.usedAt : c.createdAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RequestsTab({ data }: { data: AdminData | null }) {
  const list = data?.paymentRequests ?? [];
  if (!list.length)
    return <div className="p-6 text-center text-sm text-[#5a6a99]">No payment requests.</div>;
  return (
    <div className="space-y-2">
      {list.map((r) => (
        <div
          key={r.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">
                {formatINR(r.amount)}
              </span>
              <Badge status={r.status ?? "pending"} />
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[#5a6a99]">
              {r.method.toUpperCase()} · {r.currency ?? "INR"} · #{r.id.slice(-6)}
            </div>
          </div>
          <div className="shrink-0 text-right text-[10px] text-[#5a6a99]">
            <div>{timeAgo(r.createdAt)}</div>
            <div>{formatDateTime(r.approvedAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function RevoAdminGate() {
  const adminKey = useSyncExternalStore(subscribe, snap, serverSnap);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-open panel when an admin session is restored.
  useEffect(() => {
    if (adminKey) setOpen(true);
  }, [adminKey]);

  // Load admin data whenever the panel is unlocked.
  useEffect(() => {
    if (!adminKey) return;
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/admin-data");
        const json: AdminData = await res.json();
        if (active) setData(json);
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
  }, [adminKey]);

  if (!open && !adminKey) {
    return (
      <section id="admin" className="scroll-mt-20 px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <button
            onClick={() => setOpen(true)}
            className="revo-card group inline-flex items-center gap-3 px-6 py-4 transition hover:ring-1 hover:ring-[#a78bfa]/40"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#a78bfa]/15 text-[#a78bfa] transition group-hover:scale-110">
              <i className="fas fa-user-shield text-lg" />
            </span>
            <span className="text-left">
              <span className="block text-sm font-black text-white">
                Admin Access
              </span>
              <span className="block text-[11px] text-[#5a6a99]">
                Unlock read-only platform control
              </span>
            </span>
            <i className="fas fa-chevron-right text-[#5a6a99] transition group-hover:translate-x-1" />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section id="admin" className="scroll-mt-20 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#a78bfa]">
            <i className="fas fa-user-shield" /> Admin Console
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Platform <span className="text-[#a78bfa]">control center</span>
          </h2>
          <p className="mt-1 text-sm text-[#8899cc]">
            Real-time read-only view of license keys, admin keys, signal codes
            and payment requests.
          </p>
        </div>

        {adminKey ? (
          <Panel
            adminKey={adminKey}
            data={data}
            loading={loading}
            onLogout={() => {
              writeAdmin(null);
              setOpen(false);
              toast.info("Admin session locked");
            }}
          />
        ) : (
          <AdminLogin
            onVerified={(k) => {
              /* session written by AdminLogin; effect opens panel */
              void k;
            }}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </section>
  );
}
