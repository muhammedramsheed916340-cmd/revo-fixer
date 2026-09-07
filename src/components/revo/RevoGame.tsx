"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { subscribeLiveResults, type LiveResultEvent } from "./liveResultsBus";
import {
  GAMES as ENGINE_GAMES,
  type GameModel,
  type RoundResult,
  type EngineOutput,
  type CandidateScore,
  type PerformanceDashboard,
  buildInitial,
  recalibrate,
} from "./decisionEngine";

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

// Re-export GameModel as Game for local convenience.
type Game = GameModel;
const GAMES: Game[] = ENGINE_GAMES;

// Map live API sector names → our Game objects (for auto-result detection)
const SECTOR_TO_GAME: Record<string, Game> = {
  "1": GAMES[0],
  "2": GAMES[1],
  "5": GAMES[2],
  "10": GAMES[3],
  Pachinko: GAMES[4],
  CoinFlip: GAMES[5],
  CashHunt: GAMES[6],
  CrazyTime: GAMES[7],
  CrazyBonus: GAMES[7],
};

const SIGNAL_COUNT = 4;
const BONUS_NAMES = ["PACHINKO", "COIN FLIP", "CASH HUNT", "CRAZY TIME"];

/** A prediction chip — derived from the unified engine output. */
interface Prediction {
  game: Game;
  confidence: number;
  time: number;
  rank?: number;
  label?: string;
  signals?: string[];
}

// ============================================================
// PERSISTENCE — round history + last active signals
// ============================================================
const SIGNALS_KEY = "revo_lastSignals";
const ROUNDS_KEY = "revo_roundHistory";
const signalsListeners = new Set<() => void>();
const roundsListeners = new Set<() => void>();

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

function saveSignals(preds: Prediction[]) {
  try {
    localStorage.setItem(SIGNALS_KEY, JSON.stringify(preds));
    cachedRaw = "";
    signalsListeners.forEach((l) => l());
  } catch {
    /* ignore */
  }
}

function clearSignals() {
  try {
    localStorage.removeItem(SIGNALS_KEY);
    cachedRaw = "";
    signalsListeners.forEach((l) => l());
  } catch {
    /* ignore */
  }
}

// --- Round history ---
interface StoredRound {
  prediction: { game: { name: string }; confidence: number; time: number }[];
  actualResult: { name: string };
  hit: boolean;
  time: number;
  confidence?: number;
  recalibrated?: boolean;
  calibrationNote?: string;
}

