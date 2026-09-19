"use client";

/**
 * SHARED PANEL FRAME (ADDITIVE — new file)
 * ========================================
 *
 * The experimental panels read values that only exist in the browser
 * (localStorage-backed signal store, video telemetry, feature-flag overrides).
 * Rendering those values during hydration would make the client output differ
 * from the server output and produce React hydration errors in production
 * builds (Vercel).
 *
 * `useMounted()` uses the SAME lint-safe mount-detection pattern already used
 * by `RevoGame.tsx` (useSyncExternalStore with a `false` server snapshot), and
 * `SignalPanelPlaceholder` renders a stable, data-free shell for the
 * pre-mount render so the server output and the first client render match
 * byte for byte.
 */

import { useSyncExternalStore } from "react";

export function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function SignalPanelPlaceholder({
  icon,
  title,
  note,
  accent = "#00d4ff",
}: {
  icon: string;
  title: string;
  note: string;
  accent?: string;
}) {
  return (
    <div className="revo-card overflow-hidden">
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1e2240] px-4 py-3"
        style={{ backgroundImage: `linear-gradient(to right, ${accent}1a, transparent)` }}
      >
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className={`fas ${icon}`} style={{ color: accent }} /> {title}
        </span>
        <span className="text-[10px] text-[#5a6a99]">initializing live diagnostics…</span>
      </div>
      <div className="p-4 text-[11px] text-[#5a6a99]">{note}</div>
    </div>
  );
}

export default SignalPanelPlaceholder;
