"use client";

import { useState } from "react";
import { KEY_PATTERN, normalizeKey } from "./lib";
import type { AppSettings, SecurityCode } from "@/lib/types";

type Status = "idle" | "verifying" | "ok" | "error";

interface VerifyResult {
  ok: boolean;
  key?: string;
  data?: Partial<SecurityCode>;
  error?: string;
}

export function RevoHero({
  settings,
  onVerified,
  onBuy,
  onSupport,
}: {
  settings: AppSettings | null;
  onVerified: (key: string, data: Partial<SecurityCode>) => void;
  onBuy: () => void;
  onSupport: () => void;
}) {
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setRaw(normalizeKey(text));
    } catch {
      setMsg("Press Ctrl+V to paste");
      setStatus("error");
    }
  }

  async function verify() {
    const key = normalizeKey(raw);
    setRaw(key);
    if (!KEY_PATTERN.test(key)) {
      setStatus("error");
      setMsg("Invalid format. Use XXXX-XXXX-XXXX-XXXX");
      return;
    }
    setStatus("verifying");
    setMsg("Verifying license key…");
    try {
      const res = await fetch("/api/verify-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const json: VerifyResult = await res.json();
      setResult(json);
      if (json.ok && json.data) {
        const d = json.data;
        if (d.status === "banned") {
          setStatus("error");
          setMsg("License key blocked. Contact support.");
        } else if (d.status === "reset_required") {
          setStatus("error");
          setMsg("Key needs reset. Contact @RevoAgent.");
        } else {
          setStatus("ok");
          setMsg("✅ License verified! Opening dashboard…");
          setTimeout(() => onVerified(key, d), 700);
        }
      } else {
        setStatus("error");
        setMsg("Invalid license key!");
      }
    } catch {
      setStatus("error");
      setMsg("Network error. Try again.");
    }
  }

  return (
    <section id="home" className="relative scroll-mt-20 px-4 pt-10 sm:px-6 sm:pt-16">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-[#1e2240] bg-[#141827]/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8899cc]">
          <span className="text-[#2ed573] revo-pulse">●</span>
          Live Platform · v{settings?.appVersion ?? "2.0.0"}
        </div>

        <div className="mb-4 flex justify-center">
          <span
            className="grid h-20 w-20 place-items-center rounded-2xl text-4xl text-white shadow-2xl"
            style={{
              background: "linear-gradient(135deg,#448AFF,#2962FF)",
              boxShadow: "0 20px 50px -12px rgba(68,138,255,0.7)",
            }}
          >
            <i className="fas fa-crown" />
          </span>
        </div>

        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
          <span className="revo-gradient-animate">REVO</span>{" "}
          <span className="text-white">FIXER</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm font-semibold uppercase tracking-[0.25em] text-[#448AFF] sm:text-base">
          ⚡ CRAZY TIME REVO FIXER ⚡
        </p>
        <p className="mx-auto mt-4 max-w-xl text-sm text-[#8899cc] sm:text-base">
          Enter your valid license key to activate access. Real-time signals,
          priority queue &amp; premium support — powered by the live Revo Fixer
          platform.
        </p>

        <div className="revo-card revo-card-glow mx-auto mt-8 max-w-xl p-5 text-left sm:p-6">
          <label className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#8899cc]">
            <i className="fas fa-key text-[#448AFF]" /> License Key
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              value={raw}
              onChange={(e) => setRaw(normalizeKey(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              maxLength={19}
              className="w-full rounded-xl border border-[#1e2240] bg-[#0d1020] px-4 py-3.5 font-mono text-base tracking-wider text-white outline-none transition placeholder:text-[#5a6a99] focus:border-[#448AFF] focus:ring-2 focus:ring-[#448AFF]/30"
            />
            <button
              onClick={paste}
              className="shrink-0 rounded-xl border border-[#1e2240] bg-[#141827] px-4 py-3.5 text-sm font-semibold text-[#bcc6e0] transition hover:bg-[#1e2240] hover:text-white"
            >
              <i className="fas fa-paste mr-1.5" /> Paste
            </button>
          </div>

          <button
            onClick={verify}
            disabled={status === "verifying"}
            className="revo-btn mt-3 flex w-full items-center justify-center gap-2 px-5 py-3.5 text-base disabled:opacity-60"
          >
            {status === "verifying" ? (
              <>
                <i className="fas fa-spinner fa-spin" /> Verifying…
              </>
            ) : (
              <>
                <i className="fas fa-key" /> Activate License
              </>
            )}
          </button>

          {msg && (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-center text-sm font-semibold ${
                status === "ok"
                  ? "border-[#2ed573]/50 bg-[#2ed573]/10 text-[#2ed573]"
                  : "border-[#ff4757]/50 bg-[#ff4757]/10 text-[#ff4757]"
              }`}
            >
              {msg}
            </div>
          )}

          {result?.ok && result.data && status === "ok" && (
            <div className="mt-3 rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-3 text-xs text-[#8899cc]">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  <b className="text-[#bcc6e0]">Package:</b>{" "}
                  {result.data.name ?? result.data.package?.name ?? "—"}
                </span>
                <span>
                  <b className="text-[#bcc6e0]">Hours:</b>{" "}
                  {result.data.hours ?? result.data.package?.hours ?? "—"}
                </span>
                <span>
                  <b className="text-[#bcc6e0]">Status:</b>{" "}
                  <span className="text-[#2ed573]">
                    {result.data.status ?? "active"}
                  </span>
                </span>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={onBuy}
              className="revo-btn-gold flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold"
            >
              <i className="fas fa-shopping-cart" /> Buy License
            </button>
            <button
              onClick={onSupport}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#1e2240] bg-[#141827] px-4 py-3 text-sm font-semibold text-[#bcc6e0] transition hover:bg-[#1e2240] hover:text-white"
            >
              <i className="fab fa-telegram text-[#29b6f6]" /> Contact Support
            </button>
          </div>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { icon: "fa-shield-halved", color: "#2ed573", label: "Secure", sub: "Verified keys" },
            { icon: "fa-bolt", color: "#ffa502", label: "Instant", sub: "Auto-activation" },
            { icon: "fa-headset", color: "#448AFF", label: "24/7", sub: "Live support" },
            { icon: "fa-globe", color: "#00d4ff", label: "UPI · USDT", sub: "Bkash crypto" },
          ].map((b) => (
            <div
              key={b.label}
              className="revo-card flex items-center gap-2.5 px-3 py-2.5"
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm"
                style={{ background: `${b.color}1f`, color: b.color }}
              >
                <i className={`fas ${b.icon}`} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-white">{b.label}</div>
                <div className="truncate text-[10px] text-[#5a6a99]">{b.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
