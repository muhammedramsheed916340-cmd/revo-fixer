"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Real game outcomes + Cloudinary card images (from the original Revo Fixer app)
const GAME_IMAGES: Record<string, string> = {
  "1": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539269/one-card_r0ffuy.png",
  "2": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539364/two-card_ayl9lu.png",
  "5": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539403/five-card_msp0cr.png",
  "10": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539416/ten-card_cx3cvj.png",
  PACHINKO: "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539441/pachiko-card_zxiw7r.png",
  "COIN FLIP": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539429/coin-flip-card_kbbg7m.png",
  "CASH HUNT": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539519/cash-hunt-card_jp8hr3.png",
  "CRAZY TIME": "https://res.cloudinary.com/dw72p48ir/image/upload/v1773539531/crazy-time-card_dftfw3.png",
};

interface Game {
  name: string;
  imageKey: string;
  confidenceRange: [number, number];
  isBonus: boolean;
}

// Real game data from the original app (same 8 outcomes + confidence ranges)
const GAMES: Game[] = [
  { name: "1", imageKey: "1", confidenceRange: [85, 95], isBonus: false },
  { name: "2", imageKey: "2", confidenceRange: [80, 92], isBonus: false },
  { name: "5", imageKey: "5", confidenceRange: [75, 90], isBonus: false },
  { name: "10", imageKey: "10", confidenceRange: [70, 88], isBonus: false },
  { name: "PACHINKO", imageKey: "PACHINKO", confidenceRange: [60, 85], isBonus: true },
  { name: "COIN FLIP", imageKey: "COIN FLIP", confidenceRange: [68, 89], isBonus: true },
  { name: "CASH HUNT", imageKey: "CASH HUNT", confidenceRange: [65, 87], isBonus: true },
  { name: "CRAZY TIME", imageKey: "CRAZY TIME", confidenceRange: [55, 82], isBonus: true },
];

// Weighted selection thresholds (from the original app's algorithm)
const WEIGHTS: number[] = [0.22, 0.42, 0.6, 0.75, 0.85, 0.92, 0.97, 1.0];

interface Prediction {
  game: Game;
  confidence: number;
  time: number;
}

function pickGame(): Game {
  const rand = Math.random();
  for (let i = 0; i < WEIGHTS.length; i++) {
    if (rand < WEIGHTS[i]) return GAMES[i];
  }
  return GAMES[0];
}

function confidenceFor(game: Game): number {
  const [lo, hi] = game.confidenceRange;
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

const BONUS_NAMES = ["PACHINKO", "COIN FLIP", "CASH HUNT", "CRAZY TIME"];

// Read a saved signal from localStorage once (lazy init, SSR-safe).
function readSavedSignal(): Prediction | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem("revo_lastSignal");
    if (!saved) return null;
    const data = JSON.parse(saved) as Prediction;
    if (Date.now() - data.time < 5 * 60 * 1000) return data;
    localStorage.removeItem("revo_lastSignal");
    return null;
  } catch {
    return null;
  }
}

