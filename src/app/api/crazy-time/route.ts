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

// In-memory cache — long TTL to prevent excessive external fetches.
let recentCache: { data: unknown; at: number } | null = null;
let statsCache: { data: unknown; at: number } | null = null;
let recentFetching = false;
let statsFetching = false;
const RECENT_TTL = 8000; // 8 seconds
const STATS_TTL = 30000; // 30 seconds

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "recent";
  const size = searchParams.get("size") ?? "30";
  const duration = searchParams.get("duration") ?? "24";

  if (type === "stats") {
    // Return cached if fresh
    if (statsCache && Date.now() - statsCache.at < STATS_TTL) {
      return NextResponse.json(statsCache.data, { headers: { "Cache-Control": "no-store" } });
    }
    // Return stale while fetching
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

  // Recent results
  if (recentCache && Date.now() - recentCache.at < RECENT_TTL) {
    return NextResponse.json(recentCache.data, { headers: { "Cache-Control": "no-store" } });
  }
  // Return stale while fetching
  if (recentFetching && recentCache) {
    return NextResponse.json(recentCache.data, { headers: { "Cache-Control": "no-store" } });
  }
  recentFetching = true;
  try {
    const res = await fetch(
      `${API_BASE}?page=0&size=${size}&sort=data.settledAt,desc&duration=${duration}&wheelResults=Pachinko,CashHunt,CrazyBonus,CoinFlip,1,2,5,10&isTopSlotMatched=true,false`,
      { headers: HEADERS, cache: "no-store" }
    );
    if (res.ok) {
      recentCache = { data: await res.json(), at: Date.now() };
    }
  } catch { /* keep stale */ }
  recentFetching = false;
  return NextResponse.json(recentCache?.data ?? [], { headers: { "Cache-Control": "no-store" } });
}
