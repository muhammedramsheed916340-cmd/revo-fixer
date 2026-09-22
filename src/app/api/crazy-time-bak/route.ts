import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const API_BASE = "https://api-cs.casino.org/svc-evolution-game-events/api/crazytime";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Origin: "https://www.casinoorg-india.com",
  Referer: "https://www.casinoorg-india.com/",
  Accept: "application/json",
};

/**
 * Server-side proxy for the CasinoScores Crazy Time API.
 * Fetches real-time results + statistics. NO external links — everything
 * renders inside the app.
 *
 * GET /api/crazy-time?type=recent  → latest spin results (page, size, duration)
 * GET /api/crazy-time?type=stats    → aggregate statistics (frequency, etc.)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "recent";
  const page = searchParams.get("page") ?? "0";
  const size = searchParams.get("size") ?? "20";
  const duration = searchParams.get("duration") ?? "24";

  try {
    let url: string;
    if (type === "stats") {
      url = `${API_BASE}/stats?duration=${duration}&sortField=count`;
    } else {
      // Recent results — omit tableId to get the main Crazy Time table.
      url = `${API_BASE}?page=${page}&size=${size}&sort=data.settledAt,desc&duration=${duration}&wheelResults=Pachinko,CashHunt,CrazyBonus,CoinFlip,1,2,5,10&isTopSlotMatched=true,false`;
    }

    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream ${res.status}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch Crazy Time data" },
      { status: 500 },
    );
  }
}
