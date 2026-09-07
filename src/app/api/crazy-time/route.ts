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

// Stats cache is kept (15s TTL) — stats don't change as frequently.
// Recent results cache is REMOVED — every poll fetches fresh from the API.
let statsCache: { data: unknown; at: number } | null = null;
let statsFetching = false;
const STATS_TTL = 15000; // 15 seconds

// Dedup guard for concurrent recent requests (prevent API hammering).
// If a fetch is in progress, subsequent requests wait for it.
let recentFetchPromise: Promise<unknown[]> | null = null;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "recent";
  const size = searchParams.get("size") ?? "30";
  const duration = searchParams.get("duration") ?? "24";

  if (type === "stats") {
    // Stats: cached for 15s (doesn't change frequently)
    if (statsCache && Date.now() - statsCache.at < STATS_TTL) {
      return NextResponse.json(statsCache.data, { headers: { "Cache-Control": "no-store" } });
    }
    if (statsFetching && statsCache) {
      return NextResponse.json(statsCache.data, { headers: { "Cache-Control": "no-store" } });
    }
    statsFetching = true;
    try {
      const res = await fetch(`${API_BASE}/stats?duration=${duration}&sortField=count`, { headers: HEADERS, cache: "no-store" });
      if (res.ok) {
        statsCache = { data: await res.json(), at: Date.now() };
      }
    } catch { /* keep stale */ }
    statsFetching = false;
    return NextResponse.json(statsCache?.data ?? {}, { headers: { "Cache-Control": "no-store" } });
  }

  // Recent results: NO cache — always fetch fresh from the API.
  // This ensures live results are detected as soon as the next poll runs.
  // Dedup concurrent requests to prevent API overload.
  if (recentFetchPromise) {
    // A fetch is already in progress — wait for it instead of starting another
    try {
      const data = await recentFetchPromise;
      return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
    }
  }

  // Start a fresh fetch
  recentFetchPromise = (async () => {
    try {
      // Add cache-busting param to prevent any CDN/proxy caching
      const bust = Date.now();
      const res = await fetch(
        `${API_BASE}?page=0&size=${size}&sort=data.settledAt,desc&duration=${duration}&wheelResults=Pachinko,CashHunt,CrazyBonus,CoinFlip,1,2,5,10&isTopSlotMatched=true,false&_bust=${bust}`,
        { headers: HEADERS, cache: "no-store" }
      );
      if (res.ok) {
        return await res.json();
      }
      return [];
    } catch {
      return [];
    } finally {
      recentFetchPromise = null;
    }
  })();

  try {
    const data = await recentFetchPromise;
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
  }
}
