import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HLS_MASTER = "https://live101.egprom.com/app/43/amlst:dc3_ct_auto/playlist.m3u8";
const HLS_BASE = "https://live101.egprom.com/app/43/";
const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Referer: "https://www.casinoorg-india.com/",
};

/** GET /api/video-proxy?type=master — returns the master playlist (rewritten URLs) */
/** GET /api/video-proxy?type=playlist&sid=XXX — returns media playlist (rewritten URLs) */
/** GET /api/video-proxy?type=segment&url=XXX — proxies a single video segment */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "master";

  try {
    if (type === "master") {
      // Fetch master playlist
      const res = await fetch(HLS_MASTER, { headers: HEADERS, cache: "no-store" });
      if (!res.ok) return NextResponse.json({ error: "HLS fetch failed" }, { status: 502 });
      let text = await res.text();
      // Rewrite media playlist URLs to go through our proxy
      text = text.replace(
        /(https:\/\/live101\.egprom\.com\/app\/43\/dc3_ct_\w+\/media\.m3u8\?sid=\w+)/g,
        (_, url) => {
          const sid = url.match(/sid=(\w+)/)?.[1] ?? "";
          const quality = url.match(/dc3_ct_(\w+)/)?.[1] ?? "hi";
          return `/api/video-proxy?type=playlist&sid=${sid}&q=${quality}`;
        }
      );
      return new NextResponse(text, {
        headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
      });
    }

    if (type === "playlist") {
      const sid = searchParams.get("sid") ?? "";
      const q = searchParams.get("q") ?? "hi";
      const playlistUrl = `${HLS_BASE}dc3_ct_${q}/media.m3u8?sid=${sid}`;
      const res = await fetch(playlistUrl, { headers: HEADERS, cache: "no-store" });
      if (!res.ok) return NextResponse.json({ error: "Playlist fetch failed" }, { status: 502 });
      let text = await res.text();
      // Rewrite segment URLs to go through our proxy
      text = text.replace(
        /(https:\/\/live101\.egprom\.com\/app\/43\/dc3_ct_\w+\/media\.\d+\.mp4\?[^"\s]+)/g,
        (_, url) => `/api/video-proxy?type=segment&url=${encodeURIComponent(url)}`,
      );
      // Also rewrite init segment
      text = text.replace(
        /(https:\/\/live101\.egprom\.com\/app\/43\/dc3_ct_\w+\/media-init\.\d+\.mp4\?[^"\s]+)/g,
        (_, url) => `/api/video-proxy?type=segment&url=${encodeURIComponent(url)}`,
      );
      return new NextResponse(text, {
        headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
      });
    }

    if (type === "segment") {
      const url = searchParams.get("url") ?? "";
      if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });
      const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
      if (!res.ok) return NextResponse.json({ error: "Segment fetch failed" }, { status: 502 });
      const buf = await res.arrayBuffer();
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "video/mp4",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
