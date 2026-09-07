"use client";

import { useState } from "react";
import type { AppSettings } from "@/lib/types";
import { formatINR } from "./lib";

interface QA {
  q: string;
  a: string;
  icon: string;
  cat: string;
}

export function RevoFaq({ settings }: { settings: AppSettings | null }) {
  const [open, setOpen] = useState<number | null>(0);
  const usdtRate = settings?.paymentSettings?.usdtRate ?? 94.14;
  const minDepositINR = settings?.paymentSettings?.minDepositINR ?? 7000;
  const transferMin = settings?.walletTransfer?.minAmount ?? 7000;
  const transferEnabled = settings?.walletTransfer?.enabled ?? true;
  const telegram = settings?.telegramLink ?? "https://t.me/+CNJHfpdP1ck0NDA1";
  const email = settings?.supportEmail ?? "support@revofixer.com";

  const items: QA[] = [
    {
      cat: "Getting Started",
      icon: "fa-rocket",
      q: "How do I activate my license key?",
      a: `Enter your XXXX-XXXX-XXXX-XXXX key in the activation field above and tap "Activate License". Each key grants timed access to the Revo Fixer platform based on its package (1h / 2h / 4h / 8h / 1 Day). A single key can be used on up to 3 devices — exceeding that limit requires a reset by @RevoAgent.`,
    },
    {
      cat: "Packages",
      icon: "fa-crown",
      q: "What packages are available and what do they cost?",
      a: `Five real plans sourced live from the platform: 1 Hour (₹2,000), 2 Hours (₹3,750 — most popular), 4 Hours (₹7,550), 8 Hours (₹15,000) and 1 Day (₹40,000). Every plan includes priority queue access; longer plans add premium/VIP support and extended coverage. Active discounts apply automatically when the admin enables them.`,
    },
    {
      cat: "Payments",
      icon: "fa-wallet",
      q: "Which payment methods are supported?",
      a: `Three real methods: UPI (Google Pay / PhonePe / Paytm to the live UPI ID), Bkash (Personal agent number), and USDT (crypto wallet transfer). Send the exact amount, take a screenshot, and forward it to @RevoAgent along with your desired package. Minimum deposit is ${formatINR(minDepositINR)}.`,
    },
    {
      cat: "Crypto",
      icon: "fa-coins",
      q: "How does USDT pricing work?",
      a: `The live USDT→INR rate is ₹${usdtRate.toFixed(2)} per 1 USDT (sourced from appSettings). Use the converter above to compute exact amounts. For example, the minimum deposit of ${formatINR(minDepositINR)} is approximately ${(minDepositINR / usdtRate).toFixed(2)} USDT. Send only USDT (TRC-20) to the wallet shown in the Payments section.`,
    },
    {
      cat: "Wallet Transfers",
      icon: "fa-right-left",
      q: "Can I transfer my wallet balance to a betting site?",
      a: `Wallet-to-betting transfers are ${transferEnabled ? "currently ACTIVE" : "currently disabled"}. The minimum transfer amount is ${formatINR(transferMin)}. Submit a transfer request with your betting link and username; the admin processes it manually. Status updates appear in your dashboard activity log.`,
    },
    {
      cat: "License Keys",
      icon: "fa-key",
      q: "My key says 'reset_required' — what do I do?",
      a: `This means your key was used on more than 3 devices and has been locked for security. Contact @RevoAgent on Telegram with your key and proof of purchase to request a manual reset. Banned keys cannot be reinstated — they are permanently blocked for terms violations.`,
    },
    {
      cat: "Refunds",
      icon: "fa-rotate-left",
      q: "What is the refund policy?",
      a: `License keys are non-refundable once activated and bound to a device. If your key fails verification or was never used, contact support within 24 hours with your transaction screenshot for review. Refunds for approved-but-unclaimed packages are at the admin's discretion and processed via the original payment method.`,
    },
    {
      cat: "Support",
      icon: "fa-headset",
      q: "How do I reach support?",
      a: `The fastest channel is Telegram — join the official channel or DM @RevoAgent directly. For payment or account issues, email ${email} with your license key and transaction ID. Support is available 24/7 for premium package holders (8h / 1 Day plans).`,
    },
  ];

  const cats = Array.from(new Set(items.map((i) => i.cat)));

  return (
    <section id="faq" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <i className="fas fa-circle-question" /> Help Center
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Frequently asked <span className="revo-gradient-text">questions</span>
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-[#8899cc]">
            Everything you need to know about license keys, payments, transfers
            and refunds — all based on real platform settings.
          </p>
        </div>

        {/* Category chips */}
        <div className="mb-6 flex flex-wrap justify-center gap-2">
          {cats.map((c) => (
            <span
              key={c}
              className="rounded-full border border-[#1e2240] bg-[#141827]/60 px-3 py-1 text-[11px] font-semibold text-[#8899cc]"
            >
              {c}
            </span>
          ))}
        </div>

        <div className="space-y-3">
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                className={`revo-card overflow-hidden transition ${
                  isOpen ? "revo-card-glow ring-1 ring-[#448AFF]/30" : ""
                }`}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
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
                    <i className={`fas ${item.icon}`} />
                  </span>
                  <span className="flex-1 text-sm font-bold text-white sm:text-base">
                    {item.q}
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
                    isOpen
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="px-4 pb-4 pl-[4.25rem] text-sm leading-relaxed text-[#8899cc] sm:px-5 sm:pl-[4.75rem]">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Still need help CTA */}
        <div className="revo-card mt-6 flex flex-col items-center gap-3 p-5 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            <div className="text-sm font-bold text-white">Still need help?</div>
            <div className="text-xs text-[#8899cc]">
              Reach out — the Revo Fixer team responds fast.
            </div>
          </div>
          <div className="flex gap-2">
            <a
              href={telegram}
              target="_blank"
              rel="noopener noreferrer"
              className="revo-btn flex items-center gap-2 px-4 py-2.5 text-sm"
            >
              <i className="fab fa-telegram" /> Telegram
            </a>
            <a
              href={`mailto:${email}`}
              className="flex items-center gap-2 rounded-xl border border-[#1e2240] bg-[#141827] px-4 py-2.5 text-sm font-semibold text-[#bcc6e0] transition hover:bg-[#1e2240] hover:text-white"
            >
              <i className="fas fa-envelope text-[#448AFF]" /> Email
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
