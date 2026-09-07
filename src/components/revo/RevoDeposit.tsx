"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { copyText, formatINR, normalizeKey } from "./lib";
import type { AppSettings, Package, PaymentMethods } from "@/lib/types";

type Kind = "deposit" | "transfer";

const METHOD_META: Record<string, { label: string; icon: string; color: string }> = {
  upi: { label: "UPI", icon: "fa-google-pay", color: "#448AFF" },
  bkash: { label: "Bkash", icon: "fa-mobile-screen", color: "#e2136e" },
  usdt: { label: "USDT", icon: "fa-coins", color: "#2ed573" },
};

export function RevoDeposit({
  settings,
  packages,
  methods,
  onPickPackage,
}: {
  settings: AppSettings | null;
  packages: Package[];
  methods: PaymentMethods | null;
  onPickPackage: (p: Package) => void;
}) {
  const [kind, setKind] = useState<Kind>("deposit");
  const [method, setMethod] = useState<string>("upi");
  const [amount, setAmount] = useState("");
  const [selectedPkgId, setSelectedPkgId] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);

  const usdtRate = settings?.paymentSettings?.usdtRate ?? 94.14;
  const minDepositINR = settings?.paymentSettings?.minDepositINR ?? 7000;
  const transferMin = settings?.walletTransfer?.minAmount ?? 7000;
  const transferEnabled = settings?.walletTransfer?.enabled ?? true;

  const minAmount = kind === "deposit" ? minDepositINR : transferMin;
  const amt = parseFloat(amount.replace(/[^0-9.]/g, "")) || 0;
  const meetsMin = amt >= minAmount;

  const activeDestination = useMemo(() => {
    const entry = methods?.[method as keyof PaymentMethods];
    const nums = entry?.numbers ? Object.values(entry.numbers) : [];
    return nums.find((n) => n.isActive) ?? nums[0];
  }, [methods, method]);

  const selectedPkg = packages.find((p) => p.id === selectedPkgId);
  const usdtEquiv = amt > 0 && method === "usdt" ? amt / usdtRate : 0;
  const inrEquiv =
    amt > 0 && method === "usdt" ? amt * usdtRate : amt;

  function handleSubmit() {
    if (!meetsMin) {
      toast.error(`Minimum is ${formatINR(minAmount)}`, {
        description: "Increase the amount to continue.",
      });
      return;
    }
    if (kind === "deposit" && !selectedPkg) {
      toast.error("Select a package", {
        description: "Pick the package you're paying for.",
      });
      return;
    }
    setSubmitted(true);
    toast.success("Request summary ready", {
      description: "Review the details and contact @RevoAgent to finalize.",
    });
  }

  function reset() {
    setSubmitted(false);
    setAmount("");
    setSelectedPkgId("");
  }

  return (
    <section id="deposit" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <i className="fas fa-money-bill-transfer" /> Request Center
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Deposit &amp; <span className="revo-gradient-gold">wallet transfer</span>
          </h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-[#8899cc]">
            Build your {kind === "deposit" ? "package purchase" : "wallet transfer"}{" "}
            request with real payment destinations. Final confirmation is handled
            by @RevoAgent.
          </p>
        </div>

        {/* Kind toggle */}
        <div className="mb-5 flex justify-center">
          <div className="flex gap-1 rounded-xl border border-[#1e2240] bg-[#0d1020] p-1">
            <button
              onClick={() => {
                setKind("deposit");
                setSubmitted(false);
              }}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                kind === "deposit"
                  ? "bg-[#448AFF] text-white shadow"
                  : "text-[#8899cc] hover:text-white"
              }`}
            >
              <i className="fas fa-arrow-down-to-bracket" /> Deposit
            </button>
            <button
              onClick={() => {
                setKind("transfer");
                setSubmitted(false);
              }}
              disabled={!transferEnabled}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-40 ${
                kind === "transfer"
                  ? "bg-[#FFD700] text-[#1a1a2e] shadow"
                  : "text-[#8899cc] hover:text-white"
              }`}
              title={transferEnabled ? "Wallet transfer" : "Transfers disabled"}
            >
              <i className="fas fa-right-left" /> Transfer
              {!transferEnabled && (
                <span className="rounded-full bg-[#ff4757]/20 px-1.5 py-0.5 text-[9px] text-[#ff4757]">
                  off
                </span>
              )}
            </button>
          </div>
        </div>

        {!submitted ? (
          <div className="revo-card revo-card-glow p-5 sm:p-6">
            <div className="grid gap-5 md:grid-cols-2">
              {/* Left: form */}
              <div className="space-y-4">
                {kind === "deposit" && (
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#5a6a99]">
                      Select package
                    </label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {packages.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setSelectedPkgId(p.id);
                            setAmount(String(p.price ?? 0));
                          }}
                          className={`rounded-xl border p-2.5 text-left transition ${
                            selectedPkgId === p.id
                              ? "border-[#448AFF] bg-[#448AFF]/10 ring-1 ring-[#448AFF]/40"
                              : "border-[#1e2240] bg-[#0d1020]/60 hover:border-[#448AFF]/50"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <i className={`fas ${p.icon ?? "fa-bolt"} text-[#448AFF]`} />
                            <span className="text-xs font-bold text-white">{p.name}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-[#5a6a99]">
                            {formatINR(p.price)} · {p.hours}h
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#5a6a99]">
                    Payment method
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.keys(METHOD_META).map((m) => {
                      const meta = METHOD_META[m];
                      return (
                        <button
                          key={m}
                          onClick={() => setMethod(m)}
                          className={`flex flex-col items-center gap-1 rounded-xl border p-2.5 transition ${
                            method === m
                              ? "border-[#448AFF] bg-[#448AFF]/10 ring-1 ring-[#448AFF]/40"
                              : "border-[#1e2240] bg-[#0d1020]/60 hover:border-[#448AFF]/50"
                          }`}
                        >
                          <span
                            className="grid h-8 w-8 place-items-center rounded-lg text-sm"
                            style={{ background: `${meta.color}1f`, color: meta.color }}
                          >
                            <i className={`fas ${meta.icon}`} />
                          </span>
                          <span className="text-[11px] font-bold text-white">
                            {meta.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#5a6a99]">
                    Amount {method === "usdt" ? "(USDT)" : "(INR)"}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={`Min ${formatINR(minAmount)}`}
                      className={`w-full rounded-xl border bg-[#0d1020] px-4 py-3.5 pr-12 text-lg font-bold text-white outline-none transition ${
                        amt > 0 && !meetsMin
                          ? "border-[#ffa502]/50 focus:ring-2 focus:ring-[#ffa502]/30"
                          : "border-[#1e2240] focus:border-[#448AFF] focus:ring-2 focus:ring-[#448AFF]/30"
                      }`}
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-[#5a6a99]">
                      {method === "usdt" ? "USDT" : "INR"}
                    </span>
                  </div>
                  {amt > 0 && !meetsMin && (
                    <p className="mt-1 text-[11px] text-[#ffa502]">
                      <i className="fas fa-triangle-exclamation mr-1" />
                      Below minimum ({formatINR(minAmount)})
                    </p>
                  )}
                  {method === "usdt" && amt > 0 && (
                    <p className="mt-1 text-[11px] text-[#2ed573]">
                      ≈ {formatINR(inrEquiv)} @ ₹{usdtRate.toFixed(2)}/USDT
                    </p>
                  )}
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={!meetsMin || (kind === "deposit" && !selectedPkg)}
                  className="revo-btn flex w-full items-center justify-center gap-2 px-5 py-3.5 text-sm disabled:opacity-50"
                >
                  <i className="fas fa-paper-plane" /> Build Request Summary
                </button>
              </div>

              {/* Right: destination preview */}
              <div className="rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#5a6a99]">
                    {METHOD_META[method]?.label} destination
                  </span>
                  <span className="rounded-full bg-[#2ed573]/15 px-2 py-0.5 text-[10px] font-bold text-[#2ed573]">
                    Live
                  </span>
                </div>
                {activeDestination ? (
                  <div>
                    <div className="rounded-lg border border-[#1e2240] bg-[#141827] p-3">
                      <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">
                        {activeDestination.label ?? "Destination"}
                      </div>
                      <div className="mt-1 break-all font-mono text-sm font-bold text-white">
                        {activeDestination.number}
                      </div>
                      <button
                        onClick={async () => {
                          const ok = await copyText(activeDestination.number);
                          if (ok) toast.success("Destination copied");
                        }}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#1e2240] bg-[#0d1020] px-2.5 py-1 text-[11px] font-semibold text-[#448AFF] transition hover:bg-[#1e2240]"
                      >
                        <i className="fas fa-copy" /> Copy
                      </button>
                    </div>
                    <p className="mt-3 text-[11px] leading-relaxed text-[#8899cc]">
                      <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
                      {activeDestination.instruction ??
                        `Send ${method === "usdt" ? "USDT" : "funds"} to this destination.`}
                    </p>
                  </div>
                ) : (
                  <div className="py-8 text-center text-sm text-[#5a6a99]">
                    No active {METHOD_META[method]?.label} destination.
                  </div>
                )}
                <div className="mt-4 space-y-2 border-t border-[#1e2240] pt-3 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-[#5a6a99]">Min amount</span>
                    <span className="font-bold text-white">{formatINR(minAmount)}</span>
                  </div>
                  {method === "usdt" && (
                    <div className="flex justify-between">
                      <span className="text-[#5a6a99]">≈ in USDT</span>
                      <span className="font-bold text-[#2ed573]">
                        {(minAmount / usdtRate).toFixed(2)} U
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[#5a6a99]">USDT rate</span>
                    <span className="font-bold text-white">₹{usdtRate.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <RequestSummary
            kind={kind}
            amount={amt}
            method={method}
            pkg={selectedPkg}
            usdtRate={usdtRate}
            usdtEquiv={usdtEquiv}
            destination={activeDestination?.number ?? ""}
            onReset={reset}
            onPickPackage={onPickPackage}
          />
        )}
      </div>
    </section>
  );
}

function RequestSummary({
  kind,
  amount,
  method,
  pkg,
  usdtRate,
  usdtEquiv,
  destination,
  onReset,
  onPickPackage,
}: {
  kind: Kind;
  amount: number;
  method: string;
  pkg?: Package;
  usdtRate: number;
  usdtEquiv: number;
  destination: string;
  onReset: () => void;
  onPickPackage: (p: Package) => void;
}) {
  const meta = METHOD_META[method] ?? { label: method, icon: "fa-money-bill", color: "#448AFF" };
  const displayAmount = method === "usdt" ? `${amount.toFixed(2)} USDT` : formatINR(amount);
  const inrValue = method === "usdt" ? amount * usdtRate : amount;

  const summaryText = [
    `Revo Fixer — ${kind === "deposit" ? "Package Purchase" : "Wallet Transfer"} Request`,
    kind === "deposit" && pkg ? `Package: ${pkg.name} (${pkg.hours}h)` : null,
    `Amount: ${displayAmount}${method === "usdt" ? ` (≈ ${formatINR(inrValue)})` : ""}`,
    `Method: ${meta.label}`,
    kind === "deposit" && pkg ? `Package price: ${formatINR(pkg.price)}` : null,
    destination ? `Destination: ${destination}` : null,
    "",
    "Sent via Revo Fixer web portal.",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="revo-card revo-card-glow p-5 sm:p-7">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#2ed573]/15 text-[#2ed573]">
          <i className="fas fa-circle-check text-lg" />
        </span>
        <div>
          <h3 className="text-lg font-black text-white">Request summary ready</h3>
          <p className="text-[11px] text-[#5a6a99]">
            Copy this and send to @RevoAgent with your payment screenshot.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-[#1e2240] bg-[#0d1020] p-4">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[#5a6a99]">Type</span>
            <span className="font-bold text-white">
              {kind === "deposit" ? "Package Purchase" : "Wallet Transfer"}
            </span>
          </div>
          {kind === "deposit" && pkg && (
            <>
              <div className="flex justify-between">
                <span className="text-[#5a6a99]">Package</span>
                <span className="font-bold text-white">
                  {pkg.name} · {pkg.hours}h
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5a6a99]">Package price</span>
                <span className="font-bold text-[#FFD700]">{formatINR(pkg.price)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between border-t border-[#1e2240] pt-2">
            <span className="text-[#5a6a99]">Amount</span>
            <span className="font-black text-white">{displayAmount}</span>
          </div>
          {method === "usdt" && (
            <div className="flex justify-between">
              <span className="text-[#5a6a99]">≈ in INR</span>
              <span className="font-bold text-[#2ed573]">{formatINR(inrValue)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[#5a6a99]">Method</span>
            <span className="font-bold text-white">
              <i className={`fas ${meta.icon} mr-1`} style={{ color: meta.color }} />
              {meta.label}
            </span>
          </div>
          {destination && (
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-[#5a6a99]">Destination</span>
              <span className="truncate font-mono text-xs text-[#bcc6e0]">{destination}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          onClick={async () => {
            const ok = await copyText(summaryText);
            if (ok) toast.success("Summary copied to clipboard");
          }}
          className="revo-btn flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm"
        >
          <i className="fas fa-copy" /> Copy summary
        </button>
        <a
          href="https://t.me/RevoAgent"
          target="_blank"
          rel="noopener noreferrer"
          className="revo-btn-gold flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm"
        >
          <i className="fab fa-telegram" /> Send to @RevoAgent
        </a>
        <button
          onClick={onReset}
          className="rounded-xl border border-[#1e2240] bg-[#141827] px-4 py-3 text-sm font-semibold text-[#8899cc] transition hover:bg-[#1e2240] hover:text-white"
        >
          <i className="fas fa-rotate-left" /> Edit
        </button>
      </div>

      {pkg && (
        <button
          onClick={() => onPickPackage(pkg)}
          className="mt-3 block w-full text-center text-[11px] text-[#5a6a99] transition hover:text-[#448AFF]"
        >
          View {pkg.name} package details →
        </button>
      )}

      <p className="mt-4 rounded-lg border border-[#ffa502]/30 bg-[#ffa502]/8 p-2.5 text-center text-[11px] text-[#ffa502]">
        <i className="fas fa-circle-info mr-1" />
        This portal builds a summary only — no payment is processed. Send the
        funds to the destination above, then forward the screenshot + this
        summary to @RevoAgent to finalize.
      </p>
    </div>
  );
}
