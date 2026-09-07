"use client";

import { useTheme } from "next-themes";

export function RevoThemeToggle() {
  const { theme, setTheme } = useTheme();
  // Click handler toggles based on the *current* client theme. The label/text
  // stays static so server and client render identical HTML (no hydration
  // mismatch). The icon swap is CSS-only (dark:block / dark:hidden).
  void theme; // referenced for handler closure; not used in render output

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="grid h-10 w-10 place-items-center rounded-lg border border-[#1e2240] bg-[#141827]/60 text-[#bcc6e0] transition hover:bg-[#1e2240] hover:text-white"
      aria-label="Toggle theme"
      title="Toggle dark / light theme"
    >
      {/* CSS-only icon swap: sun shows in dark mode (click → light),
          moon shows in light mode (click → dark). */}
      <i className="fas fa-sun text-base text-[#ffa502] dark:block hidden" />
      <i className="fas fa-moon text-base text-[#448AFF] dark:hidden" />
    </button>
  );
}
