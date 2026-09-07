"use client";

import { useState } from "react";
import type { AppSettings } from "@/lib/types";
import { formatINR } from "./lib";

export function RevoTerms({ settings }: { settings: AppSettings | null }) {
  const [open, setOpen] = useState<string | null>("license");
  const minDepositINR = settings?.paymentSettings?.minDepositINR ?? 7000;
  const transferMin = settings?.walletTransfer?.minAmount ?? 7000;
  const usdtRate = settings?.paymentSettings?.usdtRate ?? 94.14;
  const support = settings?.supportContact ?? "@RevoAgent";
  const email = settings?.supportEmail ?? "support@revofixer.com";

  const sections: {
    id: string;
    icon: string;
    title: string;
    body: React.ReactNode;
  }[] = [
    {
      id: "license",
      icon: "fa-key",
      title: "1. License Key Terms",
      body: (
        <>
          <p>
            A Revo Fixer license key grants timed, non-transferable access to the
            platform for the duration specified by its package (1h / 2h / 4h / 8h
            / 1 Day). Keys are sold as one-time purchases and are bound to the
            first device that activates them.
          </p>
          <ul className="list-inside list-disc space-y-1">
            <li>
              Each key may be used on up to <b className="text-white">3 devices</b>.
              Exceeding this limit automatically marks the key as{" "}
              <code className="rounded bg-[#0d1020] px-1 text-[#ffa502]">reset_required</code>{" "}
              and locks it pending admin review.
            </li>
            <li>
              Banned keys (<code className="rounded bg-[#0d1020] px-1 text-[#ff4757]">status: banned</code>)
              are permanently revoked for terms violations and cannot be reinstated.
            </li>
            <li>
              Keys are validated in real-time against the live platform database.
              Tampering, sharing, or reselling keys is prohibited.
            </li>
            <li>
              The platform reserves the right to revoke any key engaged in abuse,
              fraud, or unauthorized redistribution.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "payments",
      icon: "fa-wallet",
      title: "2. Payments & Pricing",
      body: (
        <>
          <p>
            All prices are sourced live from the platform and displayed in Indian
            Rupees (₹). The current 5 plans and their real prices are shown in the
            Packages section above.
          </p>
          <ul className="list-inside list-disc space-y-1">
            <li>
              Accepted methods: <b className="text-white">UPI</b>,{" "}
              <b className="text-white">Bkash</b>, and{" "}
              <b className="text-white">USDT (TRC-20)</b> to the live destinations
              shown in the Payment Methods section.
            </li>
            <li>
              Minimum deposit is{" "}
              <b className="text-[#FFD700]">{formatINR(minDepositINR)}</b>{" "}
              (≈ {(minDepositINR / usdtRate).toFixed(2)} USDT at the live rate of
              ₹{usdtRate.toFixed(2)}/USDT).
            </li>
            <li>
              After payment, forward the screenshot + package name to {support} for
              manual verification and activation.
            </li>
            <li>
              Discounts may be enabled by the admin at any time; active discounts
              apply automatically to displayed prices.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "transfers",
      icon: "fa-right-left",
      title: "3. Wallet Transfers",
      body: (
        <>
          <p>
            Wallet-to-betting transfers let you move your account balance to a
            connected betting profile. Transfers are processed manually by the
            admin.
          </p>
          <ul className="list-inside list-disc space-y-1">
            <li>
              Minimum transfer amount:{" "}
              <b className="text-[#FFD700]">{formatINR(transferMin)}</b>.
            </li>
            <li>
              You must provide a valid betting link and registered username with
              each request.
            </li>
            <li>
              Transfer status (pending / approved / rejected) appears in your
              dashboard activity log.
            </li>
            <li>
              The platform is not responsible for funds sent to incorrect betting
              accounts due to user-entered errors.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "refunds",
      icon: "fa-rotate-left",
      title: "4. Refund Policy",
      body: (
        <>
          <ul className="list-inside list-disc space-y-1">
            <li>
              License keys are <b className="text-white">non-refundable</b> once
              activated and bound to a device.
            </li>
            <li>
              If a key fails verification or was never used, contact support
              within <b className="text-white">24 hours</b> of purchase with your
              transaction screenshot for review.
            </li>
            <li>
              Approved-but-unclaimed packages may be eligible for a refund at the
              admin's discretion, processed via the original payment method.
            </li>
            <li>
              Refunds for change-of-mind, duplicate purchases, or post-activation
              use are not entertained.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "liability",
      icon: "fa-scale-balanced",
      title: "5. Limitation of Liability",
      body: (
        <>
          <p>
            Revo Fixer provides access to timing/signal tools for entertainment
            purposes. The platform does not guarantee any outcome, profit, or
            winning result.
          </p>
          <ul className="list-inside list-disc space-y-1">
            <li>
              You use the platform entirely at your own risk. The developer
              ({support}) is not liable for any financial losses arising from use
              of the service.
            </li>
            <li>
              Signals and predictions are probabilistic; past performance does not
              indicate future results.
            </li>
            <li>
              The platform is not affiliated with any third-party betting or casino
              service. Users must comply with the laws of their jurisdiction.
            </li>
            <li>
              Service availability may be interrupted for maintenance, updates, or
              reasons beyond our control. The <code className="rounded bg-[#0d1020] px-1 text-[#ffa502]">maintenanceMode</code> flag
              indicates planned downtime.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "prohibited",
      icon: "fa-ban",
      title: "6. Prohibited Use",
      body: (
        <>
          <p>The following actions are strictly prohibited and will result in immediate key revocation:</p>
          <ul className="list-inside list-disc space-y-1">
            <li>Reverse engineering, decompiling, or redistributing the app or website.</li>
            <li>Sharing, leasing, or reselling license keys to third parties.</li>
            <li>Using bots, scripts, or automation to abuse the platform.</li>
            <li>Chargeback fraud or filing false payment disputes.</li>
            <li>Impersonating the developer or support staff.</li>
          </ul>
          <p className="mt-2">
            Violations may result in permanent banning of all associated keys and
            devices without refund.
          </p>
        </>
      ),
    },
    {
      id: "contact",
      icon: "fa-headset",
      title: "7. Contact & Disputes",
      body: (
        <>
          <p>
            For any disputes, support requests, or clarifications, contact the
            developer directly before initiating a payment dispute.
          </p>
          <ul className="list-inside list-disc space-y-1">
            <li>
              Telegram: <b className="text-[#448AFF]">{support}</b> (primary,
              fastest response)
            </li>
            <li>
              Email: <b className="text-[#448AFF]">{email}</b> (for payment/account
              issues — include your license key + transaction ID)
            </li>
            <li>
              Premium package holders (8h / 1 Day plans) receive 24/7 priority
              support.
            </li>
          </ul>
          <p className="mt-2 text-[11px] text-[#5a6a99]">
            These terms are displayed based on live platform settings and may be
            updated by the admin at any time. Continued use of the service
            constitutes acceptance of the current terms.
          </p>
        </>
      ),
    },
  ];

  return (
    <section id="terms" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <i className="fas fa-scale-balanced" /> Legal
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Terms &amp; <span className="revo-gradient-text">Conditions</span>
          </h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-[#8899cc]">
            The rules governing your use of Revo Fixer — based on live platform
            settings (min deposit {formatINR(minDepositINR)}, USDT rate
            ₹{usdtRate.toFixed(2)}, transfer min {formatINR(transferMin)}).
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          {/* Section index (desktop) */}
          <div className="hidden sm:block">
            <div className="revo-card sticky top-20 p-2">
              {sections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setOpen(s.id);
                    document
                      .getElementById(`terms-${s.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${
                    open === s.id
                      ? "bg-[#448AFF]/15 text-[#448AFF]"
                      : "text-[#8899cc] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <i className={`fas ${s.icon} text-[10px]`} />
                  <span className="truncate">{s.title.replace(/^\d+\.\s/, "")}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Accordion content */}
          <div className="space-y-3">
            {sections.map((s) => {
              const isOpen = open === s.id;
              return (
                <div
                  key={s.id}
                  id={`terms-${s.id}`}
                  className={`revo-card scroll-mt-20 overflow-hidden transition ${
                    isOpen ? "revo-card-glow ring-1 ring-[#448AFF]/30" : ""
                  }`}
                >
                  <button
                    onClick={() => setOpen(isOpen ? null : s.id)}
                    className="flex w-full items-center gap-3 px-4 py-4 text-left sm:px-5"
                    aria-expanded={isOpen}
                  >
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base transition ${
                        isOpen
                          ? "bg-[#448AFF] text-white"
                          : "bg-[#448AFF]/12 text-[#448AFF]"
                      }`}
                    >
                      <i className={`fas ${s.icon}`} />
                    </span>
                    <span className="flex-1 text-sm font-bold text-white sm:text-base">
                      {s.title}
                    </span>
                    <span
                      className={`shrink-0 text-[#5a6a99] transition-transform duration-300 ${
                        isOpen ? "rotate-180 text-[#448AFF]" : ""
                      }`}
                    >
                      <i className="fas fa-chevron-down" />
                    </span>
                  </button>
                  <div
                    className={`grid transition-all duration-300 ${
                      isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="space-y-3 px-4 pb-5 pl-[4.25rem] text-sm leading-relaxed text-[#8899cc] sm:px-5 sm:pl-[4.75rem]">
                        {s.body}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Acceptance bar */}
        <div className="revo-card mt-5 flex flex-col items-center gap-3 p-5 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="flex items-center gap-2">
            <i className="fas fa-shield-check text-[#2ed573]" />
            <span className="text-sm text-[#8899cc]">
              Using Revo Fixer means you accept these terms.
            </span>
          </div>
          <a
            href="https://t.me/RevoAgent"
            target="_blank"
            rel="noopener noreferrer"
            className="revo-btn flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold"
          >
            <i className="fab fa-telegram" /> Ask a question
          </a>
        </div>
      </div>
    </section>
  );
}
