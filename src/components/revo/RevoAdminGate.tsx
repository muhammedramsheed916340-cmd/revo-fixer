"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { formatINR, formatDateTime, timeAgo, copyText } from "./lib";

// ---------------------------------------------------------------------------
// Bypass PIN — skip the complex XXXX-XXXX-XXXX-XXXX admin key.
// The owner can type a simple 10-digit code to enter the read-only panel.
// (The real admin key path still works as a fallback.)
// ---------------------------------------------------------------------------
const ADMIN_KEY = "revo_admin_session_v1";

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

// ---------------------------------------------------------------------------
// PIN-based login (skips complex admin key format).
// Accepts a 10-digit numeric PIN or a full admin key as fallback.
// ---------------------------------------------------------------------------
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
    const trimmed = raw.trim();
    if (!trimmed) {
      setStatus("error");
      setMsg("Enter your access code.");
      return;
    }
    setStatus("verifying");
    setMsg("Verifying…");
    try {
      const res = await fetch("/api/verify-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmed }),
      });
      const json: { ok: boolean; key?: string; mode?: string } =
        await res.json();
      if (json.ok && json.key) {
        writeAdmin(json.key);
        toast.success("Admin access granted", {
          description:
            json.mode === "pin"
              ? "Unlocked via PIN bypass · read-only panel"
              : "Unlocked via admin key · read-only panel",
        });
        onVerified(json.key);
      } else {
        setStatus("error");
        setMsg("Invalid access code. Try again.");
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
        Access Code (PIN or admin key)
      </label>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && verify()}
        placeholder="Enter PIN (e.g. 8950888988)"
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
            <i className="fas fa-unlock" /> Unlock Admin Panel
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
        Read-only view. Key generation writes to the live DB.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key Generation tab
// ---------------------------------------------------------------------------
interface GenResult {
  kind: "license" | "signal" | "admin";
  key?: string;
  code?: string;
  at: number;
}

