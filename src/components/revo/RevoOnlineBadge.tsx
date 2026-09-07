"use client";

import { useEffect, useState } from "react";

interface OnlineData {
  count: number;
  windowLabel: string;
  totalKeys: number;
}

export function RevoOnlineBadge() {
  const [data, setData] = useState<OnlineData | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/online-users");
        const json: OnlineData = await res.json();
        if (active) setData(json);
      } catch {
        /* ignore */
      }
    }
    load();
    const t = setInterval(load, 20000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  if (!data || data.count === 0) return null;

  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-[#2ed573]/40 bg-[#2ed573]/10 px-2.5 py-1 text-[11px] font-semibold text-[#2ed573] sm:flex"
      title={`${data.count} keys active in the last ${data.windowLabel} · ${data.totalKeys} total keys`}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2ed573] opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2ed573]" />
      </span>
      {data.count} online
    </span>
  );
}
