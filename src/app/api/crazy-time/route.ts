import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const API_BASE = "https://api-cs.casino.org/svc-evolution-game-events/api/crazytime";
const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Origin: "https://www.casinoorg-india.com",
  Referer: "https://www.casinoorg-india.com/india/casinoscores/crazy-time/",
  Accept: "application/json",
};

// Server-side in-memory cache to prevent OOM from repeated external fetches.
let recentCache: { data: unknown; at: number } | null = null;
let statsCache: { data: unknown; at: number } | null = null;
const CACHE_TTL = 30000; // 30 seconds

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "recent";
  const page = searchParams.get("page") ?? "0";
  const size = searchParams.get("size") ?? "20";
  const duration = searchParams.get("duration") ?? "24";

  try {
    let url: string;
    let cache: { data: unknown; at: number } | null;

    if (type === "stats") {
      url = `${API_BASE}/stats?duration=${duration}&sortField=count`;
      cache = statsCache;
    } else {
      url = `${API_BASE}?page=${page}&size=${size}&sort=data.settledAt,desc&duration=${duration}&wheelResults=Pachinko,CashHunt,CrazyBonus,CoinFlip,1,2,5,10&isTopSlotMatched=true,false`;
      cache = recentCache;
    }

    // Return cached data if fresh enough.
    if (cache && Date.now() - cache.at < CACHE_TTL) {
      return NextResponse.json(cache.data, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) {
      // Return stale cache if available on error.
      if (cache) {
        return NextResponse.json(cache.data, {
          headers: { "Cache-Control": "no-store" },
        });
      }
      return NextResponse.json({ error: `Upstream ${res.status}` }, { status: 502 });
    }

    const data = await res.json();

    // Update cache.
    if (type === "stats") {
      statsCache = { data, at: Date.now() };
    } else {
      recentCache = { data, at: Date.now() };
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    // Return stale cache on exception.
    const cache = type === "stats" ? statsCache : recentCache;
    if (cache) {
      return NextResponse.json(cache.data, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