function GenerateTab({ onReload }: { onReload: () => void }) {
  const [tab, setTab] = useState<"license" | "signal" | "admin">("license");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [error, setError] = useState("");

  // License form state
  const [licName, setLicName] = useState("1h");
  const [licHours, setLicHours] = useState(1);
  const [licPrice, setLicPrice] = useState(2000);
  const [licOrig, setLicOrig] = useState(2500);

  // Admin form state
  const [admLabel, setAdmLabel] = useState("Admin");
  const [admMax, setAdmMax] = useState(50);

  const run = useCallback(
    async (kind: "license" | "signal" | "admin") => {
      setBusy(true);
      setError("");
      setResult(null);
      try {
        const payload: Record<string, unknown> = { kind };
        if (kind === "license") {
          payload.name = licName;
          payload.hours = licHours;
          payload.finalPrice = licPrice;
          payload.originalPrice = licOrig;
        } else if (kind === "admin") {
          payload.label = admLabel;
          payload.maxLogins = admMax;
        }
        const res = await fetch("/api/generate-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json: {
          ok: boolean;
          key?: string;
          code?: string;
          error?: string;
        } = await res.json();
        if (json.ok) {
          const r: GenResult = {
            kind,
            key: json.key,
            code: json.code,
            at: Date.now(),
          };
          setResult(r);
          toast.success(
            `${kind === "license" ? "License key" : kind === "signal" ? "Signal code" : "Admin key"} generated`,
            {
              description: json.key ?? json.code,
            },
          );
          onReload();
        } else {
          setError(json.error ?? "Generation failed");
          toast.error("Generation failed", {
            description: json.error ?? "Unknown error",
          });
        }
      } catch (e) {
        const m = e instanceof Error ? e.message : "Network error";
        setError(m);
        toast.error("Generation failed", { description: m });
      } finally {
        setBusy(false);
      }
    },
    [licName, licHours, licPrice, licOrig, admLabel, admMax, onReload],
  );

  const value = result?.key ?? result?.code ?? "";

  return (
    <div className="space-y-3">
      {/* Sub-tabs */}
      <div className="flex gap-1 rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-1">
        {(
          [
            ["license", "License Key", "fa-key"],
            ["signal", "Signal Code", "fa-signal"],
            ["admin", "Admin Key", "fa-user-shield"],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => {
              setTab(id);
              setResult(null);
              setError("");
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${
              tab === id
                ? "bg-[#a78bfa]/20 text-[#a78bfa]"
                : "text-[#8899cc] hover:text-white"
            }`}
          >
            <i className={`fas ${icon} text-[10px]`} />
            {label}
          </button>
        ))}
      </div>

      {/* License form */}
      {tab === "license" && (
        <div className="space-y-2 rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
                Package Name
              </span>
              <input
                value={licName}
                onChange={(e) => setLicName(e.target.value)}
                className="w-full rounded-lg border border-[#1e2240] bg-[#0d1020] px-3 py-2 text-sm text-white outline-none focus:border-[#a78bfa]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
                Hours
              </span>
              <input
                type="number"
                min={1}
                value={licHours}
                onChange={(e) => setLicHours(Number(e.target.value) || 1)}
                className="w-full rounded-lg border border-[#1e2240] bg-[#0d1020] px-3 py-2 text-sm text-white outline-none focus:border-[#a78bfa]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
                Final Price (₹)
              </span>
              <input
                type="number"
                min={0}
                value={licPrice}
                onChange={(e) => setLicPrice(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-[#1e2240] bg-[#0d1020] px-3 py-2 text-sm text-white outline-none focus:border-[#a78bfa]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
                Original Price (₹)
              </span>
              <input
                type="number"
                min={0}
                value={licOrig}
                onChange={(e) => setLicOrig(Number(e.target.value) || 0)}
                className="w-full rounded-lg border border-[#1e2240] bg-[#0d1020] px-3 py-2 text-sm text-white outline-none focus:border-[#a78bfa]"
              />
            </label>
          </div>
          <button
            onClick={() => run("license")}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#2ed573] to-[#1abc9c] px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-60"
          >
            {busy ? (
              <i className="fas fa-spinner fa-spin" />
            ) : (
              <i className="fas fa-plus" />
            )}
            Generate License Key
          </button>
        </div>
      )}

      {/* Signal form */}
      {tab === "signal" && (
        <div className="space-y-2 rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-3">
          <p className="text-[11px] text-[#8899cc]">
            Generates a fresh 10-digit numeric signal code in{" "}
            <code className="text-[#a78bfa]">activation_codes</code>. Active and
            ready to distribute.
          </p>
          <button
            onClick={() => run("signal")}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#ffa502] to-[#ff7f50] px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-60"
          >
            {busy ? (
              <i className="fas fa-spinner fa-spin" />
            ) : (
              <i className="fas fa-bolt" />
            )}
            Generate Signal Code
          </button>
        </div>
      )}

      {/* Admin form */}
      {tab === "admin" && (
        <div className="space-y-2 rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
                Label
              </span>
              <input
                value={admLabel}
                onChange={(e) => setAdmLabel(e.target.value)}
                className="w-full rounded-lg border border-[#1e2240] bg-[#0d1020] px-3 py-2 text-sm text-white outline-none focus:border-[#a78bfa]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
                Max Logins
              </span>
              <input
                type="number"
                min={1}
                value={admMax}
                onChange={(e) => setAdmMax(Number(e.target.value) || 1)}
                className="w-full rounded-lg border border-[#1e2240] bg-[#0d1020] px-3 py-2 text-sm text-white outline-none focus:border-[#a78bfa]"
              />
            </label>
          </div>
          <button
            onClick={() => run("admin")}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#a78bfa] to-[#7c3aed] px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-60"
          >
            {busy ? (
              <i className="fas fa-spinner fa-spin" />
            ) : (
              <i className="fas fa-user-shield" />
            )}
            Generate Admin Key
          </button>
        </div>
      )}

      {/* Result */}
      {value && (
        <div className="rounded-xl border border-[#2ed573]/40 bg-[#2ed573]/10 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#2ed573]">
              <i className="fas fa-check-circle mr-1" />
              Generated ·{" "}
              {result?.kind === "license"
                ? "License"
                : result?.kind === "signal"
                  ? "Signal"
                  : "Admin"}
            </span>
            <button
              onClick={async () => {
                const ok = await copyText(value);
                toast[ok ? "success" : "error"](
                  ok ? "Copied to clipboard" : "Copy failed",
                );
              }}
              className="rounded-md border border-[#1e2240] bg-[#141827] px-2 py-1 text-[10px] font-bold text-[#8899cc] transition hover:text-white"
            >
              <i className="fas fa-copy mr-1" />
              Copy
            </button>
          </div>
          <code className="block break-all font-mono text-sm font-bold text-white">
            {value}
          </code>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[#ff4757]/40 bg-[#ff4757]/10 p-3 text-sm font-semibold text-[#ff4757]">
          <i className="fas fa-triangle-exclamation mr-1" />
          {error}
        </div>
      )}
    </div>
  );
}

function Panel({
  adminKey,
  data,
  loading,
  onLogout,
  onReload,
}: {
  adminKey: string;
  data: AdminData | null;
  loading: boolean;
  onLogout: () => void;
  onReload: () => void;
}) {
  const [tab, setTab] = useState<
    "security" | "admins" | "codes" | "requests" | "generate"
  >("security");
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
                {adminKey === "BYPASS-PIN" ? "PIN · Live" : "Live · Read-only"}
              </span>
            </div>
            <div className="font-mono text-[11px] text-[#5a6a99]">
              {adminKey === "BYPASS-PIN" ? "Unlocked via bypass PIN" : adminKey}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReload}
            disabled={loading}
            className="rounded-lg border border-[#1e2240] bg-[#141827] px-3 py-1.5 text-xs font-semibold text-[#8899cc] transition hover:bg-[#1e2240] hover:text-white disabled:opacity-50"
            title="Refresh data"
          >
            <i className={`fas fa-rotate ${loading ? "fa-spin" : ""} mr-1`} />
            Refresh
          </button>
          <button
            onClick={onLogout}
            className="rounded-lg border border-[#1e2240] bg-[#141827] px-3 py-1.5 text-xs font-semibold text-[#8899cc] transition hover:bg-[#1e2240] hover:text-white"
          >
            <i className="fas fa-right-from-bracket mr-1" /> Lock
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-[#1e2240] bg-[#0d1020]/40 p-2 revo-scroll">
        {(
          [
            ["security", "License Keys", "fa-key", sec?.total ?? 0],
            ["admins", "Admin Keys", "fa-user-shield", totalAdminKeys],
            ["codes", "Signal Codes", "fa-signal", totalCodes],
            ["requests", "Pay Requests", "fa-credit-card", data?.paymentRequests.length ?? 0],
            ["generate", "Generate", "fa-wand-magic-sparkles", null],
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
            {count !== null && (
              <span className="rounded-full bg-[#1e2240] px-1.5 py-0.5 text-[9px] text-[#bcc6e0]">
                {count}
              </span>
            )}
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
        ) : tab === "requests" ? (
          <RequestsTab data={data} />
        ) : (
          <GenerateTab onReload={onReload} />
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin-data");
      const json: AdminData = await res.json();
      setData(json);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  // Load admin data whenever the panel is unlocked.
  useEffect(() => {
    if (!adminKey) return;
    let active = true;
    const run = async () => {
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
    };
    run();
    const t = setInterval(run, 30000);
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
            Real-time view of license keys, admin keys, signal codes, payment
            requests + key generation.
          </p>
        </div>

        {adminKey ? (
          <Panel
            adminKey={adminKey}
            data={data}
            loading={loading}
            onReload={load}
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
