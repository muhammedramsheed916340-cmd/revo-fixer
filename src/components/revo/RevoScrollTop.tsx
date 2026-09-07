"use client";

import { useEffect, useState } from "react";

export function RevoScrollTop() {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const scrolled = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setVisible(scrolled > 400);
      setProgress(max > 0 ? Math.min(100, (scrolled / max) * 100) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-5 right-5 z-50 grid h-12 w-12 place-items-center rounded-full border border-[#1e2240] bg-[#141827]/90 text-[#448AFF] shadow-2xl backdrop-blur-md transition hover:scale-110 hover:text-white"
      aria-label="Scroll to top"
      style={{
        background: `conic-gradient(#448AFF ${progress}%, rgba(20,24,39,0.9) ${progress}%)`,
      }}
    >
      <span className="grid h-9 w-9 place-items-center rounded-full bg-[#0a0b14]">
        <i className="fas fa-arrow-up" />
      </span>
    </button>
  );
}

/** Decorative section divider with a centered icon + gradient line. */
export function RevoDivider({
  icon = "fa-bolt",
  color = "#448AFF",
}: {
  icon?: string;
  color?: string;
}) {
  return (
    <div className="relative mx-auto my-2 flex max-w-xs items-center gap-3">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#1e2240]" />
      <span
        className="grid h-8 w-8 place-items-center rounded-full border"
        style={{
          background: `${color}15`,
          borderColor: `${color}40`,
          color,
        }}
      >
        <i className={`fas ${icon} text-xs`} />
      </span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#1e2240]" />
    </div>
  );
}
