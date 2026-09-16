"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { RevoBackground } from "./RevoBackground";
import { RevoNavbar } from "./RevoNavbar";
import { RevoHero } from "./RevoHero";
import { RevoStats } from "./RevoStats";
import { RevoPackages } from "./RevoPackages";
import { RevoPayments } from "./RevoPayments";
import { RevoActivity } from "./RevoActivity";
import { RevoFooter } from "./RevoFooter";
import { RevoRevenue } from "./RevoRevenue";
import { RevoConverter } from "./RevoConverter";
import { RevoFaq } from "./RevoFaq";
import { RevoAdminGate } from "./RevoAdminGate";
import { RevoVideoSensor } from "./RevoVideoSensor";
import { RevoStreakTracker } from "./RevoStreakTracker";
import { RevoPredictionTimeline } from "./RevoPredictionTimeline";
import { RevoFusionExperiment } from "./RevoFusionExperiment";
import { RevoPhysicsValidation } from "./RevoPhysicsValidation";
import { RevoComparison } from "./RevoComparison";
import { RevoDeposit } from "./RevoDeposit";
import { RevoScrollTop, RevoDivider } from "./RevoScrollTop";
import { RevoTerms } from "./RevoTerms";
import { RevoRecommender } from "./RevoRecommender";
import { RevoTicker } from "./RevoTicker";
import { RevoReveal } from "./RevoReveal";
import { RevoTestimonials } from "./RevoTestimonials";
import { RevoCommandPalette } from "./RevoCommandPalette";
import { RevoGame } from "./RevoGame";
import { RevoLiveResults } from "./RevoLiveResults";

import type {
  AppSettings,
  NotificationItem,
  Package,
  PackagePayment,
  PaymentMethods,
  TransferRequest,
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

export function RevoApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const [loadingPayments, setLoadingPayments] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Load critical data first (settings, packages, stats), then defer heavy calls.
  useEffect(() => {
    let active = true;
    async function loadCritical() {
      const [s, p, st] = await Promise.all([
        fetch("/api/app-settings").then((r) => r.json() as Promise<AppSettings>),
        fetch("/api/packages").then((r) => r.json() as Promise<Package[]>),
        fetch("/api/stats").then((r) => r.json() as Promise<Stats>),
      ]);
      if (!active) return;
      setSettings(s);
      setPackages(p);
      setStats(st);
    }
    async function loadDeferred() {
      // Wait 1.5s before loading heavy data to reduce memory pressure.
      await new Promise((r) => setTimeout(r, 1500));
      const [m, a, n] = await Promise.all([
        fetch("/api/payment-methods")
          .then((r) => r.json() as Promise<PaymentMethods>)
          .finally(() => active && setLoadingPayments(false)),
        fetch("/api/activity")
          .then((r) => r.json() as Promise<ActivityData>)
          .finally(() => active && setLoadingActivity(false)),
        fetch("/api/notifications").then(
          (r) => r.json() as Promise<NotificationItem[]>,
        ),
      ]);
      if (!active) return;
      setMethods(m);
      setActivity(a);
      setNotifications(n);
    }
    loadCritical();
    loadDeferred();
    const t = setInterval(loadCritical, 60000);
    return () => {
      active = false;
      clearInterval(t);
    };
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

  // Compare table / deposit "view package" → scroll to packages section.
  const handlePickPackage = useCallback(
    (pkg: Package) => {
      toast.info(`${pkg.name} · ${formatINR(pkg.price)}`, {
        description: `${pkg.hours}h access — see packages above.`,
      });
      scrollTo("packages");
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

  const handleExplore = useCallback(() => scrollTo("stats"), [scrollTo]);

  const handleToggleTheme = useCallback(() => {
    // Toggle theme class directly (works without importing next-themes here)
    const html = document.documentElement;
    const next = html.classList.contains("light") ? "dark" : "light";
    html.classList.remove("dark", "light");
    html.classList.add(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
  }, []);

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
          <RevoHero
            settings={settings}
            onBuy={handleBuyNav}
            onSupport={handleSupport}
            onExplore={handleExplore}
          />

          <RevoReveal>
            <RevoGame />
          </RevoReveal>

          <RevoReveal>
            <RevoLiveResults />
          </RevoReveal>

          <RevoReveal>
            <RevoStreakTracker />
          </RevoReveal>

          <RevoReveal>
            <RevoPredictionTimeline />
          </RevoReveal>

          <RevoReveal>
            <RevoVideoSensor />
          </RevoReveal>

          <RevoReveal>
            <RevoFusionExperiment />
          </RevoReveal>

          <RevoReveal>
            <RevoPhysicsValidation />
          </RevoReveal>

          <RevoReveal>
            <RevoAdminGate />
          </RevoReveal>
        </main>

        <RevoFooter settings={settings} onGo={scrollTo} />
        <RevoScrollTop />
        <RevoCommandPalette
          onGo={scrollTo}
          onBuy={handleBuyNav}
          onToggleTheme={handleToggleTheme}
        />
      </div>
    </div>
  );
}