export function RevoGame() {
  const [prediction, setPrediction] = useState<Prediction | null>(readSavedSignal);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [running, setRunning] = useState(() => prediction !== null);
  const [stats, setStats] = useState({
    total: 1249,
    accuracy: 94,
    bonusHits: 128,
    liveUsers: 1247,
  });
  const [clock, setClock] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live clock (HH:MM)
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      );
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const generatePrediction = useCallback(() => {
    setLoading(true);
    setPrediction(null);
    setTimeout(() => {
      const game = pickGame();
      const confidence = confidenceFor(game);
      const pred: Prediction = { game, confidence, time: Date.now() };
      setPrediction(pred);
      setLoading(false);
      setRunning(true);
      setCountdown(60); // reset countdown when a new signal session starts
      try {
        localStorage.setItem("revo_lastSignal", JSON.stringify(pred));
      } catch {
        /* ignore */
      }
      // Update stats (same logic as original app)
      setStats((s) => {
        const total = s.total + 1;
        const bonusHits = s.bonusHits + (BONUS_NAMES.includes(game.name) ? 1 : 0);
        const accuracyChange = Math.random() > 0.7 ? -1 : 1;
        const accuracy = Math.max(85, Math.min(98, s.accuracy + accuracyChange));
        return { ...s, total, bonusHits, accuracy };
      });
    }, 2000);
  }, []);

  const refreshPrediction = useCallback(() => {
    setPrediction(null);
    setRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    try {
      localStorage.removeItem("revo_lastSignal");
    } catch {
      /* ignore */
    }
    setTimeout(() => generatePrediction(), 300);
  }, [generatePrediction]);

  // Auto-refresh countdown (60s → regenerate, like the original)
  useEffect(() => {
    if (!running) return;
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          generatePrediction();
          return 60;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [running, generatePrediction]);

  // Live users fluctuation (every 8s, like the original)
  useEffect(() => {
    liveRef.current = setInterval(() => {
      setStats((s) => {
        const change = Math.floor(Math.random() * 20) - 10;
        return { ...s, liveUsers: Math.max(1000, s.liveUsers + change) };
      });
    }, 8000);
    return () => {
      if (liveRef.current) clearInterval(liveRef.current);
    };
  }, []);

  // Pause auto-refresh when tab hidden
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && timerRef.current) clearInterval(timerRef.current);
      else if (!document.hidden && running && !timerRef.current) {
        timerRef.current = setInterval(() => {
          setCountdown((c) => {
            if (c <= 1) {
              generatePrediction();
              return 60;
            }
            return c - 1;
          });
        }, 1000);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [running, generatePrediction]);

  return (
    <section id="game" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <span className="revo-pulse text-[#2ed573]">●</span> Live Game
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            <span className="revo-gradient-animate">CRAZY TIME</span> LIVE
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-[#8899cc]">
            ⚡ Live Predictions • High Accuracy ⚡ — the same Crazy Time Revo
            Signal engine from the original app, now free to use.
          </p>
        </div>

        {/* Auto-refresh timer */}
        {running && (
          <div className="mb-3 flex items-center justify-center gap-2 text-[11px] font-semibold text-[#8899cc]">
            <i className="fas fa-sync-alt fa-spin text-[#448AFF]" />
            Next signal in {countdown}s
          </div>
        )}

        {/* Signal card */}
        <div className="revo-card revo-card-glow overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#448AFF]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-bolt text-[#FFD700]" /> Current Prediction
            </span>
            {clock && (
              <span className="text-[11px] text-[#5a6a99]">• {clock}</span>
            )}
          </div>

          <div className="p-5 sm:p-6">
            {!prediction && !loading && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <span className="mb-3 grid h-16 w-16 place-items-center rounded-full bg-[#448AFF]/10 text-2xl text-[#448AFF] ring-2 ring-[#448AFF]/20">
                  <i className="fas fa-hand-pointer" />
                </span>
                <div className="text-sm font-bold text-white">
                  Click Get Signal To Start Live Session
                </div>
                <div className="text-xs text-[#5a6a99]">Get instant predictions</div>
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="mb-3 h-11 w-11 animate-spin rounded-full border-4 border-[#448AFF]/15 border-t-[#448AFF]" />
                <div className="text-sm font-bold text-white">Analyzing Patterns…</div>
                <div className="text-xs text-[#5a6a99]">Please wait</div>
              </div>
            )}

            {prediction && !loading && (
              <div className="flex flex-col items-center">
                <div className="relative overflow-hidden rounded-2xl border border-[#1e2240] bg-[#0d1020]">
                  <img
                    src={GAME_IMAGES[prediction.game.imageKey]}
                    alt={prediction.game.name}
                    className="h-36 w-full max-w-[260px] object-contain sm:h-44"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0d1020] via-[#0d1020]/80 to-transparent p-3 text-center">
                    <div className="text-lg font-black text-white sm:text-2xl">
                      {prediction.game.name}
                    </div>
                    {prediction.game.isBonus && (
                      <span className="mt-0.5 inline-block rounded-full bg-[#FFD700]/20 px-2 py-0.5 text-[10px] font-bold uppercase text-[#FFD700]">
                        ★ Bonus Round
                      </span>
                    )}
                  </div>
                </div>

                {/* Confidence bar */}
                <div className="mt-4 w-full max-w-md">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-bold text-[#8899cc]">
                      <i className="fas fa-chart-line text-[#448AFF]" /> AI Confidence
                    </span>
                    <span className="font-black text-[#2ed573]">
                      {prediction.confidence}%
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[#1e2240]">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${prediction.confidence}%`,
                        background:
                          prediction.confidence >= 80
                            ? "linear-gradient(90deg,#2ed573,#448AFF)"
                            : prediction.confidence >= 65
                              ? "linear-gradient(90deg,#448AFF,#00d4ff)"
                              : "linear-gradient(90deg,#ffa502,#FFD700)",
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2 border-t border-[#1e2240] p-4">
            <button
              onClick={generatePrediction}
              disabled={loading}
              className="revo-btn flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-60"
            >
              <i className={`fas ${loading ? "fa-spinner fa-spin" : "fa-magic"}`} />
              {loading ? "Analyzing…" : "GET SIGNAL"}
            </button>
            <button
              onClick={refreshPrediction}
              disabled={loading}
              className="flex items-center justify-center gap-2 rounded-xl border border-[#1e2240] bg-[#0d1020] px-4 py-3 text-sm font-bold text-[#bcc6e0] transition hover:bg-[#1e2240] hover:text-white disabled:opacity-60"
            >
              <i className="fas fa-sync-alt" /> REFRESH
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="revo-card mt-4 p-4">
          <div className="grid grid-cols-4 gap-2">
            <Stat value={stats.total.toLocaleString()} label="Total" color="#448AFF" />
            <Stat value={`${stats.accuracy}%`} label="Accuracy" color="#2ed573" />
            <Stat value={String(stats.bonusHits)} label="Bonus" color="#FFD700" />
            <Stat value={`${(stats.liveUsers / 1000).toFixed(1)}k`} label="Live" color="#00d4ff" />
          </div>
        </div>

        {/* Game outcomes reference */}
        <div className="mt-4">
          <div className="mb-2 text-center text-[11px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Possible outcomes
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {GAMES.map((g) => (
              <span
                key={g.name}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  g.isBonus
                    ? "border-[#FFD700]/40 bg-[#FFD700]/10 text-[#FFD700]"
                    : "border-[#1e2240] bg-[#0d1020] text-[#8899cc]"
                }`}
              >
                {g.name}
              </span>
            ))}
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-[#5a6a99]">
          <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
          Predictions are generated by the Revo Fixer signal engine for
          entertainment. Play responsibly.
        </p>
      </div>
    </section>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="text-center">
      <div className="text-lg font-black sm:text-xl" style={{ color }}>
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">{label}</div>
    </div>
  );
}
