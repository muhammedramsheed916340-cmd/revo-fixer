"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Smoothly animates a number from 0 → target when the element first scrolls
 * into view (IntersectionObserver, easeOutCubic). Returns [value, refToAttach].
 */
export function useCountUpWithRef(
  target: number,
  durationMs = 1200,
): [number, React.Ref<HTMLSpanElement>] {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || target === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started.current) {
            started.current = true;
            const start = performance.now();
            const tick = (now: number) => {
              const elapsed = now - start;
              const progress = Math.min(1, elapsed / durationMs);
              const eased = 1 - Math.pow(1 - progress, 3);
              setValue(Math.round(target * eased));
              if (progress < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target, durationMs]);

  // When target is 0 there is nothing to animate — return 0 directly.
  return [target === 0 ? 0 : value, ref];
}
