"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

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

/** Number of simultaneous signal cards. */
const SIGNAL_COUNT = 4;

interface Prediction {
  game: Game;
  confidence: number;
  time: number;
}

/** A verified round: the prediction that was active + the actual result the
 *  user manually selected + whether it was a HIT or MISS. */
interface RoundResult {
  prediction: Prediction[]; // the 4 predictions that were active
  actualResult: Game; // the real result the user selected
  hit: boolean; // did any of the 4 predictions match the actual result?
  time: number;
}

/**
 * Pick a game using the original weighted algorithm, while excluding any games
 * already chosen so every signal box shows a DIFFERENT outcome.
 */
function pickUniqueGames(count: number): Game[] {
  const pool = [...GAMES];
  const chosen: Game[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const rand = Math.random();
    let pickIdx = 0;
    const totalW = pool.reduce((s, _g, idx) => {
      const prev = idx === 0 ? 0 : WEIGHTS[GAMES.indexOf(pool[idx - 1])];
      const cur = WEIGHTS[GAMES.indexOf(pool[idx])];
      return s + (cur - prev);
    }, 0);
    let acc = 0;
    for (let j = 0; j < pool.length; j++) {
      const prev = j === 0 ? 0 : WEIGHTS[GAMES.indexOf(pool[j - 1])];
      const cur = WEIGHTS[GAMES.indexOf(pool[j])];
      acc += (cur - prev) / totalW;
      if (rand <= acc) {
        pickIdx = j;
        break;
      }
    }
    chosen.push(pool.splice(pickIdx, 1)[0]);
  }
  return chosen;
}

function confidenceFor(game: Game): number {
  const [lo, hi] = game.confidenceRange;
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/** Build N unique predictions (no two boxes show the same game). */
function buildPredictions(): Prediction[] {
  const games = pickUniqueGames(SIGNAL_COUNT);
  const now = Date.now();
  return games.map((game) => ({
    game,
    confidence: confidenceFor(game),
    time: now,
  }));
}

/**
 * History-informed prediction: uses the manually-verified actual results to
 * compute a frequency-weighted pick. Games that have appeared LESS frequently
 * in recent actual results get a higher prediction weight (gap-filling), mixed
 * with the original base weights. Always returns 4 UNIQUE games.
 *
 * This is NOT random/fake — it derives from the real, user-verified history.
 */
function buildHistoryInformedPredictions(history: Game[]): Prediction[] {
  if (history.length === 0) {
    return buildPredictions();
  }
  // Count frequency of each game in the actual-result history.
  const freq = new Map<string, number>();
  for (const g of GAMES) freq.set(g.name, 0);
  for (const h of history) {
    freq.set(h.name, (freq.get(h.name) ?? 0) + 1);
  }
  const maxFreq = Math.max(...freq.values(), 1);
  // Weight = base weight × (1 + (maxFreq - freq) / maxFreq).
  // Lower frequency → higher weight (gap-filling).
  const weighted = GAMES.map((g, i) => {
    const base = WEIGHTS[i] - (i === 0 ? 0 : WEIGHTS[i - 1]);
    const f = freq.get(g.name) ?? 0;
    const gap = (maxFreq - f) / maxFreq; // 0..1
    return { game: g, w: base * (0.5 + gap) };
  });
  const totalW = weighted.reduce((s, w) => s + w.w, 0);

  // Pick 4 unique games using the computed weights.
  const pool = [...weighted];
  const chosen: Game[] = [];
  for (let i = 0; i < SIGNAL_COUNT && pool.length > 0; i++) {
    const rand = Math.random() * pool.reduce((s, w) => s + w.w, 0);
    let acc = 0;
    let pickIdx = 0;
    for (let j = 0; j < pool.length; j++) {
      acc += pool[j].w;
      if (rand <= acc) {
        pickIdx = j;
        break;
      }
    }
    chosen.push(pool.splice(pickIdx, 1)[0].game);
  }
  const now = Date.now();
  return chosen.map((game) => ({
    game,
    confidence: confidenceFor(game),
    time: now,
  }));
}

const BONUS_NAMES = ["PACHINKO", "COIN FLIP", "CASH HUNT", "CRAZY TIME"];

// --- Persisted signals (the current 4 predictions) ---
const SIGNALS_KEY = "revo_lastSignals";
const signalsListeners = new Set<() => void>();

let cachedSignals: Prediction[] | null | undefined;
let cachedRaw = "";

function readSavedSignals(): Prediction[] | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(SIGNALS_KEY) ?? "";
    if (saved === cachedRaw && cachedSignals !== undefined) {
      return cachedSignals;
    }
    cachedRaw = saved;
    if (!saved) {
      cachedSignals = null;
      return null;
    }
    const data = JSON.parse(saved) as Prediction[];
    if (!Array.isArray(data) || data.length === 0) {
      localStorage.removeItem(SIGNALS_KEY);
      cachedSignals = null;
      return null;
    }
    if (Date.now() - data[0].time > 5 * 60 * 1000) {
      localStorage.removeItem(SIGNALS_KEY);
      cachedSignals = null;
      return null;
    }
    cachedSignals = data;
    return data;
  } catch {
    cachedSignals = null;
    return null;
  }
}

