"use client";

import { useTheme } from "next-themes";

export function RevoThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="grid h-10 w-10 place-items-center rounded-lg border border-[#1e2240] bg-[#141827]/60 text-[#bcc6e0] transition hover:bg-[#1e2240] hover:text-white"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {/* CSS-only icon swap: sun shows in dark mode (click → light),
          moon shows in light mode (click → dark). Avoids hydration mismatch. */}
      <i className="fas fa-sun text-base text-[#ffa502] dark:block hidden" />
      <i className="fas fa-moon text-base text-[#448AFF] dark:hidden" />
    </button>
  );
}
