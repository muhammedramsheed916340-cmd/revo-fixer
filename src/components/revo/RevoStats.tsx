"use client";

import { formatINR } from "./lib";
import { useCountUpWithRef } from "./useCountUp";
import type { AppSettings } from "@/lib/types";

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

function Stat({
  icon,
  label,
  value,
  color,
}: {
  icon: string;
  label: string;
  value: string | number;
  color: string;
}) {
  // Animate numeric values on scroll-into-view.
  const numeric = typeof value === "number" ? value : parseInt(String(value), 10);
  const isNumeric = !isNaN(numeric) && String(value).match(/^\d+$/);
  const [animated, ref] = useCountUpWithRef(isNumeric ? numeric : 0);
  const display = isNumeric ? animated.toLocaleString("en-IN") : value;

  return (
    <div className="revo-card group relative overflow-hidden p-4 transition hover:-translate-y-0.5 hover:ring-1 hover:ring-[#448AFF]/30">
      <div
        className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl transition group-hover:opacity-50"
        style={{ background: color }}
      />
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg transition group-hover:scale-110"
          style={{ background: `${color}22`, color }}
        >
          <i className={`fas ${icon}`} />
        </span>
        <div className="min-w-0">
          <div
            ref={ref}
            className="text-xl font-black tabular-nums text-white sm:text-2xl"
          >
            {display}
          </div>
          <div className="truncate text-[11px] font-medium uppercase tracking-wider text-[#5a6a99]">
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RevoStats({
  stats,
  settings,
}: {
  stats: Stats | null;
  settings: AppSettings | null;
}) {
  const minDeposit = settings?.paymentSettings?.minDepositINR ?? 7000;
  const usdtRate = settings?.paymentSettings?.usdtRate ?? 94.14;

  return (
    <section id="stats" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
              <span className="revo-pulse text-[#2ed573]">●</span> Live Platform
            </div>
            <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
              Real-time <span className="revo-gradient-text">platform stats</span>
            </h2>
            <p className="mt-1 text-sm text-[#8899cc]">
              Live counts from the Revo Fixer database — updated continuously.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          <Stat
            icon="fa-key"
            label="License Keys"
            value={stats?.totalLicenseKeys ?? "—"}
            color="#448AFF"
          />
          <Stat
            icon="fa-users"
            label="Registered Users"
            value={stats?.totalUsers ?? "—"}
            color="#00d4ff"
          />
          <Stat
            icon="fa-credit-card"
            label="Package Payments"
            value={stats?.totalPackagePayments ?? "—"}
            color="#2ed573"
          />
          <Stat
            icon="fa-money-bill-transfer"
            label="Payment Requests"
            value={stats?.totalPaymentRequests ?? "—"}
            color="#ffa502"
          />
          <Stat
            icon="fa-arrow-right-arrow-left"
            label="Wallet Transfers"
            value={stats?.totalTransferRequests ?? "—"}
            color="#ff4757"
          />
          <Stat
            icon="fa-signal"
            label="Signal Codes"
            value={stats?.totalActivationCodes ?? "—"}
            color="#FFD700"
          />
          <Stat
            icon="fa-circle-check"
            label="Signal Codes Used"
            value={stats?.usedActivationCodes ?? "—"}
            color="#2ed573"
          />
          <Stat
            icon="fa-user-shield"
            label="Admin Keys"
            value={stats?.totalAdminKeys ?? "—"}
            color="#a78bfa"
          />
        </div>

        <div className="revo-card mt-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#448AFF]/15 text-[#448AFF]">
              <i className="fas fa-indian-rupee-sign" />
            </span>
            <div>
              <div className="text-sm font-bold text-white">
                Min Deposit {formatINR(minDeposit)}
              </div>
              <div className="text-[11px] text-[#5a6a99]">
                Minimum package purchase
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#2ed573]/15 text-[#2ed573]">
              <i className="fas fa-coins" />
            </span>
            <div>
              <div className="text-sm font-bold text-white">
                USDT Rate ₹{usdtRate.toFixed(2)}
              </div>
              <div className="text-[11px] text-[#5a6a99]">Per 1 USDT (INR)</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`grid h-9 w-9 place-items-center rounded-lg ${
                settings?.walletTransfer?.enabled
                  ? "bg-[#2ed573]/15 text-[#2ed573]"
                  : "bg-[#ff4757]/15 text-[#ff4757]"
              }`}
            >
              <i className="fas fa-right-left" />
            </span>
            <div>
              <div className="text-sm font-bold text-white">
                Wallet Transfer{" "}
                {settings?.walletTransfer?.enabled ? "Active" : "Off"}
              </div>
              <div className="text-[11px] text-[#5a6a99]">
                Min {formatINR(settings?.walletTransfer?.minAmount)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