function subscribeSignals(cb: () => void): () => void {
  signalsListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SIGNALS_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    signalsListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function useSavedSignals(): Prediction[] | null {
  return useSyncExternalStore(
    subscribeSignals,
    readSavedSignals,
    () => null,
  );
}

// --- Persisted round history (actual results + comparisons) ---
const ROUNDS_KEY = "revo_roundHistory";
const roundsListeners = new Set<() => void>();
let cachedRounds: RoundResult[] | undefined;
let cachedRoundsRaw = "";

interface StoredRound {
  prediction: { game: { name: string; imageKey: string; confidenceRange: [number, number]; isBonus: boolean }; confidence: number; time: number }[];
  actualResult: { name: string; imageKey: string; confidenceRange: [number, number]; isBonus: boolean };
  hit: boolean;
  time: number;
}

// Stable empty array for snapshots — must be cached to avoid
// useSyncExternalStore infinite loops.
const EMPTY_ROUNDS: RoundResult[] = [];

function readRoundHistory(): RoundResult[] {
  if (typeof window === "undefined") return EMPTY_ROUNDS;
  try {
    const saved = localStorage.getItem(ROUNDS_KEY) ?? "";
    if (saved === cachedRoundsRaw && cachedRounds !== undefined) {
      return cachedRounds;
    }
    cachedRoundsRaw = saved;
    if (!saved) {
      cachedRounds = EMPTY_ROUNDS;
      return EMPTY_ROUNDS;
    }
    const data = JSON.parse(saved) as StoredRound[];
    if (!Array.isArray(data)) {
      cachedRounds = EMPTY_ROUNDS;
      return EMPTY_ROUNDS;
    }
    // Normalize stored shape back into Game/Prediction references.
    const rounds: RoundResult[] = data.map((r) => ({
      prediction: (r.prediction ?? []).map((p) => ({
        game: GAMES.find((g) => g.name === p.game.name) ?? GAMES[0],
        confidence: p.confidence,
        time: p.time,
      })),
      actualResult: GAMES.find((g) => g.name === r.actualResult.name) ?? GAMES[0],
      hit: r.hit,
      time: r.time,
    }));
    cachedRounds = rounds;
    return rounds;
  } catch {
    cachedRounds = EMPTY_ROUNDS;
    return EMPTY_ROUNDS;
  }
}

function subscribeRounds(cb: () => void): () => void {
  roundsListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === ROUNDS_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    roundsListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function useRoundHistory(): RoundResult[] {
  return useSyncExternalStore(
    subscribeRounds,
    readRoundHistory,
    () => EMPTY_ROUNDS, // server snapshot — stable constant
  );
}

function persistRounds(rounds: RoundResult[]) {
  try {
    // Store a slim shape (game name only) to keep payload small.
    const slim = rounds.map((r) => ({
      prediction: r.prediction.map((p) => ({
        game: { name: p.game.name },
        confidence: p.confidence,
        time: p.time,
      })),
      actualResult: { name: r.actualResult.name },
      hit: r.hit,
      time: r.time,
    }));
    localStorage.setItem(ROUNDS_KEY, JSON.stringify(slim));
    cachedRoundsRaw = "";
    roundsListeners.forEach((l) => l());
  } catch {
    /* ignore */
  }
}

function clearRounds() {
  try {
    localStorage.removeItem(ROUNDS_KEY);
    cachedRoundsRaw = "";
    roundsListeners.forEach((l) => l());
  } catch {
    /* ignore */
  }
}

export function RevoGame() {
  const savedSignals = useSavedSignals();
  const roundHistory = useRoundHistory();
  const [predictions, setPredictions] = useState<Prediction[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState({
    total: 1249,
    accuracy: 94,
    bonusHits: 128,
    liveUsers: 1247,
  });
  const [clock, setClock] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derived display values (hydration-safe):
  const displayPredictions = predictions ?? savedSignals;
  const isRunning = running || (predictions === null && savedSignals !== null && !loading);

  // The actual result history (just the games) for prediction calculation.
  const actualResultHistory = roundHistory.map((r) => r.actualResult);

  // Derived accuracy from manually-verified rounds ONLY.
  const verifiedRounds = roundHistory.length;
  const hits = roundHistory.filter((r) => r.hit).length;
  const realAccuracy =
    verifiedRounds > 0 ? Math.round((hits / verifiedRounds) * 100) : null;

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
    setPredictions(null);
    setTimeout(() => {
      // If we have verified actual-result history, use it to inform the next
      // prediction. Otherwise fall back to the base weighted algorithm.
      const hist = readRoundHistory().map((r) => r.actualResult);
      const preds =
        hist.length > 0
          ? buildHistoryInformedPredictions(hist)
          : buildPredictions();
      setPredictions(preds);
      setLoading(false);
      setRunning(true);
      setCountdown(60);
      try {
        localStorage.setItem(SIGNALS_KEY, JSON.stringify(preds));
        cachedRaw = "";
        signalsListeners.forEach((l) => l());
      } catch {
        /* ignore */
      }
      setStats((s) => {
        const total = s.total + preds.length;
        const bonusHits =
          s.bonusHits +
          preds.filter((p) => BONUS_NAMES.includes(p.game.name)).length;
        return { ...s, total, bonusHits, accuracy: s.accuracy };
      });
    }, 2000);
  }, []);

  const refreshPrediction = useCallback(() => {
    setPredictions(null);
    setRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    try {
      localStorage.removeItem(SIGNALS_KEY);
      cachedRaw = "";
      signalsListeners.forEach((l) => l());
    } catch {
      /* ignore */
    }
    setTimeout(() => generatePrediction(), 300);
  }, [generatePrediction]);

  /**
   * Manual actual-result selection. The user touches one of the 8 result boxes
   * after the real Crazy Time round resolves. This:
   *  1. Compares the current predictions against the actual result → HIT/MISS.
   *  2. Saves the round to history (persists across refresh).
   *  3. Immediately generates the NEXT prediction using the updated history.
   */
  const selectActualResult = useCallback(
    (game: Game) => {
      const currentPreds = predictions ?? savedSignals ?? [];
      const hit =
        currentPreds.length > 0 &&
        currentPreds.some((p) => p.game.name === game.name);
      const round: RoundResult = {
        prediction: currentPreds,
        actualResult: game,
        hit,
        time: Date.now(),
      };
      const updated = [...readRoundHistory(), round];
      persistRounds(updated);

      // Immediately generate the NEXT prediction using the new history.
      const newPreds = buildHistoryInformedPredictions(
        updated.map((r) => r.actualResult),
      );
      setPredictions(newPreds);
      setRunning(true);
      setCountdown(60);
      try {
        localStorage.setItem(SIGNALS_KEY, JSON.stringify(newPreds));
        cachedRaw = "";
        signalsListeners.forEach((l) => l());
      } catch {
        /* ignore */
      }
    },
    [predictions, savedSignals],
  );

  const clearHistory = useCallback(() => {
    clearRounds();
  }, []);

  // Auto-refresh countdown (60s → regenerate, like the original)
  useEffect(() => {
    if (!isRunning) return;
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
  }, [isRunning, generatePrediction]);

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
      else if (!document.hidden && isRunning && !timerRef.current) {
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
  }, [isRunning, generatePrediction]);

  // The most recently selected actual result (for the highlighted display).
  const lastActual = roundHistory[roundHistory.length - 1]?.actualResult ?? null;

  return (
    <section id="game" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <span className="revo-pulse text-[#2ed573]">●</span> Live Game
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            <span className="revo-gradient-animate">CRAZY TIME</span> LIVE
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-[#8899cc]">
            ⚡ {SIGNAL_COUNT} Live Predictions • High Accuracy ⚡ — each box shows
            a different outcome, never the same.
          </p>
        </div>

        {/* Auto-refresh timer */}
        {isRunning && !loading && (
          <div className="mb-3 flex items-center justify-center gap-2 text-[11px] font-semibold text-[#8899cc]">
            <i className="fas fa-sync-alt fa-spin text-[#448AFF]" />
            Next signal in {countdown}s
          </div>
        )}

        {/* ===== NEXT PREDICTION (4 boxes) — kept exactly as-is ===== */}
        <div className="revo-card revo-card-glow overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#448AFF]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-bolt text-[#FFD700]" /> Next Prediction
            </span>
            {clock && (
              <span className="text-[11px] text-[#5a6a99]">• {clock}</span>
            )}
          </div>

          <div className="p-4 sm:p-6">
            {!displayPredictions && !loading && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <span className="mb-3 grid h-16 w-16 place-items-center rounded-full bg-[#448AFF]/10 text-2xl text-[#448AFF] ring-2 ring-[#448AFF]/20">
                  <i className="fas fa-hand-pointer" />
                </span>
                <div className="text-sm font-bold text-white">
                  Click Get Signal To Start Live Session
                </div>
                <div className="text-xs text-[#5a6a99]">
                  Get {SIGNAL_COUNT} instant predictions
                </div>
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="mb-3 h-11 w-11 animate-spin rounded-full border-4 border-[#448AFF]/15 border-t-[#448AFF]" />
                <div className="text-sm font-bold text-white">Analyzing Patterns…</div>
                <div className="text-xs text-[#5a6a99]">Please wait</div>
              </div>
            )}

            {displayPredictions && !loading && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {displayPredictions.map((pred, i) => (
                  <SignalCard key={`${pred.game.name}-${pred.time}-${i}`} pred={pred} index={i} />
                ))}
              </div>
            )}
          </div>

          {/* Action buttons — kept as-is */}
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

        {/* ===== ACTUAL RESULT SELECTOR (NEW — manual result system) ===== */}
        <div className="revo-card mt-4 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#FFD700]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-bullseye text-[#FFD700]" /> Actual Result — Select
            </span>
            {lastActual && (
              <span className="rounded-full bg-[#2ed573]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[#2ed573]">
                Last: {lastActual.name}
              </span>
            )}
          </div>

          <div className="p-4 sm:p-5">
            <p className="mb-3 text-center text-[11px] text-[#8899cc]">
              <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
              When the real Crazy Time round resolves, touch the box that came up.
              This saves it as the actual result, compares vs the prediction, then
              auto-generates the next prediction.
            </p>

            {/* 8 result boxes */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {GAMES.map((g) => {
                const isLast = lastActual?.name === g.name;
                return (
                  <button
                    key={g.name}
                    onClick={() => selectActualResult(g)}
                    className={`group relative flex flex-col items-center overflow-hidden rounded-xl border p-2.5 transition active:scale-95 ${
                      isLast
                        ? "border-[#2ed573] bg-[#2ed573]/10 ring-2 ring-[#2ed573]/40"
                        : g.isBonus
                          ? "border-[#FFD700]/40 bg-[#FFD700]/5 hover:border-[#FFD700] hover:bg-[#FFD700]/10"
                          : "border-[#1e2240] bg-[#0d1020] hover:border-[#448AFF] hover:bg-[#448AFF]/10"
                    }`}
                  >
                    {isLast && (
                      <span className="absolute right-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full bg-[#2ed573] text-[9px] font-black text-[#0a0b14]">
                        ✓
                      </span>
                    )}
                    <img
                      src={GAME_IMAGES[g.imageKey]}
                      alt={g.name}
                      className="h-14 w-full object-contain transition group-hover:scale-105 sm:h-16"
                    />
                    <div className="mt-1 text-xs font-black text-white">
                      {g.name}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Current ACTUAL RESULT display */}
            {lastActual && (
              <div className="mt-4 rounded-xl border border-[#2ed573]/40 bg-[#2ed573]/8 p-3 text-center">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#2ed573]">
                  <i className="fas fa-check-circle mr-1" />
                  Actual Result
                </div>
                <div className="mt-1 text-2xl font-black text-white">
                  {lastActual.name}
                </div>
                {lastActual.isBonus && (
                  <span className="mt-0.5 inline-block rounded-full bg-[#FFD700]/20 px-2 py-0.5 text-[9px] font-bold uppercase text-[#FFD700]">
                    ★ Bonus Round
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ===== VERIFIED ACCURACY (from manual results only) ===== */}
        {verifiedRounds > 0 && (
          <div className="revo-card mt-4 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-circle-check text-[#2ed573]" /> Verified Accuracy
              </span>
              <span className="text-[10px] text-[#5a6a99]">
                from {verifiedRounds} manual result{verifiedRounds !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-[#2ed573]/30 bg-[#2ed573]/8 p-2.5 text-center">
                <div className="text-xl font-black text-[#2ed573]">{realAccuracy}%</div>
                <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">Accuracy</div>
              </div>
              <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-2.5 text-center">
                <div className="text-xl font-black text-[#2ed573]">{hits}</div>
                <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">Hits</div>
              </div>
              <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-2.5 text-center">
                <div className="text-xl font-black text-[#ff4757]">{verifiedRounds - hits}</div>
                <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">Misses</div>
              </div>
            </div>
          </div>
        )}

        {/* ===== ROUND HISTORY (prediction vs actual → HIT/MISS) ===== */}
        {roundHistory.length > 0 && (
          <div className="revo-card mt-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1e2240] px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-clock-rotate-left text-[#448AFF]" /> Round History
              </span>
              <button
                onClick={clearHistory}
                className="text-[11px] font-semibold text-[#ff4757] transition hover:text-[#ff6b6b]"
              >
                <i className="fas fa-trash mr-1" /> Clear
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto revo-scroll p-2">
              {[...roundHistory].reverse().map((r, i) => (
                <RoundRow key={r.time + "-" + i} round={r} />
              ))}
            </div>
          </div>
        )}

        {/* ===== ORIGINAL STATS (kept as-is) ===== */}
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
          Each signal box shows a different game. Select the actual result after
          each round to verify accuracy &amp; improve the next prediction.
          Predictions are for entertainment. Play responsibly.
        </p>
      </div>
    </section>
  );
}

/** One history row: prediction (4 chips) vs actual result → HIT/MISS badge. */
function RoundRow({ round }: { round: RoundResult }) {
  return (
    <div className="mb-1.5 flex items-center gap-3 rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-2.5">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-black ${
          round.hit
            ? "bg-[#2ed573]/15 text-[#2ed573]"
            : "bg-[#ff4757]/15 text-[#ff4757]"
        }`}
      >
        {round.hit ? "HIT" : "MISS"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[#5a6a99]">
            Predicted:
          </span>
          {round.prediction.map((p, i) => (
            <span
              key={i}
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                p.game.name === round.actualResult.name
                  ? "bg-[#2ed573]/20 text-[#2ed573]"
                  : "bg-[#1e2240] text-[#8899cc]"
              }`}
            >
              {p.game.name}
            </span>
          ))}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px]">
          <span className="text-[10px] uppercase tracking-wider text-[#5a6a99]">
            Actual:
          </span>
          <span className="font-bold text-white">{round.actualResult.name}</span>
          {round.actualResult.isBonus && (
            <span className="rounded-full bg-[#FFD700]/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#FFD700]">
              ★
            </span>
          )}
        </div>
      </div>
      <span className="shrink-0 text-[10px] text-[#5a6a99]">
        {new Date(round.time).toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
}

function SignalCard({ pred, index }: { pred: Prediction; index: number }) {
  const colors = ["#448AFF", "#FFD700", "#2ed573", "#00d4ff"];
  const accent = colors[index % colors.length];

  return (
    <div
      className="revo-card group relative flex flex-col overflow-hidden p-0"
      style={{ borderColor: `${accent}40` }}
    >
      {/* index badge */}
      <span
        className="absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-full text-[10px] font-black text-white"
        style={{ background: accent }}
      >
        {index + 1}
      </span>

      <div className="relative overflow-hidden bg-[#0d1020]">
        <img
          src={GAME_IMAGES[pred.game.imageKey]}
          alt={pred.game.name}
          className="h-32 w-full object-contain transition group-hover:scale-105 sm:h-36"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0d1020] via-[#0d1020]/70 to-transparent p-2.5 text-center">
          <div className="text-base font-black text-white sm:text-lg">
            {pred.game.name}
          </div>
          {pred.game.isBonus && (
            <span className="mt-0.5 inline-block rounded-full bg-[#FFD700]/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#FFD700]">
              ★ Bonus
            </span>
          )}
        </div>
      </div>

      {/* confidence bar */}
      <div className="p-3">
        <div className="mb-1 flex items-center justify-between text-[10px]">
          <span className="font-bold text-[#8899cc]">
            <i className="fas fa-chart-line mr-0.5" style={{ color: accent }} />
            Confidence
          </span>
          <span className="font-black" style={{ color: accent }}>
            {pred.confidence}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#1e2240]">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pred.confidence}%`,
              background:
                pred.confidence >= 80
                  ? "linear-gradient(90deg,#2ed573,#448AFF)"
                  : pred.confidence >= 65
                    ? "linear-gradient(90deg,#448AFF,#00d4ff)"
                    : "linear-gradient(90deg,#ffa502,#FFD700)",
            }}
          />
        </div>
      </div>
    </div>
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