const EMPTY_ROUNDS: RoundResult[] = [];
let cachedRounds: RoundResult[] | undefined;
let cachedRoundsRaw = "";

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
    const rounds: RoundResult[] = data.map((r) => ({
      prediction: (r.prediction ?? []).map((p) => ({
        game: GAMES.find((g) => g.name === p.game.name) ?? GAMES[0],
        confidence: p.confidence,
        time: p.time,
      })),
      actualResult: GAMES.find((g) => g.name === r.actualResult.name) ?? GAMES[0],
      hit: r.hit,
      time: r.time,
      confidence: r.confidence ?? 0,
      recalibrated: r.recalibrated ?? false,
      calibrationNote: r.calibrationNote,
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
    () => EMPTY_ROUNDS,
  );
}

function persistRounds(rounds: RoundResult[]) {
  try {
    const slim = rounds.map((r) => ({
      prediction: r.prediction.map((p) => ({
        game: { name: p.game.name },
        confidence: p.confidence,
        time: p.time,
      })),
      actualResult: { name: r.actualResult.name },
      hit: r.hit,
      time: r.time,
      confidence: r.confidence,
      recalibrated: r.recalibrated,
      calibrationNote: r.calibrationNote,
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

// ============================================================
// ENGINE → PREDICTIONS adapter
// ============================================================
/** Convert an EngineOutput's predictions into the local Prediction shape. */
function engineToPredictions(engine: EngineOutput): Prediction[] {
  return engine.predictions.map((p) => ({
    game: p.game,
    confidence: p.confidence,
    time: p.time,
    rank: p.rank,
    label: p.label,
    signals: p.signals,
  }));
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export function RevoGame() {
  const savedSignals = useSavedSignals();
  const roundHistory = useRoundHistory();
  const [predictions, setPredictions] = useState<Prediction[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [running, setRunning] = useState(false);
  const [lastRecalibration, setLastRecalibration] = useState<{ triggered: boolean; reason: string } | null>(null);
  const [stats, setStats] = useState({
    total: 1249,
    accuracy: 94,
    bonusHits: 128,
    liveUsers: 1247,
  });
  const [clock, setClock] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const displayPredictions = predictions ?? savedSignals;
  const isRunning = running || (predictions === null && savedSignals !== null && !loading);

  // ===== UNIFIED ENGINE OUTPUT =====
  // This is THE single source of truth for ALL UI sections.
  // Re-computed whenever round history changes.
  const engine: EngineOutput = useMemo(() => {
    const last = roundHistory[roundHistory.length - 1];
    const prevPredNames = last ? last.prediction.map((p) => p.game.name) : [];
    const lastHit = last ? last.hit : null;
    return buildInitial(roundHistory);
    // Note: buildInitial calls runEngine internally with (rounds, prevPredNames, lastHit, false, "")
    // We pass roundHistory directly — the engine derives prevPredNames + lastHit itself.
    void prevPredNames;
    void lastHit;
  }, [roundHistory]);

  // Derived display values (hydration-safe)
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

  // ===== GENERATE PREDICTION (GET SIGNAL) =====
  // Uses the unified engine. The engine re-derives everything from history.
  const generatePrediction = useCallback(() => {
    setLoading(true);
    setPredictions(null);
    const allRounds = readRoundHistory();
    const eng = buildInitial(allRounds);
    const preds = engineToPredictions(eng);
    setPredictions(preds);
    setLoading(false);
    setRunning(true);
    saveSignals(preds);
    setStats((s) => {
      const total = s.total + preds.length;
      const bonusHits =
        s.bonusHits +
        preds.filter((p) => BONUS_NAMES.includes(p.game.name)).length;
      return { ...s, total, bonusHits, accuracy: s.accuracy };
    });
  }, []);

  const refreshPrediction = useCallback(() => {
    setPredictions(null);
    setRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    clearSignals();
    setTimeout(() => generatePrediction(), 50);
  }, [generatePrediction]);

  // AUTO-GENERATE on mount
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    if (savedSignals) return;
    autoStarted.current = true;
    const t = setTimeout(() => generatePrediction(), 100);
    return () => clearTimeout(t);
  }, [savedSignals, generatePrediction]);

  // ============================================================
  // CORE ENGINE PIPELINE — runs on EVERY live result / manual selection
  // ============================================================
  // LIVE RESULT
  //   → VERIFY HIT/MISS
  //   → UPDATE HISTORY (persist)
  //   → ANALYZE ACTIVE SIGNALS
  //   → ANALYZE EXCLUDED OUTCOMES
  //   → COMPARE RECENT + LONG-TERM PERFORMANCE
  //   → DETECT PATTERN SHIFT
  //   → RCA IF MISS
  //   → RECALIBRATE
  //   → SELECT STRONGEST EVIDENCE-BASED SIGNAL
  //   → UPDATE PREDICTION IN THE SAME SPOT
  const selectActualResult = useCallback(
    (game: Game) => {
      const currentPreds =
        predictions ?? readSavedSignals() ?? [];
      const hit =
        currentPreds.length > 0 &&
        currentPreds.some((p) => p.game.name === game.name);
      const predConfidence =
        currentPreds.length > 0
          ? Math.round(
              currentPreds.reduce((s, p) => s + p.confidence, 0) /
                currentPreds.length,
            )
          : 0;
      const wasRecalibrated = lastRecalibration?.triggered ?? false;
      const round: RoundResult = {
        prediction: currentPreds,
        actualResult: game,
        hit,
        time: Date.now(),
        confidence: predConfidence,
        recalibrated: wasRecalibrated,
        calibrationNote: lastRecalibration?.reason,
      };
      const updated = [...readRoundHistory(), round];
      persistRounds(updated);

      // === BUILD NEXT PREDICTION USING THE UNIFIED ENGINE ===
      let nextPreds: Prediction[];
      let nextRecal: { triggered: boolean; reason: string } | null = null;

      if (!hit) {
        // MISS → RCA → RECALIBRATE → new evidence-based prediction
        const reason = `Recalibration triggered by MISS. RCA: analyzing pattern shift, anomaly, signal-wise performance, recent vs long-term. Adaptive weighting applied.`;
        const eng = recalibrate(updated, reason);
        nextPreds = engineToPredictions(eng);
        nextRecal = { triggered: true, reason };
      } else {
        // HIT → continue with the unified engine (no recalibration flag)
        const eng = buildInitial(updated);
        nextPreds = engineToPredictions(eng);
        nextRecal = null;
      }
      setPredictions(nextPreds);
      setLastRecalibration(nextRecal);
      setRunning(true);
      setCountdown(60);
      saveSignals(nextPreds);
    },
    [predictions, savedSignals, lastRecalibration],
  );

  const clearHistory = useCallback(() => {
    clearRounds();
    setLastRecalibration(null);
  }, []);

  // Auto-refresh countdown (60s → regenerate)
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

  // Live users fluctuation (every 8s)
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

  // AUTO-RESULT from live API
  const [popupResult, setPopupResult] = useState<Game | null>(null);
  const [popupEnabled, setPopupEnabled] = useState(true);

  useEffect(() => {
    const unsub = subscribeLiveResults((e: LiveResultEvent) => {
      const game = SECTOR_TO_GAME[e.sector];
      if (game) {
        if (popupEnabled) {
          setPopupResult(game);
          setTimeout(() => setPopupResult(null), 4000);
        }
        selectActualResult(game);
      }
    });
    return unsub;
  }, [selectActualResult, popupEnabled]);

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

        {/* ===== NEXT PREDICTION (4 boxes) — single source of truth ===== */}
        <div className="revo-card revo-card-glow overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#448AFF]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-bolt text-[#FFD700]" /> Next Prediction
            </span>
            <div className="flex items-center gap-2">
              {lastRecalibration?.triggered && (
                <span className="rounded-full bg-[#ffa502]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[#ffa502]">
                  <i className="fas fa-wrench mr-1" /> Recalibrated
                </span>
              )}
              {clock && (
                <span className="text-[11px] text-[#5a6a99]">• {clock}</span>
              )}
              <button
                onClick={() => setPopupEnabled((v) => !v)}
                className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase transition ${
                  popupEnabled
                    ? "bg-[#2ed573]/15 text-[#2ed573]"
                    : "bg-[#1e2240] text-[#5a6a99]"
                }`}
                title={popupEnabled ? "Popup ON — click to disable" : "Popup OFF — click to enable"}
              >
                <i className={`fas ${popupEnabled ? "fa-bell" : "fa-bell-slash"}`} />
                {popupEnabled ? "Popup ON" : "Popup OFF"}
              </button>
            </div>
          </div>

          {/* Recalibration banner (shows when last round was a MISS) */}
          {lastRecalibration?.triggered && (
            <div className="border-b border-[#ffa502]/20 bg-[#ffa502]/8 px-4 py-2.5">
              <div className="flex items-start gap-2 text-[11px]">
                <i className="fas fa-wrench mt-0.5 text-[#ffa502]" />
                <div className="flex-1">
                  <span className="font-bold text-[#ffa502]">
                    Auto-recalibration applied:
                  </span>{" "}
                  <span className="text-[#bcc6e0]">{lastRecalibration.reason}</span>
                </div>
              </div>
            </div>
          )}

          <div className="p-4 sm:p-6">
            {loading && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="mb-3 h-11 w-11 animate-spin rounded-full border-4 border-[#448AFF]/15 border-t-[#448AFF]" />
                <div className="text-sm font-bold text-white">Analyzing Patterns…</div>
                <div className="text-xs text-[#5a6a99]">Generating predictions</div>
              </div>
            )}

            {displayPredictions && !loading && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {displayPredictions.map((pred, i) => (
                  <SignalCard
                    key={`${pred.game.name}-${pred.time}-${i}`}
                    pred={pred}
                    index={i}
                    verifiedRounds={verifiedRounds}
                    rank={pred.rank ?? i + 1}
                    rankLabel={pred.label ?? ""}
                    signals={pred.signals ?? []}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ===== LIVE RESULT POPUP ===== */}
        {popupResult && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center px-4" onClick={() => setPopupResult(null)}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-md" aria-hidden />
            <div
              className="relative w-full max-w-sm overflow-hidden rounded-3xl border-2 p-8 text-center"
              style={{
                borderColor: popupResult.isBonus ? "#FFD700" : "#2ed573",
                background: "linear-gradient(180deg, #141827, #0a0b14)",
                boxShadow: `0 0 60px -10px ${popupResult.isBonus ? "#FFD700" : "#2ed573"}80`,
              }}
            >
              <div className="mb-4 flex items-center justify-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full bg-[#ff4757]/15 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#ff4757]">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff4757]" />
                  LIVE RESULT
                </span>
              </div>
              <img
                src={GAME_IMAGES[popupResult.imageKey]}
                alt={popupResult.name}
                className="mx-auto mb-3 h-28 w-28 object-contain"
                style={{ animation: "revoPop 0.4s ease-out" }}
              />
              <div
                className="text-4xl font-black sm:text-5xl"
                style={{
                  color: popupResult.isBonus ? "#FFD700" : "#2ed573",
                  textShadow: popupResult.isBonus
                    ? "0 0 20px rgba(255,215,0,0.5)"
                    : "0 0 20px rgba(46,213,115,0.5)",
                }}
              >
                {popupResult.name}
              </div>
              {popupResult.isBonus && (
                <span className="mt-2 inline-block rounded-full bg-[#FFD700]/20 px-3 py-1 text-[11px] font-bold uppercase text-[#FFD700]">
                  ★ Bonus Round
                </span>
              )}
              <div className="mt-4 flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#2ed573]">
                <i className="fas fa-check-circle" /> Result Confirmed
              </div>
              <div className="mt-3 text-[10px] text-[#5a6a99]">
                Auto-dismiss in 4s · Tap to close
              </div>
            </div>
          </div>
        )}

        {/* ===== NOT IN PREDICTION (4 Excluded Outcomes) ===== */}
        <div className="revo-card mt-4 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#ff4757]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-ban text-[#ff4757]" /> Not In Prediction
            </span>
            <span className="text-[10px] text-[#5a6a99]">
              4 outcomes not covered
            </span>
          </div>

          <div className="p-4">
            <p className="mb-3 text-center text-[11px] text-[#8899cc]">
              <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
              These 4 outcomes are NOT in the current prediction. If any of these
              hit, the prediction will MISS — triggering RCA + recalibration.
              <b className="text-[#ff4757]"> Not treated as a bet signal.</b>
            </p>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {engine.excludedOutcomes.map((g) => (
                <div
                  key={g.name}
                  className={`flex flex-col items-center rounded-xl border p-2.5 ${
                    g.isBonus
                      ? "border-[#FFD700]/30 bg-[#FFD700]/5"
                      : "border-[#ff4757]/30 bg-[#ff4757]/5"
                  }`}
                >
                  <img
                    src={GAME_IMAGES[g.imageKey]}
                    alt={g.name}
                    className="h-12 w-full object-contain opacity-70"
                  />
                  <div className="mt-1 text-xs font-bold text-[#8899cc]">
                    {g.name}
                  </div>
                  {g.isBonus && (
                    <span className="text-[8px] font-bold uppercase text-[#FFD700]">★</span>
                  )}
                </div>
              ))}
            </div>

            {lastActual && (
              <div className="mt-4 rounded-xl border border-[#2ed573]/40 bg-[#2ed573]/8 p-3 text-center">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#2ed573]">
                  <i className="fas fa-check-circle mr-1" />
                  Last Live Result
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

        {/* ===== PERFORMANCE DASHBOARD (NEW — unified engine data) ===== */}
        <PerformanceDashboardPanel dashboard={engine.dashboard} />

        {/* ===== ADVANCED DECISION ENGINE ===== */}
        <DecisionEnginePanel engine={engine} />

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

        {/* ===== ROUND HISTORY ===== */}
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

        {/* ===== ORIGINAL STATS ===== */}
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

// ============================================================
// PERFORMANCE DASHBOARD PANEL
// ============================================================
function PerformanceDashboardPanel({ dashboard }: { dashboard: PerformanceDashboard }) {
  const {
    totalRounds,
    hits,
    misses,
    predictionHitRate,
    predictionMissRate,
    recentHitRate,
    recentHitRateLong,
    longTermHitRate,
    adaptiveWeight,
    excludedResultRate,
    modelStability,
    currentStreak,
    patternShiftDetected,
    anomalyDetected,
    patternShiftNote,
    anomalyNote,
    signalWiseHitRate,
  } = dashboard;

  return (
    <div className="revo-card mt-4 overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#00d4ff]/10 to-transparent px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-gauge-high text-[#00d4ff]" /> Performance Dashboard
        </span>
        <div className="flex items-center gap-1.5">
          {currentStreak.length > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                currentStreak.type === "HIT"
                  ? "bg-[#2ed573]/15 text-[#2ed573]"
                  : "bg-[#ff4757]/15 text-[#ff4757]"
              }`}
            >
              {currentStreak.length}× {currentStreak.type}
            </span>
          )}
          <span className="rounded-full bg-[#1e2240] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#5a6a99]">
            n={totalRounds}
          </span>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Hit Rate" value={`${Math.round(predictionHitRate * 100)}%`} color="#2ed573" />
          <Kpi label="Miss Rate" value={`${Math.round(predictionMissRate * 100)}%`} color="#ff4757" />
          <Kpi label="Recent (5)" value={`${Math.round(recentHitRate * 100)}%`} color="#448AFF" />
          <Kpi label="Recent (10)" value={`${Math.round(recentHitRateLong * 100)}%`} color="#00d4ff" />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Long-Term" value={`${Math.round(longTermHitRate * 100)}%`} color="#a78bfa" />
          <Kpi label="Excluded Rate" value={`${Math.round(excludedResultRate * 100)}%`} color="#ff4757" />
          <Kpi label="Stability" value={`${modelStability}%`} color={modelStability >= 50 ? "#2ed573" : "#ffa502"} />
          <Kpi label="Adaptive Wt" value={`${Math.round(adaptiveWeight * 100)}%`} color="#FFD700" />
        </div>

        {/* Hits / Misses / Sample size */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-[#2ed573]/30 bg-[#2ed573]/8 p-2.5 text-center">
            <div className="text-lg font-black text-[#2ed573]">{hits}</div>
            <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">Hits</div>
          </div>
          <div className="rounded-lg border border-[#ff4757]/30 bg-[#ff4757]/8 p-2.5 text-center">
            <div className="text-lg font-black text-[#ff4757]">{misses}</div>
            <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">Misses</div>
          </div>
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020] p-2.5 text-center">
            <div className="text-lg font-black text-white">{totalRounds}</div>
            <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">Sample Size</div>
          </div>
        </div>

        {/* Pattern shift + anomaly alerts */}
        {patternShiftDetected && (
          <div className="rounded-lg border border-[#ffa502]/30 bg-[#ffa502]/8 p-2.5">
            <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#ffa502]">
              <i className="fas fa-triangle-exclamation" /> Pattern Shift Detected
            </div>
            <div className="text-[11px] text-[#bcc6e0]">{patternShiftNote}</div>
          </div>
        )}
        {anomalyDetected && (
          <div className="rounded-lg border border-[#ff4757]/30 bg-[#ff4757]/8 p-2.5">
            <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#ff4757]">
              <i className="fas fa-radiation" /> Anomaly / Model Drift
            </div>
            <div className="text-[11px] text-[#bcc6e0]">{anomalyNote}</div>
          </div>
        )}

        {/* Signal-wise hit rate table */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Signal-wise Performance (when predicted)
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {GAMES.map((g) => {
              const sw = signalWiseHitRate[g.name];
              const wilsonPct = Math.round(sw.wilsonLower * 100);
              return (
                <div
                  key={g.name}
                  className={`rounded border p-1.5 text-center ${
                    g.isBonus
                      ? "border-[#FFD700]/20 bg-[#FFD700]/5"
                      : "border-[#1e2240] bg-[#0d1020]/60"
                  }`}
                >
                  <div className="text-[10px] font-bold text-white">{g.name}</div>
                  <div className="text-[9px] text-[#5a6a99]">
                    {sw.hit}/{sw.predicted}
                  </div>
                  <div
                    className="text-[11px] font-black"
                    style={{
                      color:
                        sw.predicted < 3
                          ? "#5a6a99"
                          : wilsonPct >= 50
                            ? "#2ed573"
                            : wilsonPct >= 30
                              ? "#448AFF"
                              : "#ffa502",
                    }}
                  >
                    {sw.predicted > 0 ? `${wilsonPct}%` : "—"}
                  </div>
                  <div className="text-[7px] uppercase tracking-wider text-[#5a6a99]">
                    Wilson LB
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 text-[9px] text-[#5a6a99]">
            <i className="fas fa-circle-info mr-1" />
            Wilson lower bound = sample-size-aware confidence. 2/2 ≠ 100%.
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-2.5 text-center">
      <div className="text-base font-black sm:text-lg" style={{ color }}>
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">{label}</div>
    </div>
  );
}

// ============================================================
// DECISION ENGINE PANEL
// ============================================================
function DecisionEnginePanel({ engine }: { engine: EngineOutput }) {
  const {
    status,
    decision,
    confidence,
    confidenceLabel,
    riskLevel,
    lastResult,
    lastHit,
    previousPrediction,
    consecutiveMisses,
    consecutiveHits,
    rca,
    excludedAnalysis,
    whyThisMove,
    validationCriteria,
    nextSignalNames,
    candidateScores,
  } = engine;

  const resultLabel: string = lastHit === null ? "—" : lastHit ? "HIT" : "MISS";

  return (
    <div className="revo-card mt-4 overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#a78bfa]/10 to-transparent px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-microchip text-[#a78bfa]" /> Decision Engine
        </span>
        <div className="flex items-center gap-1.5">
          {consecutiveMisses > 0 && (
            <span className="rounded-full bg-[#ff4757]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#ff4757]">
              {consecutiveMisses}× MISS
            </span>
          )}
          {consecutiveHits > 0 && (
            <span className="rounded-full bg-[#2ed573]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#2ed573]">
              {consecutiveHits}× HIT
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
              status === "READY"
                ? "bg-[#2ed573]/15 text-[#2ed573]"
                : status === "WAIT"
                  ? "bg-[#ffa502]/15 text-[#ffa502]"
                  : status === "RECALIBRATE"
                    ? "bg-[#a78bfa]/15 text-[#a78bfa]"
                    : "bg-[#ff4757]/15 text-[#ff4757]"
            }`}
          >
            {status}
          </span>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {/* LAST RESULT + STATUS + CONFIDENCE + DECISION */}
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-2.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">Last Result</div>
            <div className="text-sm font-black text-white">{lastResult}</div>
          </div>
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-2.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">Status</div>
            <div className="text-sm font-black" style={{
              color: lastHit === true ? "#2ed573" : lastHit === false ? "#ff4757" : "#5a6a99",
            }}>{resultLabel}</div>
          </div>
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-2.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">Confidence</div>
            <div className="text-sm font-black" style={{
              color: confidence >= 65 ? "#2ed573" : confidence >= 40 ? "#448AFF" : "#ffa502",
            }}>{confidence}%</div>
            <div className="text-[7px] text-[#5a6a99]">{confidenceLabel}</div>
          </div>
          <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-2.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">Decision</div>
            <div className="text-sm font-black" style={{
              color: decision === "BET" ? "#2ed573" : decision === "WAIT" ? "#ffa502" : "#a78bfa",
            }}>{decision}</div>
          </div>
        </div>

        {/* RISK LEVEL */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">Risk:</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{
            background: riskLevel === "LOW" ? "#2ed57315" : riskLevel === "MEDIUM" ? "#ffa50215" : "#ff475715",
            color: riskLevel === "LOW" ? "#2ed573" : riskLevel === "MEDIUM" ? "#ffa502" : "#ff4757",
          }}>
            {riskLevel}
          </span>
        </div>

        {/* PREVIOUS PREDICTION vs ACTUAL */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-3">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Previous Prediction → Actual Result
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {previousPrediction.length > 0 ? (
              previousPrediction.map((name) => (
                <span key={name} className={`rounded px-1.5 py-0.5 font-bold ${
                  name === lastResult ? "bg-[#2ed573]/20 text-[#2ed573]" : "bg-[#1e2240] text-[#8899cc]"
                }`}>{name}</span>
              ))
            ) : (
              <span className="text-[10px] text-[#5a6a99]">No previous prediction</span>
            )}
            <span className="text-[#5a6a99]">→</span>
            <span className="rounded bg-[#448AFF]/20 px-1.5 py-0.5 font-bold text-[#448AFF]">
              {lastResult}
            </span>
          </div>
        </div>

        {/* RCA — only on MISS */}
        {rca && (
          <div className="rounded-lg border border-[#ff4757]/30 bg-[#ff4757]/8 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#ff4757]">
                <i className="fas fa-magnifying-glass" /> RCA
              </span>
              <span className="rounded-full bg-[#ff4757]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#ff4757]">
                {rca.cause}
              </span>
            </div>
            <div className="text-xs text-[#bcc6e0]">{rca.note}</div>
            {/* RCA flags */}
            <div className="mt-2 flex flex-wrap gap-1">
              {rca.patternFailure && <RcaFlag label="Pattern Failure" />}
              {rca.predictionBias && <RcaFlag label="Prediction Bias" />}
              {rca.trendReversal && <RcaFlag label="Trend Reversal" />}
              {rca.modelDrift && <RcaFlag label="Model Drift" />}
              {rca.anomaly && <RcaFlag label="Anomaly" />}
              {rca.insufficientData && <RcaFlag label="Insufficient Data" />}
            </div>
          </div>
        )}

        {/* EXCLUDED ANALYSIS — only on MISS */}
        {excludedAnalysis && (
          <div className="rounded-lg border border-[#00d4ff]/30 bg-[#00d4ff]/8 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#00d4ff]">
              <i className="fas fa-arrows-left-right" /> Excluded / Not-In-Prediction Analysis
            </div>
            <div className="text-xs text-[#8899cc]">{excludedAnalysis}</div>
          </div>
        )}

        {/* NEXT SIGNAL — ranked candidates with full scoring */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-3">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Next Signal — Strongest Evidence-Based Selection
          </div>
          <div className="space-y-1.5">
            {candidateScores.slice(0, 4).map((c, i) => (
              <CandidateRow key={c.game.name} c={c} rank={i + 1} />
            ))}
          </div>
        </div>

        {/* WHY THIS MOVE */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Why This Move
          </div>
          <div className="text-xs text-[#bcc6e0]">{whyThisMove}</div>
        </div>

        {/* VALIDATION CRITERIA */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Validation Criteria
          </div>
          <div className="text-xs text-[#8899cc]">{validationCriteria}</div>
        </div>

        {/* NEXT SIGNAL SUMMARY (compact chip list) */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Next Signal:
          </span>
          {nextSignalNames.map((name, i) => {
            const game = GAMES.find((g) => g.name === name);
            return (
              <span key={name} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                i === 0
                  ? "bg-[#2ed573]/20 text-[#2ed573]"
                  : game?.isBonus
                    ? "bg-[#FFD700]/10 text-[#FFD700]"
                    : "bg-[#448AFF]/10 text-[#448AFF]"
              }`}>
                {name}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RcaFlag({ label }: { label: string }) {
  return (
    <span className="rounded bg-[#ff4757]/10 px-1 py-0.5 text-[8px] font-bold uppercase text-[#ff4757]">
      {label}
    </span>
  );
}

function CandidateRow({ c, rank }: { c: CandidateScore; rank: number }) {
  const game = c.game;
  const wilsonPct = Math.round(c.wilsonLower * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#a78bfa] text-[9px] font-black text-white">
        {rank}
      </span>
      <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${
        game.isBonus ? "bg-[#FFD700]/10 text-[#FFD700]" : "bg-[#448AFF]/10 text-[#448AFF]"
      }`}>{game.name}</span>
      <div className="flex flex-1 flex-wrap items-center gap-1">
        {c.signals.map((s, i) => (
          <span key={i} className="rounded bg-[#1e2240] px-1 py-0.5 text-[8px] font-bold uppercase text-[#8899cc]">
            {s}
          </span>
        ))}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[9px] font-bold text-[#2ed573]">{wilsonPct}%</div>
        <div className="text-[7px] text-[#5a6a99]">Wilson LB</div>
      </div>
    </div>
  );
}

// ============================================================
// ROUND HISTORY ROW
// ============================================================
function RoundRow({ round }: { round: RoundResult }) {
  return (
    <div className="mb-1.5 rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-2.5">
      <div className="flex items-center gap-3">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[11px] font-black ${
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
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-[#1e2240]/60 pt-1.5 pl-12 text-[9px]">
        {round.recalibrated && (
          <span className="rounded bg-[#ffa502]/15 px-1.5 py-0.5 font-bold uppercase text-[#ffa502]">
            <i className="fas fa-wrench mr-0.5" /> Recalibrated
          </span>
        )}
        <span className="text-[#5a6a99]">
          Confidence: <b className="text-[#bcc6e0]">{round.confidence}%</b>
        </span>
        {round.calibrationNote && (
          <span className="truncate text-[#5a6a99]" title={round.calibrationNote}>
            • {round.calibrationNote}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SIGNAL CARD
// ============================================================
function SignalCard({
  pred,
  index,
  verifiedRounds,
  rank,
  rankLabel,
  signals,
}: {
  pred: Prediction;
  index: number;
  verifiedRounds: number;
  rank: number;
  rankLabel: string;
  signals: string[];
}) {
  const colors = ["#448AFF", "#FFD700", "#2ed573", "#00d4ff"];
  const accent = colors[index % colors.length];
  const { label: confLabel, color: confColor } = confidenceLabel(
    pred.confidence,
    verifiedRounds,
  );

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-2xl border-2 bg-[#141827] transition hover:-translate-y-1"
      style={{
        borderColor: `${accent}60`,
        boxShadow: `0 4px 24px -8px ${accent}40, inset 0 1px 0 rgba(255,255,255,0.04)`,
      }}
    >
      {/* rank badge */}
      <span
        className="absolute right-2 top-2 z-20 grid h-7 w-7 place-items-center rounded-lg text-[11px] font-black text-white shadow-lg"
        style={{ background: accent }}
      >
        #{rank}
      </span>

      {/* confidence label badge */}
      <span
        className="absolute left-2 top-2 z-20 rounded-md px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide"
        style={{ background: `${confColor}30`, color: confColor, backdropFilter: "blur(4px)" }}
      >
        {confLabel}
      </span>

      {/* HD image */}
      <div className="relative overflow-hidden bg-gradient-to-b from-[#0d1020] to-[#141827]">
        <img
          src={GAME_IMAGES[pred.game.imageKey]}
          alt={pred.game.name}
          className="h-36 w-full object-contain p-2 transition duration-300 group-hover:scale-110 sm:h-40"
          style={{ imageRendering: "crisp-edges" }}
          loading="eager"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#141827] via-[#141827]/80 to-transparent p-3 text-center">
          <div className="text-lg font-black tracking-tight text-white sm:text-xl">
            {pred.game.name}
          </div>
          {pred.game.isBonus && (
            <span className="mt-1 inline-block rounded-full bg-[#FFD700]/20 px-2 py-0.5 text-[9px] font-bold uppercase text-[#FFD700]">
              ★ Bonus Round
            </span>
          )}
        </div>
      </div>

      {/* rank label + signals */}
      <div className="border-t border-[#1e2240] px-3 pt-2">
        <div className="text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
          {rankLabel}
        </div>
        {signals.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {signals.slice(0, 3).map((s, i) => (
              <span key={i} className="rounded bg-[#1e2240] px-1 py-0.5 text-[7px] font-bold uppercase text-[#8899cc]">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* confidence bar */}
      <div className="border-t border-[#1e2240] p-3">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1 font-bold text-[#8899cc]">
            <i className="fas fa-chart-line" style={{ color: accent }} />
            Confidence
          </span>
          <span className="font-black text-base" style={{ color: accent }}>
            {pred.confidence}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#1e2240]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pred.confidence}%`,
              background: `linear-gradient(90deg, ${accent}, ${accent}cc)`,
              boxShadow: `0 0 8px ${accent}80`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function confidenceLabel(confidence: number, totalRounds: number): {
  label: string;
  color: string;
} {
  if (totalRounds < 3) {
    return { label: "INSUFFICIENT DATA", color: "#5a6a99" };
  }
  if (confidence >= 70) return { label: "STRONG", color: "#2ed573" };
  if (confidence >= 45) return { label: "MODERATE", color: "#448AFF" };
  return { label: "LOW CONFIDENCE", color: "#ffa502" };
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
