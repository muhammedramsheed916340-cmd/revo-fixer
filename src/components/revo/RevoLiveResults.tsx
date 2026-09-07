"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Live Crazy Time Results section.
 *
 * The casino page (casinoorg-india.com) sends X-Frame-Options: DENY, so it
 * CANNOT be embedded in an iframe. Instead we:
 *  1. Embed the live HLS video stream via an HTML5 video + hls.js player
 *     (stream URL from the casino page's JSON-LD structured data).
 *  2. Provide a prominent "Open Full Live Results" button that opens the
 *     casino page in a new tab (results, stats, spin history, etc).
 *
 * NOT "Crazy Time A" — this is the main Crazy Time table.
 */

// Real HLS stream URL from the casino page's JSON-LD (contentUrl field).
const STREAM_URL =
  "https://live101.egprom.com/app/43/amlst:dc3_ct_auto/playlist.m3u8";

// Cloudinary game card images (same as the game section).
const GAME_CARD_IMAGES: Record<string, string> = {
  "1": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539269/one-card_r0ffuy.png",
  "2": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539364/two-card_ayl9lu.png",
  "5": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539403/five-card_msp0cr.png",
  "10": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539416/ten-card_cx3cvj.png",
  PACHINKO: "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539441/pachiko-card_zxiw7r.png",
  "COIN FLIP": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539429/coin-flip-card_kbbg7m.png",
  "CASH HUNT": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539519/cash-hunt-card_jp8hr3.png",
  "CRAZY TIME": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539531/crazy-time-card_dftfw3.png",
};

const ALL_OUTCOMES = ["1", "2", "5", "10", "COIN FLIP", "CASH HUNT", "PACHINKO", "CRAZY TIME"];

export function RevoLiveResults() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamStatus, setStreamStatus] = useState<
    "idle" | "loading" | "playing" | "error"
  >("idle");

  // Load hls.js dynamically (client-side only) to play the HLS stream.
  useEffect(() => {
    let hls: { destroy: () => void } | null = null;

    async function initStream() {
      const video = videoRef.current;
      if (!video) return;

      setStreamStatus("loading");

      try {
        // Dynamically import hls.js (it's not an SSR-safe import).
        const Hls = (await import("hls.js")).default;

        if (Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 30,
          });
          hls.loadSource(STREAM_URL);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video
              .play()
              .then(() => setStreamStatus("playing"))
              .catch(() => setStreamStatus("error"));
          });

          hls.on(Hls.Events.ERROR, (_event: unknown, data: { fatal: boolean }) => {
            if (data.fatal) {
              setStreamStatus("error");
            }
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          // Safari / iOS native HLS support.
          video.src = STREAM_URL;
          video.addEventListener("loadedmetadata", () => {
            video
              .play()
              .then(() => setStreamStatus("playing"))
              .catch(() => setStreamStatus("error"));
          });
        } else {
          setStreamStatus("error");
        }
      } catch {
        setStreamStatus("error");
      }
    }

    initStream();

    return () => {
      if (hls) hls.destroy();
    };
  }, []);

  return (
    <section id="live-results" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#2ed573]">
            <span className="revo-pulse text-[#2ed573]">●</span> Live Results
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Crazy Time <span className="revo-gradient-text">Live Results</span>
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-[#8899cc]">
            Watch the Crazy Time live stream &amp; check real-time results from
            CasinoScores. See every spin outcome as it happens.
          </p>
        </div>

        {/* Live stream player */}
        <div className="revo-card revo-card-glow overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#2ed573]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-video text-[#2ed573]" /> Live Stream
            </span>
            <div className="flex items-center gap-2">
              {streamStatus === "playing" && (
                <span className="flex items-center gap-1 rounded-full bg-[#ff4757]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[#ff4757]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff4757]" />
                  LIVE
                </span>
              )}
              {streamStatus === "loading" && (
                <span className="flex items-center gap-1 rounded-full bg-[#448AFF]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[#448AFF]">
                  <i className="fas fa-spinner fa-spin" /> Connecting
                </span>
              )}
              {streamStatus === "error" && (
                <span className="flex items-center gap-1 rounded-full bg-[#ffa502]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[#ffa502]">
                  <i className="fas fa-triangle-exclamation" /> Offline
                </span>
              )}
            </div>
          </div>

          {/* Video player */}
          <div className="relative bg-black">
            <video
              ref={videoRef}
              className="aspect-video w-full bg-black"
              controls
              autoPlay
              muted
              playsInline
            />

            {/* Loading overlay */}
            {streamStatus === "loading" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
                <div className="mb-3 h-12 w-12 animate-spin rounded-full border-4 border-[#2ed573]/20 border-t-[#2ed573]" />
                <div className="text-sm font-bold text-white">
                  Connecting to live stream…
                </div>
                <div className="text-xs text-[#5a6a99]">
                  CasinoScores Crazy Time feed
                </div>
              </div>
            )}

            {/* Error overlay */}
            {streamStatus === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center">
                <span className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-[#ffa502]/15 text-2xl text-[#ffa502]">
                  <i className="fas fa-video-slash" />
                </span>
                <div className="text-sm font-bold text-white">
                  Stream temporarily unavailable
                </div>
                <div className="mt-1 text-xs text-[#5a6a99]">
                  The live stream may be geo-restricted or the source is
                  temporarily offline.
                </div>
                <a
                  href="https://www.casinoorg-india.com/india/casinoscores/crazy-time/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="revo-btn mt-4 flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold"
                >
                  <i className="fas fa-arrow-up-right-from-square" /> Open on
                  CasinoScores
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Full results button — opens casino page in new tab */}
        <div className="revo-card mt-4 p-4">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <div className="text-center sm:text-left">
              <div className="text-sm font-bold text-white">
                Full Live Results &amp; Statistics
              </div>
              <div className="text-xs text-[#8899cc]">
                Spin history, segment frequency, bonus triggers, biggest wins &amp;
                more — tracked in real-time by CasinoScores.
              </div>
            </div>
            <a
              href="https://www.casinoorg-india.com/india/casinoscores/crazy-time/"
              target="_blank"
              rel="noopener noreferrer"
              className="revo-btn flex shrink-0 items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold"
            >
              <i className="fas fa-tower-broadcast" /> Open Live Results
              <i className="fas fa-arrow-up-right-from-square text-[10px]" />
            </a>
          </div>
        </div>

        {/* Possible outcomes reference (same 8 as the game) */}
        <div className="mt-4">
          <div className="mb-2 text-center text-[11px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Crazy Time outcomes
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {ALL_OUTCOMES.map((name) => {
              const isBonus = ["COIN FLIP", "CASH HUNT", "PACHINKO", "CRAZY TIME"].includes(name);
              return (
                <div
                  key={name}
                  className={`flex flex-col items-center rounded-lg border p-2 ${
                    isBonus
                      ? "border-[#FFD700]/40 bg-[#FFD700]/5"
                      : "border-[#1e2240] bg-[#0d1020]"
                  }`}
                >
                  <img
                    src={GAME_CARD_IMAGES[name]}
                    alt={name}
                    className="h-10 w-full object-contain"
                  />
                  <div className="mt-0.5 text-[10px] font-bold text-white">{name}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Info cards */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="revo-card flex items-center gap-3 p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#2ed573]/15 text-[#2ed573]">
              <i className="fas fa-bolt" />
            </span>
            <div>
              <div className="text-xs font-bold text-white">Real-Time Results</div>
              <div className="text-[10px] text-[#5a6a99]">Every spin tracked live</div>
            </div>
          </div>
          <div className="revo-card flex items-center gap-3 p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#448AFF]/15 text-[#448AFF]">
              <i className="fas fa-chart-column" />
            </span>
            <div>
              <div className="text-xs font-bold text-white">Statistics</div>
              <div className="text-[10px] text-[#5a6a99]">Frequency & bonus triggers</div>
            </div>
          </div>
          <div className="revo-card flex items-center gap-3 p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#FFD700]/15 text-[#FFD700]">
              <i className="fas fa-video" />
            </span>
            <div>
              <div className="text-xs font-bold text-white">Live Stream</div>
              <div className="text-[10px] text-[#5a6a99]">Watch the wheel spin</div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-[#5a6a99]">
          <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
          Live stream &amp; results provided by CasinoScores (casino.org). The
          stream may be geo-restricted in some regions. For entertainment only —
          play responsibly.
        </p>
      </div>
    </section>
  );
}
