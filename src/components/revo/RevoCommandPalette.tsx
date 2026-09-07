"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface CommandItem {
  id: string;
  label: string;
  icon: string;
  hint?: string;
  group: string;
}

const COMMANDS: CommandItem[] = [
  { id: "home", label: "Home / License Login", icon: "fa-house", hint: "Activate key", group: "Navigate" },
  { id: "packages", label: "Packages", icon: "fa-crown", hint: "5 real plans", group: "Navigate" },
  { id: "recommender", label: "Smart Picker", icon: "fa-wand-magic-sparkles", hint: "Find best plan", group: "Navigate" },
  { id: "compare", label: "Compare Plans", icon: "fa-table-columns", hint: "Feature matrix", group: "Navigate" },
  { id: "revenue", label: "Revenue Analytics", icon: "fa-chart-line", hint: "Live charts", group: "Navigate" },
  { id: "converter", label: "USDT ↔ INR Converter", icon: "fa-right-left", hint: "Live rate", group: "Navigate" },
  { id: "stats", label: "Live Platform Stats", icon: "fa-signal", hint: "Real counts", group: "Navigate" },
  { id: "reviews", label: "User Reviews", icon: "fa-star", hint: "Verified", group: "Navigate" },
  { id: "deposit", label: "Deposit / Transfer", icon: "fa-money-bill-transfer", hint: "Request builder", group: "Navigate" },
  { id: "payments", label: "Payment Methods", icon: "fa-wallet", hint: "UPI / Bkash / USDT", group: "Navigate" },
  { id: "activity", label: "Live Activity Feed", icon: "fa-bolt", hint: "Real transactions", group: "Navigate" },
  { id: "faq", label: "FAQ Help Center", icon: "fa-circle-question", hint: "8 Q&A", group: "Navigate" },
  { id: "admin", label: "Admin Console", icon: "fa-user-shield", hint: "Read-only", group: "Navigate" },
  { id: "terms", label: "Terms & Conditions", icon: "fa-scale-balanced", hint: "7 sections", group: "Navigate" },
  { id: "support", label: "Contact Support", icon: "fa-headset", hint: "@RevoAgent", group: "Actions" },
  { id: "__buy", label: "Buy a License", icon: "fa-shopping-cart", hint: "View packages", group: "Actions" },
  { id: "__theme", label: "Toggle Theme", icon: "fa-circle-half-stroke", hint: "Dark / Light", group: "Actions" },
  { id: "__top", label: "Scroll to Top", icon: "fa-arrow-up", hint: "Back to hero", group: "Actions" },
];

export function RevoCommandPalette({
  onGo,
  onBuy,
  onToggleTheme,
}: {
  onGo: (id: string) => void;
  onBuy: () => void;
  onToggleTheme: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Open the palette (resets state in the handler, not an effect)
  const openPalette = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  // Global hotkey: Cmd/Ctrl+K opens, Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openPalette]);

  // Focus the input when the palette opens (DOM sync — allowed in effect)
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Filter commands
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q) ||
        (c.hint ?? "").toLowerCase().includes(q),
    );
  }, [query]);

  // Clamp active index to the filtered list (derived, no effect needed)
  const safeActive = Math.min(active, Math.max(0, filtered.length - 1));

  function onQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setActive(0); // reset selection to top when search changes
  }

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${safeActive}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [safeActive]);

  function execute(c: CommandItem) {
    setOpen(false);
    if (c.id === "__buy") {
      onBuy();
    } else if (c.id === "__theme") {
      onToggleTheme();
    } else if (c.id === "__top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (c.id === "support") {
      window.open("https://t.me/RevoAgent", "_blank", "noopener");
    } else {
      onGo(c.id);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = filtered[safeActive];
      if (c) execute(c);
    }
  }

  if (!open) return null;

  // Group filtered items
  const groups = Array.from(new Set(filtered.map((c) => c.group)));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" aria-hidden />
      {/* palette */}
      <div className="revo-card revo-card-glow relative w-full max-w-xl overflow-hidden p-0">
        {/* search header */}
        <div className="flex items-center gap-3 border-b border-[#1e2240] px-4 py-3.5">
          <i className="fas fa-magnifying-glass text-base text-[#5a6a99]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={onQueryChange}
            onKeyDown={onKeyDown}
            placeholder="Search sections, actions… (↑↓ to navigate, ↵ to select)"
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#5a6a99]"
          />
          <kbd className="hidden rounded border border-[#1e2240] bg-[#0d1020] px-1.5 py-0.5 text-[10px] font-bold text-[#5a6a99] sm:inline">
            ESC
          </kbd>
        </div>

        {/* results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto revo-scroll p-2">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#5a6a99]">
              No matches for &ldquo;{query}&rdquo;
            </div>
          ) : (
            groups.map((group) => (
              <div key={group} className="mb-1.5">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
                  {group}
                </div>
                {filtered
                  .filter((c) => c.group === group)
                  .map((c) => {
                    const idx = filtered.indexOf(c);
                    const isActive = idx === safeActive;
                    return (
                      <button
                        key={c.id}
                        data-idx={idx}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => execute(c)}
                        className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition ${
                          isActive
                            ? "bg-[#448AFF]/15 ring-1 ring-[#448AFF]/30"
                            : "hover:bg-white/[0.03]"
                        }`}
                      >
                        <span
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm transition ${
                            isActive
                              ? "bg-[#448AFF] text-white"
                              : "bg-[#448AFF]/12 text-[#448AFF]"
                          }`}
                        >
                          <i className={`fas ${c.icon}`} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-white">
                            {c.label}
                          </div>
                          {c.hint && (
                            <div className="truncate text-[11px] text-[#5a6a99]">
                              {c.hint}
                            </div>
                          )}
                        </div>
                        {isActive && (
                          <i className="fas fa-arrow-right text-xs text-[#448AFF]" />
                        )}
                      </button>
                    );
                  })}
              </div>
            ))
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-[#1e2240] bg-[#0d1020]/40 px-3 py-2 text-[10px] text-[#5a6a99]">
          <div className="flex items-center gap-3">
            <span><kbd className="rounded bg-[#1e2240] px-1 py-0.5">↑↓</kbd> navigate</span>
            <span><kbd className="rounded bg-[#1e2240] px-1 py-0.5">↵</kbd> select</span>
            <span><kbd className="rounded bg-[#1e2240] px-1 py-0.5">esc</kbd> close</span>
          </div>
          <span className="font-semibold text-[#448AFF]">Revo Fixer</span>
        </div>
      </div>
    </div>
  );
}
