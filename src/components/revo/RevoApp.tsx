"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { RevoBackground } from "./RevoBackground";
import { RevoNavbar } from "./RevoNavbar";
import { RevoHero } from "./RevoHero";
import { RevoStats } from "./RevoStats";
import { RevoPackages } from "./RevoPackages";
import { RevoPayments } from "./RevoPayments";
import { RevoActivity } from "./RevoActivity";
import { RevoDashboard } from "./RevoDashboard";
import { RevoFooter } from "./RevoFooter";
import { RevoRevenue } from "./RevoRevenue";
import { RevoConverter } from "./RevoConverter";
import { RevoFaq } from "./RevoFaq";

import type {
  AppSettings,
  NotificationItem,
  Package,
  PackagePayment,
  PaymentMethods,
  SecurityCode,
  TransferRequest,
  UserRecord,
} from "@/lib/types";
import { formatINR } from "./lib";

interface Stats {
  totalLicenseKeys: number;
  totalUsers: number;
  totalPackagePayments: number;
  totalPaymentRequests: number;
  totalTransferRequests: number;
  totalActivationCodes: number;
  usedActivationCodes: number;
  totalAdminKeys: number;
  totalNotifications: number;
}

interface ActivityData {
  payments: PackagePayment[];
  transfers: TransferRequest[];
}

const SESSION_KEY = "revo_session_v1";
interface Session {
  key: string;
  uid: string;
}

// --- Persisted session via useSyncExternalStore (SSR-safe, no setState-in-effect) ---
let cachedSessionRaw: string | null = null;
let cachedSession: Session | null = null;
const listeners = new Set<() => void>();

function readSessionRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function getSessionSnapshot(): Session | null {
  const raw = readSessionRaw();
  if (raw === cachedSessionRaw) return cachedSession;
  cachedSessionRaw = raw;
  if (!raw) {
    cachedSession = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    cachedSession =
      parsed && parsed.key && parsed.uid !== undefined
        ? { key: parsed.key, uid: parsed.uid }
        : null;
  } catch {
    cachedSession = null;
  }
  return cachedSession;
}
function getSessionServerSnapshot(): Session | null {
  return null;
}
function subscribeSession(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SESSION_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
function writeSession(s: Session | null) {
  try {
    if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(SESSION_KEY);
    cachedSessionRaw = null;
    cachedSession = null;
    listeners.forEach((l) => l());
  } catch {
    /* ignore */
  }
}

export function RevoApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const [loadingPayments, setLoadingPayments] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);

  const session = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getSessionServerSnapshot,
  );
  // Dashboard is shown exactly when a verified session exists (derived, no effect).
  const showDashboard = session !== null;

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // live data polling
  useEffect(() => {
    let active = true;
    async function loadAll() {
      const [s, p, m, st, a, n] = await Promise.all([
        fetch("/api/app-settings").then((r) => r.json() as Promise<AppSettings>),
        fetch("/api/packages").then((r) => r.json() as Promise<Package[]>),
        fetch("/api/payment-methods")
          .then((r) => r.json() as Promise<PaymentMethods>)
          .finally(() => active && setLoadingPayments(false)),
        fetch("/api/stats").then((r) => r.json() as Promise<Stats>),
        fetch("/api/activity")
          .then((r) => r.json() as Promise<ActivityData>)
          .finally(() => active && setLoadingActivity(false)),
        fetch("/api/notifications").then(
          (r) => r.json() as Promise<NotificationItem[]>,
        ),
      ]);
      if (!active) return;
      setSettings(s);
      setPackages(p);
      setMethods(m);
      setStats(st);
      setActivity(a);
      setNotifications(n);
    }
    loadAll();
    const t = setInterval(loadAll, 25000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const handleVerified = useCallback(
    (key: string, data: Partial<SecurityCode>) => {
      const uid = data.usedBy ?? "";
      writeSession({ key, uid });
      toast.success("License activated!", {
        description: uid
          ? "Loading your live dashboard…"
          : "Key verified — no account bound yet.",
      });
      setTimeout(() => scrollTo("home"), 100);
    },
    [scrollTo],
  );

  const handleLogout = useCallback(() => {
    writeSession(null);
    toast.info("Logged out");
  }, []);

  const handleBuy = useCallback(
    (pkg: Package, finalPrice: number) => {
      toast.success(`${pkg.name} selected · ${formatINR(finalPrice)}`, {
        description: "Scroll to payment methods to complete your purchase.",
      });
      scrollTo("payments");
    },
    [scrollTo],
  );

  const handleSupport = useCallback(() => {
    if (settings?.telegramLink) {
      window.open(settings.telegramLink, "_blank", "noopener");
    } else {
      scrollTo("support");
    }
  }, [settings, scrollTo]);

  const handleBuyNav = useCallback(() => scrollTo("packages"), [scrollTo]);

  return (
    <div className="relative flex min-h-screen flex-col">
      <RevoBackground />

      <div className="relative z-10 flex min-h-screen flex-col">
        <RevoNavbar
          onBuy={handleBuyNav}
          onGo={scrollTo}
          maintenanceMode={settings?.maintenanceMode}
          forceUpdate={settings?.forceUpdate}
        />

        {/* maintenance banner */}
        {settings?.maintenanceMode && (
          <div className="border-b border-[#ffa502]/30 bg-[#ffa502]/10 px-4 py-2 text-center text-sm font-semibold text-[#ffa502]">
            <i className="fas fa-triangle-exclamation mr-2" />
            {settings.maintenanceMessage ?? "We are updating our system. Please check back later."}
          </div>
        )}

        <main className="flex-1">
          {showDashboard && session ? (
            session.uid ? (
              <RevoDashboard
                licenseKey={session.key}
                uid={session.uid}
                onLogout={handleLogout}
                onBuy={handleBuyNav}
              />
            ) : (
              // verified key but no user record (unused key) — show summary
              <VerifiedNoRecord
                onLogout={handleLogout}
                onBuy={handleBuyNav}
              />
            )
          ) : (
            <RevoHero
              settings={settings}
              onVerified={handleVerified}
              onBuy={handleBuyNav}
              onSupport={handleSupport}
            />
          )}

          <RevoPackages
            packages={packages}
            settings={settings}
            onBuy={handleBuy}
          />

          <RevoRevenue />

          <RevoConverter settings={settings} />

          <RevoStats stats={stats} settings={settings} />

          <RevoPayments methods={methods} loading={loadingPayments} />

          <RevoActivity
            data={activity}
            notifications={notifications}
            loading={loadingActivity}
          />

          <RevoFaq settings={settings} />
        </main>

        <RevoFooter settings={settings} onGo={scrollTo} />
      </div>
  </div>
  );
}

function VerifiedNoRecord({
  onLogout,
  onBuy,
}: {
  onLogout: () => void;
  onBuy: () => void;
}) {
  return (
    <section className="px-4 py-16 sm:px-6">
      <div className="revo-card revo-card-glow mx-auto max-w-xl p-8 text-center">
        <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-[#2ed573]/15 text-3xl text-[#2ed573]">
          <i className="fas fa-circle-check" />
        </span>
        <h2 className="text-2xl font-black text-white">License verified</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[#8899cc]">
          Your license key is valid but has not been bound to a user account yet.
          Complete a package purchase to activate your dashboard.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button onClick={onBuy} className="revo-btn-gold rounded-xl px-5 py-3 text-sm font-bold">
            <i className="fas fa-shopping-cart mr-1.5" /> Buy a package
          </button>
          <button
            onClick={onLogout}
            className="rounded-xl border border-[#1e2240] bg-[#141827] px-5 py-3 text-sm font-semibold text-[#bcc6e0] transition hover:bg-[#1e2240] hover:text-white"
          >
            <i className="fas fa-right-from-bracket mr-1.5" /> Logout
          </button>
        </div>
      </div>
    </section>
  );
}
