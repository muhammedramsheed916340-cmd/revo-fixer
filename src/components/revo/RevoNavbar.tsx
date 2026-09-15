"use client";

import { useEffect, useState } from "react";
import { RevoNotificationsBell } from "./RevoNotificationsBell";
import { RevoThemeToggle } from "./RevoThemeToggle";
import { RevoOnlineBadge } from "./RevoOnlineBadge";

const NAV = [
  { id: "home", label: "Home", icon: "fa-house" },
  { id: "game", label: "Live Game", icon: "fa-gamepad" },
  { id: "live-results", label: "Live Results", icon: "fa-tower-broadcast" },
  { id: "streak-tracker", label: "Streaks", icon: "fa-chart-line" },
  { id: "packages", label: "Packages", icon: "fa-crown" },
  { id: "recommender", label: "Picker", icon: "fa-wand-magic-sparkles" },
  { id: "compare", label: "Compare", icon: "fa-table-columns" },
  { id: "revenue", label: "Revenue", icon: "fa-chart-line" },
  { id: "converter", label: "Converter", icon: "fa-right-left" },
  { id: "deposit", label: "Deposit", icon: "fa-money-bill-transfer" },
  { id: "payments", label: "Payments", icon: "fa-wallet" },
  { id: "stats", label: "Live Stats", icon: "fa-signal" },
  { id: "reviews", label: "Reviews", icon: "fa-star" },
  { id: "activity", label: "Activity", icon: "fa-bolt" },
  { id: "faq", label: "FAQ", icon: "fa-circle-question" },
  { id: "terms", label: "Terms", icon: "fa-scale-balanced" },
  { id: "admin", label: "Admin", icon: "fa-user-shield" },
];

export function RevoNavbar({
  onBuy,
  onGo,
  maintenanceMode,
  forceUpdate,
}: {
  onBuy: () => void;
  onGo: (id: string) => void;
  maintenanceMode?: boolean;
  forceUpdate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#0a0b14]/85 backdrop-blur-xl border-b border-[#1e2240]"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <button
          onClick={() => onGo("home")}
          className="flex items-center gap-2.5"
          aria-label="Revo Fixer home"
        >
          <span
            className="grid h-10 w-10 place-items-center rounded-xl text-xl font-black text-white shadow-lg"
            style={{
              background: "linear-gradient(135deg,#448AFF,#2962FF)",
              boxShadow: "0 8px 20px -8px rgba(68,138,255,0.8)",
            }}
          >
            <i className="fas fa-crown" />
          </span>
          <span className="hidden sm:block">
            <span className="text-lg font-extrabold tracking-tight text-white">
              REVO<span className="text-[#448AFF]"> FIXER</span>
            </span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-[#5a6a99]">
              Crazy Time Revo
            </span>
          </span>
        </button>

        <nav className="hidden items-center gap-0.5 overflow-x-auto revo-scroll xl:flex">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => onGo(n.id)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-[#bcc6e0] transition hover:bg-white/5 hover:text-white"
              title={n.label}
            >
              <i className={`fas ${n.icon} text-[11px] text-[#448AFF]`} />
              <span className="whitespace-nowrap">{n.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <RevoOnlineBadge />
          {maintenanceMode && (
            <span className="hidden items-center gap-1.5 rounded-full border border-[#ffa502]/40 bg-[#ffa502]/10 px-2.5 py-1 text-[11px] font-semibold text-[#ffa502] sm:flex">
              <i className="fas fa-triangle-exclamation" /> Maintenance
            </span>
          )}
          {forceUpdate && (
            <span className="hidden items-center gap-1.5 rounded-full border border-[#ff4757]/40 bg-[#ff4757]/10 px-2.5 py-1 text-[11px] font-semibold text-[#ff4757] sm:flex">
              <i className="fas fa-arrow-up" /> v2 Update
            </span>
          )}
          <button
            onClick={onBuy}
            className="revo-btn px-4 py-2 text-sm sm:px-5"
          >
            <i className="fas fa-shopping-cart mr-1.5" />
            <span className="hidden sm:inline">Buy License</span>
            <span className="sm:hidden">Buy</span>
          </button>
          <button
            onClick={() => {
              // Trigger the global Cmd/Ctrl+K palette by dispatching a synthetic keydown.
              window.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "k",
                  metaKey: true,
                  bubbles: true,
                }),
              );
            }}
            className="hidden h-10 items-center gap-1.5 rounded-lg border border-[#1e2240] bg-[#141827]/60 px-2.5 text-[#5a6a99] transition hover:text-white sm:flex"
            aria-label="Open command palette"
            title="Quick nav (⌘K)"
          >
            <i className="fas fa-magnifying-glass text-xs" />
            <kbd className="text-[10px] font-bold">⌘K</kbd>
          </button>
          <RevoNotificationsBell />
          <RevoThemeToggle />
          <button
            onClick={() => setOpen((v) => !v)}
            className="grid h-10 w-10 place-items-center rounded-lg border border-[#1e2240] bg-[#141827]/60 text-[#bcc6e0] xl:hidden"
            aria-label="Toggle menu"
          >
            <i className={`fas ${open ? "fa-xmark" : "fa-bars"} text-lg`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#1e2240] bg-[#0a0b14]/95 px-4 py-3 backdrop-blur-xl xl:hidden">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  onGo(n.id);
                  setOpen(false);
                }}
                className="flex items-center gap-2 rounded-lg border border-[#1e2240] bg-[#141827]/60 px-3 py-2.5 text-sm font-medium text-[#bcc6e0]"
              >
                <i className={`fas ${n.icon} text-[#448AFF]`} />
                {n.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
