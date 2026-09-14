"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { subscribeLiveResults, isResultProcessed, type LiveResultEvent } from "./liveResultsBus";
import { getLiveSpins, subscribeLiveSpins } from "./liveSpinStore";
import {
  GAMES as ENGINE_GAMES,
  type GameModel,
  type RoundResult,
  type EngineOutput,
  type CandidateScore,
  type PerformanceDashboard,
  type EngineMode,
  type FeatureFlags,
  type FrozenWalkForwardResult,
  type LockedRcaRecord,
  WHEEL_SEGMENTS,
  WHEEL_TOTAL_SEGMENTS,
  THEORETICAL,
  EXPERIMENTAL_CONFIG,
  ALL_FLAGS_OFF,
  MODEL_VERSION,
  buildInitial,
  recalibrate,
  runRetrospectiveDiagnostic,
  runFrozenWalkForward,
  type RetroDiagnostic,
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
const EMPTY_SPINS: import("./aiStats").SpinData[] = [];
let cachedRounds: RoundResult[] | undefined;
let cachedRoundsRaw = "";

// Module-level store for the experimental engine's currently-LOCKED prediction
// data (names + coverage + all 8 calibrated probs) at generation time, so it's
// available at settlement time. Written by generatePrediction +
// selectActualResult, read at settlement time. Not reactive.
interface LockedEngineData {
  names: string[];
  coverage: number;
  probs: Record<string, number>;
}
let baselineLockedData: LockedEngineData = { names: [], coverage: 0, probs: {} };
let expLockedData: LockedEngineData = { names: [], coverage: 0, probs: {} };

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
// SHADOW A/B LEDGER — baseline vs experimental on the SAME rounds
// ============================================================
// Each live round is settled TWICE in parallel:
//   - baseline prediction (frozen k=30, the active displayed prediction)
//   - experimental prediction (k=30 + rare-outcome reliability layer)
// Both are computed from the SAME pre-result history → no data leakage.
// The ledger persists across reloads so a 50-round A/B accumulates live.
const SHADOW_KEY = "revo_shadowLedger";
const EXP_FLAG_KEY = "revo_experimentalFlag";

interface ShadowRow {
  roundId: number;              // prediction ID (synchronized between both models)
  ts: number;                   // timestamp
  actual: string;               // actual result name
  baselinePreds: string[];     // old locked baseline Top-4
  baselineHit: boolean;
  baselineCoverage: number;     // expected coverage = sum of 4 selected calibrated probs
  baselineProbs: Record<string, number>; // all 8 calibrated probabilities
  expPreds: string[];           // old locked experimental Top-4
  expHit: boolean;
  expCoverage: number;
  expProbs: Record<string, number>;
  theoHit: boolean;             // theoretical [1,2,5,10] baseline HIT?
}

const EMPTY_SHADOW: ShadowRow[] = [];
let cachedShadow: ShadowRow[] | undefined;
let cachedShadowRaw = "";

function readShadowLedger(): ShadowRow[] {
  if (typeof window === "undefined") return EMPTY_SHADOW;
  try {
    const raw = localStorage.getItem(SHADOW_KEY) ?? "";
    if (raw === cachedShadowRaw && cachedShadow !== undefined) {
      return cachedShadow;
    }
    cachedShadowRaw = raw;
    if (!raw) {
      cachedShadow = EMPTY_SHADOW;
      return EMPTY_SHADOW;
    }
    const data = JSON.parse(raw);
    cachedShadow = Array.isArray(data) ? (data as ShadowRow[]) : EMPTY_SHADOW;
    return cachedShadow;
  } catch {
    cachedShadow = EMPTY_SHADOW;
    return EMPTY_SHADOW;
  }
}

function writeShadowLedger(rows: ShadowRow[]) {
  try {
    localStorage.setItem(SHADOW_KEY, JSON.stringify(rows.slice(-200)));
  } catch {
    /* ignore */
  }
  cachedShadowRaw = ""; // invalidate cache
  notifyShadowListeners();
}

function clearShadowLedger() {
  try {
    localStorage.removeItem(SHADOW_KEY);
    cachedShadowRaw = ""; // invalidate cache
    notifyShadowListeners();
  } catch {
    /* ignore */
  }
}

function readExpFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(EXP_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function writeExpFlag(on: boolean) {
  try {
    localStorage.setItem(EXP_FLAG_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// Subscribers for the feature flag (useSyncExternalStore pattern).
const expFlagListeners = new Set<() => void>();
function subscribeExpFlag(cb: () => void): () => void {
  expFlagListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === EXP_FLAG_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    expFlagListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

// ============================================================
// C1–C7 EXPERIMENTAL FEATURE FLAGS — bit-for-bit OFF by default
// ============================================================
// Mirrors the EXP_FLAG_KEY pattern above. Stored as a single JSON blob
// under `revo_cFlags`. The server snapshot is ALWAYS ALL_FLAGS_OFF so the
// active displayed prediction (baseline path) is bit-for-bit identical to
// production. These flags ONLY thread into the EXPERIMENTAL shadow engine
// calls (4 sites) — never the live baseline `buildInitial(roundHistory, liveSpins)`.
const CFLAGS_KEY = "revo_cFlags";

/** Stable server snapshot — always ALL_FLAGS_OFF (never reads localStorage). */
const EMPTY_CFLAGS: FeatureFlags = ALL_FLAGS_OFF;

// Cached client snapshot — useSyncExternalStore requires getSnapshot to return
// a referentially STABLE value when the underlying data has not changed, or it
// loops infinitely ("Maximum update depth exceeded"). We cache the parsed
// object and invalidate it on write / storage event (mirrors readShadowLedger).
let cachedCFlags: FeatureFlags | undefined;
let cachedCFlagsRaw = "";

function readCFlags(): FeatureFlags {
  if (typeof window === "undefined") return ALL_FLAGS_OFF;
  try {
    const raw = localStorage.getItem(CFLAGS_KEY) ?? "";
    // Return the cached reference when the raw string is unchanged → stable
    // snapshot for useSyncExternalStore (prevents the infinite-render loop).
    if (raw === cachedCFlagsRaw && cachedCFlags !== undefined) {
      return cachedCFlags;
    }
    cachedCFlagsRaw = raw;
    if (!raw) {
      cachedCFlags = ALL_FLAGS_OFF;
      return cachedCFlags;
    }
    const parsed = JSON.parse(raw) as Partial<FeatureFlags> | null;
    if (!parsed || typeof parsed !== "object") {
      cachedCFlags = ALL_FLAGS_OFF;
      return cachedCFlags;
    }
    // Merge over ALL_FLAGS_OFF so any missing key defaults to false.
    cachedCFlags = {
      c1_calibratedChannel: !!parsed.c1_calibratedChannel,
      c2_genericReliability: !!parsed.c2_genericReliability,
      c3_uncertaintyShrinkage: !!parsed.c3_uncertaintyShrinkage,
      c4_realOptimizer: !!parsed.c4_realOptimizer,
      c5_deScopeHarmful: !!parsed.c5_deScopeHarmful,
      c6_rcaInstrumentation: !!parsed.c6_rcaInstrumentation,
      c7_frozenWalkForward: !!parsed.c7_frozenWalkForward,
      c8_credibleLowerBound: !!parsed.c8_credibleLowerBound,
      c9_recencyExcludeLast: !!parsed.c9_recencyExcludeLast,
    };
    return cachedCFlags;
  } catch {
    cachedCFlags = ALL_FLAGS_OFF;
    return cachedCFlags;
  }
}

function writeCFlags(flags: FeatureFlags) {
  try {
    localStorage.setItem(CFLAGS_KEY, JSON.stringify(flags));
  } catch {
    /* ignore */
  }
  cachedCFlagsRaw = ""; // invalidate cache so the next read picks up the new value
  cFlagListeners.forEach((l) => l());
}

// Subscribers for the C-flags store (useSyncExternalStore pattern).
const cFlagListeners = new Set<() => void>();
function subscribeCFlags(cb: () => void): () => void {
  cFlagListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === CFLAGS_KEY) {
      cachedCFlagsRaw = ""; // invalidate on cross-tab changes
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    cFlagListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

// Display metadata for the 9 C-flags (order = C1..C9). Pure data, no closures.
const FLAG_META: Array<{ key: keyof FeatureFlags; desc: string }> = [
  { key: "c1_calibratedChannel", desc: "True Bayesian posterior probability channel" },
  { key: "c2_genericReliability", desc: "Generic sample-size reliability (decoupled from mode)" },
  { key: "c3_uncertaintyShrinkage", desc: "Uncertainty-aware shrinkage toward prior" },
  { key: "c4_realOptimizer", desc: "Real 70-combination optimizer (coverage+uncertainty+reliability+diversity)" },
  { key: "c5_deScopeHarmful", desc: "De-scope raw-recent overwrites + reliability-gate persistence" },
  { key: "c6_rcaInstrumentation", desc: "Per-locked-Top-4 RCA record for post-MISS reconstruction" },
  { key: "c7_frozenWalkForward", desc: "Frozen walk-forward validation harness (build path)" },
  { key: "c8_credibleLowerBound", desc: "Bayesian 95% credible lower-bound coverage (generic, z=1.96)" },
  { key: "c9_recencyExcludeLast", desc: "Signal recency window excludes just-arrived actual (anti-chase)" },
];

// Subscribers for the shadow ledger.
const shadowListeners = new Set<() => void>();
function subscribeShadow(cb: () => void): () => void {
  shadowListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SHADOW_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    shadowListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function notifyShadowListeners() {
  shadowListeners.forEach((l) => l());
}

// ============================================================
// VALIDATION START TIMESTAMP — when "START FRESH VALIDATION" was pressed
// ============================================================
const VALIDATION_START_KEY = "revo_validationStart";
const validationStartListeners = new Set<() => void>();

function readValidationStart(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VALIDATION_START_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeValidationStart(ts: number) {
  try {
    localStorage.setItem(VALIDATION_START_KEY, String(ts));
  } catch {
    /* ignore */
  }
  validationStartListeners.forEach((l) => l());
}

function clearValidationStart() {
  try {
    localStorage.removeItem(VALIDATION_START_KEY);
  } catch {
    /* ignore */
  }
  validationStartListeners.forEach((l) => l());
}

function subscribeValidationStart(cb: () => void): () => void {
  validationStartListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === VALIDATION_START_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    validationStartListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

// Representative synthetic 50-round sequence matching the reported fresh
// k=30 validation marginals (PACHINKO=3, ~78% theoretical coverage).
// Used ONLY by the retrospective diagnostic to estimate direction when
// live accumulated rounds are sparse. Clearly labeled as SIMULATION.
const SYNTHETIC_50: string[] = [
  "1", "2", "1", "5", "2", "1", "10", "2", "1", "COIN FLIP",
  "1", "2", "5", "1", "2", "1", "PACHINKO", "2", "1", "5",
  "10", "1", "2", "1", "COIN FLIP", "5", "2", "1", "1", "2",
  "1", "5", "10", "2", "1", "CASH HUNT", "2", "1", "5", "1",
  "2", "1", "PACHINKO", "5", "2", "1", "10", "2", "1", "PACHINKO",
];

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

/** Extract per-engine locked data (Top-4 names + coverage + all 8 calibrated
 *  probabilities) at generation time, so it's available at settlement time. */
function extractEngineData(eng: EngineOutput): LockedEngineData {
  const names = eng.predictions.map((p) => p.game.name);
  const probs: Record<string, number> = {};
  for (const c of eng.candidateScores) {
    const cp = (c as CandidateScore & { calibratedProbability?: number }).calibratedProbability;
    probs[c.game.name] = cp ?? 0;
  }
  const coverage = names.reduce((s, n) => s + (probs[n] ?? 0), 0);
  return { names, coverage, probs };
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export function RevoGame() {
  const savedSignals = useSavedSignals();
  const roundHistory = useRoundHistory();
  const [predictions, setPredictions] = useState<Prediction[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRecalibration, setLastRecalibration] = useState<{ triggered: boolean; reason: string } | null>(null);
  // NOTE: NO countdown, NO auto-refresh. Prediction is LOCKED until the next
  // live result arrives (per user spec — LIVE AUTO mode, no manual intervention).
  // Hydration guard — `savedSignals`/`roundHistory` come from localStorage which
  // is null on the server but non-null on the client after mount. Rendering
  // prediction-derived UI before mount causes hydration mismatches.
  // Uses useSyncExternalStore (server snapshot = false, client = true after subscribe)
  // which is the lint-safe pattern for mount detection.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [stats, setStats] = useState({
    total: 1249,
    accuracy: 94,
    bonusHits: 128,
    liveUsers: 1247,
  });
  const [clock, setClock] = useState("");
  const liveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Gate prediction-derived UI by `mounted` to avoid SSR hydration mismatch
  // (localStorage is null on server but non-null on client after mount).
  const displayPredictions = mounted ? (predictions ?? savedSignals) : null;
  const isRunning = running || (predictions === null && savedSignals !== null && !loading);

  // ===== REAL CASINO SPINS (from CasinoScores API, shared via liveSpinStore) =====
  // RevoLiveResults writes the latest 30 real spins here. We subscribe so the
  // engine re-derives predictions whenever fresh real casino data arrives.
  const liveSpins = useSyncExternalStore(
    subscribeLiveSpins,
    getLiveSpins,
    () => EMPTY_SPINS, // server snapshot — stable empty constant
  );

  // ===== UNIFIED ENGINE OUTPUT =====
  // This is THE single source of truth for ALL UI sections.
  // Re-computed whenever round history OR live casino spins change.
  // Passes REAL casino spins to the engine so predictions are data-driven
  // (not always [1,2,5,10]) and varied via weighted probabilistic sampling.
  const engine: EngineOutput = useMemo(() => {
    return buildInitial(roundHistory, liveSpins);
  }, [roundHistory, liveSpins]);

  // ===== STABLE PREDICTION VIEW =====
  // The engine re-samples every time liveSpins changes (every 4s poll). But
  // per the stability rule, the prediction cards must NOT change until the
  // next live result arrives. So we derive the prediction-derived fields
  // (predictions, excludedOutcomes, nextSignalNames, excludedNames) from the
  // STABLE displayPredictions (state/localStorage), while using the engine's
  // live analysis (dashboard, candidateScores, RCA, confidence, decision).
  const view: EngineOutput = useMemo(() => {
    const active = displayPredictions ?? engine.predictions.map((p) => ({
      game: p.game,
      confidence: p.confidence,
      time: p.time,
    }));
    const activeNames = active.map((p) => p.game.name);
    const excludedGames = ENGINE_GAMES.filter((g) => !activeNames.includes(g.name));
    return {
      ...engine,
      // Stable prediction-derived fields (from displayPredictions):
      nextSignalNames: activeNames,
      excludedOutcomes: excludedGames,
      excludedNames: excludedGames.map((g) => g.name),
      // Keep engine's analysis fields (dashboard, candidateScores, RCA, etc.)
    };
  }, [engine, displayPredictions]);

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

  // ===== C1–C7 EXPERIMENTAL FEATURE FLAGS (shadow engine only) =====
  // Declared here (before generatePrediction) because generatePrediction and
  // selectActualResult thread `cFlags` into their experimental shadow builds.
  // Server snapshot = ALL_FLAGS_OFF (bit-for-bit baseline). These flags ONLY
  // thread into the 4 experimental shadow buildInitial/recalibrate calls —
  // NEVER the live baseline `buildInitial(roundHistory, liveSpins)`.
  const cFlags: FeatureFlags = useSyncExternalStore(
    subscribeCFlags,
    readCFlags,
    () => EMPTY_CFLAGS, // server snapshot — stable constant
  );

  const toggleCFlag = useCallback((key: keyof FeatureFlags) => {
    const current = readCFlags();
    const next: FeatureFlags = { ...current, [key]: !current[key] };
    writeCFlags(next);
    cFlagListeners.forEach((l) => l());
  }, []);

  // ===== C7 FROZEN WALK-FORWARD RESULT (build path only — NOT a validation claim) =====
  const [fwfResult, setFwfResult] = useState<FrozenWalkForwardResult | null>(null);

  const runFwf = useCallback(() => {
    const allRounds = readRoundHistory();
    const actualNames = allRounds.map((r) => r.actualResult.name);
    const spins = getLiveSpins();
    setFwfResult(runFrozenWalkForward(actualNames, cFlags, spins));
  }, [cFlags]);

  // ===== GENERATE PREDICTION (initial only — NO auto-refresh) =====
  // Prediction is LOCKED once generated. It only changes when a new LIVE
  // result arrives (via selectActualResult). No countdown, no refresh,
  // no manual intervention — pure LIVE AUTO mode.
  const generatePrediction = useCallback(() => {
    setLoading(true);
    setPredictions(null);
    const allRounds = readRoundHistory();
    const spins = getLiveSpins();
    const eng = buildInitial(allRounds, spins);
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
    // SHADOW: capture the baseline engine's full locked data (names + coverage
    // + all 8 calibrated probs) so it's available at settlement time.
    baselineLockedData = extractEngineData(eng);
    // Seed the experimental engine's locked prediction too (same history).
    // C-flags threaded in here (shadow only — baseline path stays untouched).
    const expEng = buildInitial(allRounds, spins, "experimental", cFlags);
    expLockedData = extractEngineData(expEng);
  }, [cFlags]);

  // AUTO-GENERATE on mount ONLY (no countdown refresh)
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    if (savedSignals) return;
    autoStarted.current = true;
    const t = setTimeout(() => generatePrediction(), 100);
    return () => clearTimeout(t);
  }, [savedSignals, generatePrediction]);

  // Event debug log — proves the exact pipeline order for each live result
  const [eventLog, setEventLog] = useState<Array<{
    eventId: number;
    actual: string;
    oldPrediction: string[];
    hitMiss: string;
    historyNBefore: number;
    historyNAfter: number;
    newPrediction: string[];
    predictionId: number;
    locked: boolean;
    timestamp: number;
  }>>([]);

  // ===== SHADOW A/B: baseline vs experimental on the SAME live rounds =====
  // experimentalEnabled is a FEATURE FLAG. When ON, the experimental engine
  // (k=30 + rare-outcome reliability layer) ALSO runs in shadow — its
  // prediction is locked at the same moment as baseline, settled against
  // the same actual, and recorded in `shadowLedger`. The ACTIVE displayed
  // prediction remains the frozen k=30 baseline (unchanged behavior).
  const experimentalEnabled = useSyncExternalStore(
    subscribeExpFlag,
    readExpFlag,
    () => false, // server snapshot
  );
  const shadowLedger = useSyncExternalStore(
    subscribeShadow,
    readShadowLedger,
    () => EMPTY_SHADOW, // server snapshot — stable constant
  );
  // Retrospective diagnostic result (computed on demand).
  const [retroResult, setRetroResult] = useState<RetroDiagnostic | null>(null);
  const [retroSource, setRetroSource] = useState<"live" | "synthetic" | null>(null);

  const toggleExperimental = useCallback(() => {
    const next = !readExpFlag();
    writeExpFlag(next);
    expFlagListeners.forEach((l) => l());
    // When enabling, seed the experimental locked prediction from the
    // current baseline locked data so the shadow has a starting point.
    if (next) {
      expLockedData = {
        names: [...baselineLockedData.names],
        coverage: baselineLockedData.coverage,
        probs: { ...baselineLockedData.probs },
      };
    }
  }, []);

  // ===== C6 LOCKED RCA (experimental shadow engine's lockedRca, build-path only) =====
  // Mirrored from the latest experimental engine build via a state so the
  // viewer can render winningCombination / excludedFifth / optimizerNote
  // when c6_rcaInstrumentation is ON and the shadow engine is enabled.
  // NOTE: `cFlags` is declared above (before generatePrediction) because
  // generatePrediction threads it into the experimental shadow build call.
  const [expLockedRca, setExpLockedRca] = useState<LockedRcaRecord | null>(null);
  useEffect(() => {
    if (!experimentalEnabled || !cFlags.c6_rcaInstrumentation) {
      setExpLockedRca(null);
      return;
    }
    // Rebuild the experimental engine (build path only) purely to surface
    // its lockedRca field for the viewer. This does NOT affect the live or
    // shadow settlement lifecycle — it's a read-only display rebuild.
    const allRounds = readRoundHistory();
    const spins = getLiveSpins();
    const eng = buildInitial(allRounds, spins, "experimental", cFlags);
    setExpLockedRca(eng.lockedRca ?? null);
  }, [experimentalEnabled, cFlags, roundHistory, liveSpins]);

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
      // If there's no active prediction, don't record an unfair MISS.
      // Wait for the prediction to be generated first.
      if (currentPreds.length === 0) {
        // Generate a prediction immediately so the next round has something
        // to compare against. Don't record this round.
        const allRounds = readRoundHistory();
        const spins = getLiveSpins();
        const eng = buildInitial(allRounds, spins);
        const preds = engineToPredictions(eng);
        setPredictions(preds);
        setRunning(true);
        saveSignals(preds);
        // SHADOW: capture baseline locked data + seed experimental.
        baselineLockedData = extractEngineData(eng);
        const expEng0 = buildInitial(allRounds, spins, "experimental", cFlags);
        expLockedData = extractEngineData(expEng0);
        return;
      }

      // ===== PIPELINE AUDIT: log exact event order =====
      const historyBefore = readRoundHistory();
      const historyNBefore = historyBefore.length;
      const oldPredNames = currentPreds.map((p) => p.game.name);

      // STEP 1: SETTLE OLD LOCKED PREDICTION (before history update)
      // `currentPreds` is what was actually displayed; `baselineLockedData`
      // is the engine's locked data captured at generation time (names +
      // coverage + all 8 calibrated probs). They should be in sync.
      const hit = currentPreds.some((p) => p.game.name === game.name);
      // SHADOW: settle the experimental locked prediction against the SAME
      // actual result (both computed from the same pre-result history).
      // `expLockedData` is the module-level mirror of the experimental
      // engine's currently-locked prediction data.
      const expHit = experimentalEnabled && expLockedData.names.length > 0
        ? expLockedData.names.includes(game.name)
        : false;
      // Theoretical [1,2,5,10] baseline HIT? — fixed reference benchmark.
      const theoHit = ["1", "2", "5", "10"].includes(game.name);
      const predConfidence =
        Math.round(
          currentPreds.reduce((s, p) => s + p.confidence, 0) /
            currentPreds.length,
        );
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

      // STEP 2: APPEND NEW RESULT TO HISTORY
      const updated = [...historyBefore, round];
      persistRounds(updated);
      const historyNAfter = updated.length;

      // STEP 3: RECALCULATE ALL 8 OUTCOMES USING UPDATED HISTORY
      const spins = getLiveSpins();
      let nextPreds: Prediction[];
      let nextRecal: { triggered: boolean; reason: string } | null = null;
      // Hoist baselineEng so we can extract its locked data AFTER the
      // ShadowRow (which uses the OLD locked data) has been built.
      let baselineEng: EngineOutput;
      if (!hit) {
        const reason = `Recalibration triggered by MISS. Fresh ranking: analyzed repeat-pattern, trend, stability, Bayesian, Wilson LB, signal correlation. No automatic carryover — every outcome re-scored from scratch.`;
        baselineEng = recalibrate(updated, reason, spins);
        nextPreds = engineToPredictions(baselineEng);
        nextRecal = { triggered: true, reason };
      } else {
        baselineEng = buildInitial(updated, spins);
        nextPreds = engineToPredictions(baselineEng);
        nextRecal = null;
      }

      const newPredNames = nextPreds.map((p) => p.game.name);

      // STEP 4: LOG EVENT DEBUG TABLE
      const eventId = historyNAfter;
      setEventLog((prev) => {
        const next = [{
          eventId,
          actual: game.name,
          oldPrediction: oldPredNames,
          hitMiss: hit ? "HIT" : "MISS",
          historyNBefore,
          historyNAfter,
          newPrediction: newPredNames,
          predictionId: eventId + 1,
          locked: true,
          timestamp: Date.now(),
        }, ...prev];
        return next.slice(0, 20); // keep last 20 events
      });

      // STEP 5: DISPLAY + LOCK NEW PREDICTION
      setPredictions(nextPreds);
      setLastRecalibration(nextRecal);
      setRunning(true);
      saveSignals(nextPreds);

      // ===== STEP 6: SHADOW A/B — settle + regenerate experimental =====
      // Build the ShadowRow using the OLD locked data (the prediction that
      // was actually settled against this actual), then regenerate the
      // experimental locked prediction from the updated history so it's
      // ready for the NEXT live result. The baseline locked data is updated
      // from the hoisted `baselineEng` AFTER the row is built.
      if (experimentalEnabled) {
        // Build the full ShadowRow using OLD locked data (settlement source-of-truth).
        const row: ShadowRow = {
          roundId: historyNAfter,
          ts: Date.now(),
          actual: game.name,
          baselinePreds: [...baselineLockedData.names],
          baselineHit: hit,
          baselineCoverage: baselineLockedData.coverage,
          baselineProbs: { ...baselineLockedData.probs },
          expPreds: [...expLockedData.names],
          expHit,
          expCoverage: expLockedData.coverage,
          expProbs: { ...expLockedData.probs },
          theoHit,
        };
        // Append to shadow ledger (useSyncExternalStore notifies subscribers).
        const prevLedger = readShadowLedger();
        writeShadowLedger([...prevLedger, row].slice(-200));

        // Regenerate experimental for the NEXT round (uses updated history).
        // C-flags threaded in here (shadow only — baseline path untouched).
        const expEng = !hit
          ? recalibrate(updated, "Shadow recalibration (experimental mode)", spins, "experimental", cFlags)
          : buildInitial(updated, spins, "experimental", cFlags);
        expLockedData = extractEngineData(expEng);
      }

      // Update baseline locked data from the NEW baseline engine output so
      // the next settlement has access to it. (Hoisted baselineEng above.)
      baselineLockedData = extractEngineData(baselineEng);
    },
    [predictions, savedSignals, lastRecalibration, experimentalEnabled, cFlags],
  );

  const clearHistory = useCallback(() => {
    clearRounds();
    setLastRecalibration(null);
  }, []);

  // ===== SHADOW A/B STATS — baseline vs experimental on the SAME rounds =====
  const shadowStats = useMemo(() => {
    const rows = shadowLedger;
    const total = rows.length;
    const bHits = rows.filter((r) => r.baselineHit).length;
    const eHits = rows.filter((r) => r.expHit).length;
    const bMisses = total - bHits;
    const eMisses = total - eHits;
    const flipsToHit = rows.filter((r) => !r.baselineHit && r.expHit).length;
    const flipsToMiss = rows.filter((r) => r.baselineHit && !r.expHit).length;

    // ===== Normal vs Bonus breakdown =====
    // Normal results = actual is in [1,2,5,10]; Bonus = otherwise.
    const bNormalRows = rows.filter((r) => ["1", "2", "5", "10"].includes(r.actual));
    const bBonusRows = rows.filter((r) => !["1", "2", "5", "10"].includes(r.actual));
    const bNormalHits = bNormalRows.filter((r) => r.baselineHit).length;
    const bNormalTotal = bNormalRows.length;
    const eNormalHits = bNormalRows.filter((r) => r.expHit).length;
    const eNormalTotal = bNormalRows.length; // same actuals → same denominator
    const bBonusHits = bBonusRows.filter((r) => r.baselineHit).length;
    const bBonusTotal = bBonusRows.length;
    const eBonusHits = bBonusRows.filter((r) => r.expHit).length;
    const eBonusTotal = bBonusRows.length;

    // ===== Per-outcome inclusion rates + actuals =====
    const perOutcome: Record<string, {
      baseInc: number; expInc: number; actuals: number;
      baseRate: number; expRate: number;
    }> = {};
    for (const g of ENGINE_GAMES) {
      perOutcome[g.name] = { baseInc: 0, expInc: 0, actuals: 0, baseRate: 0, expRate: 0 };
    }
    for (const r of rows) {
      for (const n of r.baselinePreds) if (perOutcome[n]) perOutcome[n].baseInc++;
      for (const n of r.expPreds) if (perOutcome[n]) perOutcome[n].expInc++;
      if (perOutcome[r.actual]) perOutcome[r.actual].actuals++;
    }
    for (const g of ENGINE_GAMES) {
      perOutcome[g.name].baseRate = total > 0 ? perOutcome[g.name].baseInc / total : 0;
      perOutcome[g.name].expRate = total > 0 ? perOutcome[g.name].expInc / total : 0;
    }

    // ===== 1/2/5/10 exclusion rates (fraction of rounds each was excluded) =====
    const exclusionRates: Record<string, { base: number; exp: number }> = {};
    for (const num of ["1", "2", "5", "10"]) {
      const baseExcl = rows.filter((r) => !r.baselinePreds.includes(num)).length;
      const expExcl = rows.filter((r) => !r.expPreds.includes(num)).length;
      exclusionRates[num] = {
        base: total > 0 ? baseExcl / total : 0,
        exp: total > 0 ? expExcl / total : 0,
      };
    }

    // ===== Theoretical [1,2,5,10] baseline =====
    const theoHits = rows.filter((r) => r.theoHit).length;
    const theoRate = total > 0 ? theoHits / total : 0;

    // ===== Stale runs (3+ consecutive rounds where the SAME Top-4 set was used) =====
    // Compare sorted prediction arrays between consecutive rows.
    const sortKey = (names: string[]) => [...names].sort().join("|");
    let bStaleRuns = 0;
    let eStaleRuns = 0;
    if (rows.length >= 3) {
      // Baseline stale runs
      let runLen = 1;
      for (let i = 1; i < rows.length; i++) {
        if (sortKey(rows[i].baselinePreds) === sortKey(rows[i - 1].baselinePreds)) {
          runLen++;
        } else {
          if (runLen >= 3) bStaleRuns++;
          runLen = 1;
        }
      }
      if (runLen >= 3) bStaleRuns++;
      // Experimental stale runs
      runLen = 1;
      for (let i = 1; i < rows.length; i++) {
        if (sortKey(rows[i].expPreds) === sortKey(rows[i - 1].expPreds)) {
          runLen++;
        } else {
          if (runLen >= 3) eStaleRuns++;
          runLen = 1;
        }
      }
      if (runLen >= 3) eStaleRuns++;
    }

    // ===== Prediction changes (Top-4 set differs from previous round) =====
    let bPredChanges = 0;
    let ePredChanges = 0;
    for (let i = 1; i < rows.length; i++) {
      if (sortKey(rows[i].baselinePreds) !== sortKey(rows[i - 1].baselinePreds)) bPredChanges++;
      if (sortKey(rows[i].expPreds) !== sortKey(rows[i - 1].expPreds)) ePredChanges++;
    }

    // ===== Avg expected coverage (sum of 4 selected calibrated probs per round) =====
    const bAvgCoverage = total > 0
      ? rows.reduce((s, r) => s + (r.baselineCoverage ?? 0), 0) / total
      : 0;
    const eAvgCoverage = total > 0
      ? rows.reduce((s, r) => s + (r.expCoverage ?? 0), 0) / total
      : 0;

    // ===== MISS RCA flips (rounds where one model hit and the other missed) =====
    const flips: Array<{
      roundId: number;
      actual: string;
      type: "MISS_TO_HIT" | "HIT_TO_MISS";
      bPreds: string[];
      ePreds: string[];
      rca: string;
    }> = [];
    const NUMBER_NAMES = ["1", "2", "5", "10"];
    for (const r of rows) {
      if (!r.baselineHit && r.expHit) {
        // MISS_TO_HIT (baseline missed, experimental hit)
        const baseBonusOnly = r.baselinePreds.filter((n) => BONUS_NAMES.includes(n));
        const bonusBaselineHad = baseBonusOnly.filter((n) => !r.expPreds.includes(n));
        const numExpAdded = r.expPreds.filter((n) => NUMBER_NAMES.includes(n) && !r.baselinePreds.includes(n));
        let rca: string;
        if (bonusBaselineHad.length > 0) {
          rca = `rare-outcome displacement correction: baseline included ${bonusBaselineHad.join(",")} which displaced a number`;
        } else if (numExpAdded.length > 0) {
          rca = `number restored: experimental included ${numExpAdded.join(",")} which baseline excluded`;
        } else {
          rca = "better combination selection";
        }
        flips.push({
          roundId: r.roundId,
          actual: r.actual,
          type: "MISS_TO_HIT",
          bPreds: [...r.baselinePreds],
          ePreds: [...r.expPreds],
          rca,
        });
      } else if (r.baselineHit && !r.expHit) {
        // HIT_TO_MISS (baseline hit, experimental missed)
        const bonusBaselineHad = r.baselinePreds.filter((n) => BONUS_NAMES.includes(n));
        const bonusExpDropped = bonusBaselineHad.filter((n) => !r.expPreds.includes(n));
        const numExpDifferent = r.expPreds.filter((n) => NUMBER_NAMES.includes(n) && !r.baselinePreds.includes(n));
        let rca: string;
        if (bonusExpDropped.length > 0) {
          rca = `reliability layer dampened ${bonusExpDropped.join(",")} evidence below selection threshold`;
        } else if (numExpDifferent.length > 0) {
          rca = `reliability layer shifted combination: experimental swapped in ${numExpDifferent.join(",")} for ${r.baselinePreds.filter((n) => !r.expPreds.includes(n)).join(",")}`;
        } else {
          rca = "combination changed by reliability adjustment";
        }
        flips.push({
          roundId: r.roundId,
          actual: r.actual,
          type: "HIT_TO_MISS",
          bPreds: [...r.baselinePreds],
          ePreds: [...r.expPreds],
          rca,
        });
      }
    }

    return {
      total, bHits, eHits, bMisses, eMisses,
      bRate: total > 0 ? bHits / total : 0,
      eRate: total > 0 ? eHits / total : 0,
      delta: total > 0 ? (eHits - bHits) / total : 0,
      flipsToHit, flipsToMiss,
      // Normal vs bonus breakdown
      bNormalHits, bNormalTotal,
      bNormalRate: bNormalTotal > 0 ? bNormalHits / bNormalTotal : 0,
      eNormalHits, eNormalTotal,
      eNormalRate: eNormalTotal > 0 ? eNormalHits / eNormalTotal : 0,
      bBonusHits, bBonusTotal,
      bBonusRate: bBonusTotal > 0 ? bBonusHits / bBonusTotal : 0,
      eBonusHits, eBonusTotal,
      eBonusRate: eBonusTotal > 0 ? eBonusHits / eBonusTotal : 0,
      // Per-outcome inclusion rates
      perOutcome,
      // Theoretical [1,2,5,10] baseline
      theoHits, theoRate,
      // Stale runs + prediction changes
      bStaleRuns, eStaleRuns,
      bPredChanges, ePredChanges,
      // Avg expected coverage
      bAvgCoverage, eAvgCoverage,
      // MISS RCA flips list
      flips,
      // 1/2/5/10 exclusion rates (legacy field kept for back-compat)
      exclusionRates,
    };
  }, [shadowLedger]);

  // ===== VALIDATION START TIMESTAMP (useSyncExternalStore — hydration-safe) =====
  const validationStartedAt = useSyncExternalStore(
    subscribeValidationStart,
    readValidationStart,
    () => null, // server snapshot
  );

  // ===== START FRESH VALIDATION handler =====
  // Clears the shadow ledger, enables the experimental engine, sets the
  // validation start timestamp, and seeds both locked data stores fresh
  // from the current history + spins so the next live result starts a
  // clean A/B comparison.
  const startFreshValidation = useCallback(() => {
    // 1) Clear the shadow ledger.
    clearShadowLedger();
    // 2) Enable the experimental engine.
    writeExpFlag(true);
    expFlagListeners.forEach((l) => l());
    // 3) Set the validation start timestamp.
    writeValidationStart(Date.now());
    // 4) Seed both locked data stores fresh from current history + spins.
    const allRounds = readRoundHistory();
    const spins = getLiveSpins();
    const baseEng = buildInitial(allRounds, spins);
    baselineLockedData = extractEngineData(baseEng);
    const expEng = buildInitial(allRounds, spins, "experimental");
    expLockedData = extractEngineData(expEng);
  }, []);

  const clearValidationStartTs = useCallback(() => {
    clearValidationStart();
  }, []);

  // ===== RETROSPECTIVE DIAGNOSTIC handlers =====
  const runRetroLive = useCallback(() => {
    const names = roundHistory.map((r) => r.actualResult.name);
    const spins = getLiveSpins();
    setRetroResult(runRetrospectiveDiagnostic(names, spins));
    setRetroSource("live");
  }, [roundHistory]);

  const runRetroSynthetic = useCallback(() => {
    const spins = getLiveSpins();
    setRetroResult(runRetrospectiveDiagnostic(SYNTHETIC_50, spins));
    setRetroSource("synthetic");
  }, []);

  const clearShadow = useCallback(() => {
    clearShadowLedger();
  }, []);

  // NOTE: NO auto-refresh countdown. Prediction is LOCKED until next live result.
  // The only thing that regenerates the prediction is selectActualResult()
  // (called automatically when a new live result arrives via liveResultsBus).

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

  // NOTE: NO visibility-change auto-refresh. Prediction is LOCKED regardless
  // of tab visibility — it only changes on new live result.

  // AUTO-RESULT from live API + LATENCY TRACKING
  const [popupResult, setPopupResult] = useState<Game | null>(null);
  const [popupEnabled, setPopupEnabled] = useState(true);
  // Latency tracking for debug performance panel
  const [latencyStats, setLatencyStats] = useState<{
    lastEventTime: number;
    sourceTime: number | null;       // actual settledAt from casino API
    appReceivedTime: number | null;   // when app received the event
    sourceToApp: number | null;       // sourceTime → appReceived (detection delay)
    appToUI: number;                   // appReceived → UI displayed
    appToPrediction: number;           // appReceived → new prediction generated
    totalSourceToUI: number | null;    // sourceTime → UI displayed
    totalSourceToPrediction: number | null; // sourceTime → new prediction
    sector: string;
    resultCount: number;
    duplicateCount: number;
  } | null>(null);
  const latencyHistoryRef = useRef<{ sourceToApp: number; totalToUI: number; totalToPred: number }[]>([]);
  const [latencyAvg, setLatencyAvg] = useState<{ avgSrcToApp: number | null; minSrcToApp: number | null; maxSrcToApp: number | null; p95SrcToApp: number | null; avgAppToUI: number; avgAppToPred: number; minAppToUI: number; maxAppToUI: number; minAppToPred: number; maxAppToPred: number }>({
    avgSrcToApp: null, minSrcToApp: null, maxSrcToApp: null, p95SrcToApp: null, avgAppToUI: 0, avgAppToPred: 0, minAppToUI: 0, maxAppToUI: 0, minAppToPred: 0, maxAppToPred: 0,
  });
  const staleCountRef = useRef(0);
  const duplicateCountRef = useRef(0);
  // Secondary dedup guard: Set of all processed result keys
  const processedResultKeysRef = useRef<Set<string>>(new Set());
  const [eventStats, setEventStats] = useState({ stale: 0, duplicate: 0, dropped: 0, total: 0 });

  useEffect(() => {
    const unsub = subscribeLiveResults((e: LiveResultEvent) => {
      // ===== SECONDARY DEDUP GUARD =====
      // Even though broadcastLiveResult already deduplicates, we add a
      // secondary check here to be absolutely certain the same result
      // never triggers the popup or selectActualResult twice.
      // This prevents duplicate popups from React batched renders or
      // concurrent polling cycles.
      const resultKey = `${e.sector}-${e.time}`;
      if (processedResultKeysRef.current.has(resultKey)) {
        duplicateCountRef.current++;
        setEventStats((prev) => ({ ...prev, duplicate: prev.duplicate + 1 }));
        return; // Already processed — skip completely
      }
      processedResultKeysRef.current.add(resultKey);
      // Keep only last 50 keys
      if (processedResultKeysRef.current.size > 50) {
        const firstKey = processedResultKeysRef.current.values().next().value;
        if (firstKey) processedResultKeysRef.current.delete(firstKey);
      }

      const eventReceivedAt = performance.now();
      const game = SECTOR_TO_GAME[e.sector];
      if (game) {
        // Result displayed immediately
        const resultDisplayedAt = performance.now();
        if (popupEnabled) {
          setPopupResult(game);
          setTimeout(() => setPopupResult(null), 4000);
        }
        selectActualResult(game);
        // Prediction generated after selectActualResult (synchronous)
        const predictionGeneratedAt = performance.now();

        // Compute full source→app latency
        const sourceMs = e.sourceTime ?? null;
        const appMs = e.appReceivedTime ?? null;
        const srcToApp = (sourceMs !== null && appMs !== null) ? appMs - sourceMs : null;
        const appToUI = Math.round(resultDisplayedAt - eventReceivedAt);
        const appToPred = Math.round(predictionGeneratedAt - eventReceivedAt);
        const totalSrcToUI = srcToApp !== null ? srcToApp + appToUI : null;
        const totalSrcToPred = srcToApp !== null ? srcToApp + appToPred : null;

        // Track history for averages
        if (srcToApp !== null && totalSrcToUI !== null && totalSrcToPred !== null) {
          latencyHistoryRef.current.push({ sourceToApp: srcToApp, totalToUI: totalSrcToUI, totalToPred: totalSrcToPred });
          if (latencyHistoryRef.current.length > 100) latencyHistoryRef.current.shift();
          // Update averages via state (not ref during render)
          const hist = latencyHistoryRef.current;
          const avgS2A = hist.reduce((s, h) => s + h.sourceToApp, 0) / hist.length;
          const minS2A = Math.min(...hist.map((h) => h.sourceToApp));
          const maxS2A = Math.max(...hist.map((h) => h.sourceToApp));
          // P95: sort and take the 95th percentile
          const sortedS2A = [...hist.map((h) => h.sourceToApp)].sort((a, b) => a - b);
          const p95Idx = Math.floor(sortedS2A.length * 0.95);
          const p95S2A = sortedS2A[p95Idx] ?? maxS2A;
          const avgA2U = hist.reduce((s, h) => s + h.totalToUI - h.sourceToApp, 0) / hist.length;
          const avgA2P = hist.reduce((s, h) => s + h.totalToPred - h.sourceToApp, 0) / hist.length;
          const minA2U = Math.min(...hist.map((h) => h.totalToUI - h.sourceToApp));
          const maxA2U = Math.max(...hist.map((h) => h.totalToUI - h.sourceToApp));
          const minA2P = Math.min(...hist.map((h) => h.totalToPred - h.sourceToApp));
          const maxA2P = Math.max(...hist.map((h) => h.totalToPred - h.sourceToApp));
          setLatencyAvg({
            avgSrcToApp: avgS2A, minSrcToApp: minS2A, maxSrcToApp: maxS2A, p95SrcToApp: p95S2A,
            avgAppToUI: avgA2U, avgAppToPred: avgA2P, minAppToUI: minA2U, maxAppToUI: maxA2U, minAppToPred: minA2P, maxAppToPred: maxA2P,
          });
          setEventStats((prev) => ({ ...prev, total: hist.length }));
        }

        const hist = latencyHistoryRef.current;
        setLatencyStats({
          lastEventTime: Date.now(),
          sourceTime: sourceMs,
          appReceivedTime: appMs,
          sourceToApp: srcToApp,
          appToUI,
          appToPrediction: appToPred,
          totalSourceToUI: totalSrcToUI,
          totalSourceToPrediction: totalSrcToPred,
          sector: e.sector,
          resultCount: hist.length,
          duplicateCount: 0,
        });
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

        {/* ===== NEXT PREDICTION (4 boxes) — LOCKED until next live result ===== */}
        <div className="revo-card revo-card-glow overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#448AFF]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-bolt text-[#FFD700]" /> Next Prediction
            </span>
            <div className="flex items-center gap-2">
              {/* LIVE AUTO badge — prediction auto-settles on new live result */}
              <span className="flex items-center gap-1.5 rounded-full bg-[#2ed573]/15 px-2 py-0.5 text-[9px] font-bold uppercase text-[#2ed573]" title="LIVE AUTO mode — prediction auto-settles when a new live result arrives. No manual refresh.">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2ed573]" />
                <i className="fas fa-bolt" /> LIVE AUTO
              </span>
              {/* LOCK indicator — prediction immutable until next result */}
              <span className="flex items-center gap-1 rounded-full bg-[#448AFF]/15 px-2 py-0.5 text-[9px] font-bold uppercase text-[#448AFF]" title="Prediction is LOCKED. Will not change until the next live result arrives.">
                <i className="fas fa-lock" /> LOCKED
              </span>
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

        {/* ===== DEBUG PERFORMANCE PANEL (full source→app latency tracking) ===== */}
        {latencyStats && (
          <div className="revo-card mt-2 overflow-hidden border border-[#00d4ff]/20">
            <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#00d4ff]/5 to-transparent px-4 py-2">
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#00d4ff]">
                <i className="fas fa-stopwatch" /> Performance Debug — {latencyStats.sector}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-[#5a6a99]">
                  {new Date(latencyStats.lastEventTime).toLocaleTimeString()}
                </span>
                <span className="rounded-full bg-[#1e2240] px-1.5 py-0.5 text-[8px] font-bold text-[#5a6a99]">
                  n={latencyStats.resultCount}
                </span>
              </div>
            </div>
            {/* Current latency (last event) */}
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-1.5 text-center">
                <div className="text-[7px] uppercase tracking-wider text-[#5a6a99]">Src→App (now)</div>
                <div className="text-sm font-black" style={{
                  color: latencyStats.sourceToApp === null ? "#5a6a99" : latencyStats.sourceToApp < 3000 ? "#2ed573" : latencyStats.sourceToApp < 6000 ? "#448AFF" : "#ffa502",
                }}>
                  {latencyStats.sourceToApp !== null ? `${(latencyStats.sourceToApp / 1000).toFixed(1)}s` : "—"}
                </div>
              </div>
              <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-1.5 text-center">
                <div className="text-[7px] uppercase tracking-wider text-[#5a6a99]">App→UI (now)</div>
                <div className="text-sm font-black" style={{
                  color: latencyStats.appToUI < 50 ? "#2ed573" : latencyStats.appToUI < 300 ? "#448AFF" : "#ffa502",
                }}>
                  {latencyStats.appToUI}ms
                </div>
              </div>
              <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-1.5 text-center">
                <div className="text-[7px] uppercase tracking-wider text-[#5a6a99]">App→Pred (now)</div>
                <div className="text-sm font-black" style={{
                  color: latencyStats.appToPrediction < 50 ? "#2ed573" : latencyStats.appToPrediction < 500 ? "#448AFF" : "#ffa502",
                }}>
                  {latencyStats.appToPrediction}ms
                </div>
              </div>
              <div className="rounded border border-[#00d4ff]/30 bg-[#00d4ff]/5 p-1.5 text-center">
                <div className="text-[7px] uppercase tracking-wider text-[#5a6a99]">Total→UI (now)</div>
                <div className="text-sm font-black" style={{
                  color: latencyStats.totalSourceToUI === null ? "#5a6a99" : latencyStats.totalSourceToUI < 3000 ? "#2ed573" : latencyStats.totalSourceToUI < 6000 ? "#448AFF" : "#ffa502",
                }}>
                  {latencyStats.totalSourceToUI !== null ? `${(latencyStats.totalSourceToUI / 1000).toFixed(1)}s` : "—"}
                </div>
              </div>
              <div className="rounded border border-[#00d4ff]/30 bg-[#00d4ff]/5 p-1.5 text-center">
                <div className="text-[7px] uppercase tracking-wider text-[#5a6a99]">Total→Pred (now)</div>
                <div className="text-sm font-black" style={{
                  color: latencyStats.totalSourceToPrediction === null ? "#5a6a99" : latencyStats.totalSourceToPrediction < 3000 ? "#2ed573" : latencyStats.totalSourceToPrediction < 6000 ? "#448AFF" : "#ffa502",
                }}>
                  {latencyStats.totalSourceToPrediction !== null ? `${(latencyStats.totalSourceToPrediction / 1000).toFixed(1)}s` : "—"}
                </div>
              </div>
              <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-1.5 text-center">
                <div className="text-[7px] uppercase tracking-wider text-[#5a6a99]">Events</div>
                <div className="text-sm font-black text-[#a78bfa]">{eventStats.total}</div>
                <div className="text-[6px] text-[#5a6a99]">
                  stale:{eventStats.stale} dup:{eventStats.duplicate}
                </div>
              </div>
            </div>
            {/* Aggregated stats */}
            {latencyAvg.avgSrcToApp !== null && (
              <div className="border-t border-[#1e2240] px-3 py-2">
                <div className="mb-1 text-[8px] font-bold uppercase tracking-wider text-[#5a6a99]">
                  Aggregated Live Statistics (genuine NEW events only, n={eventStats.total})
                </div>
                <div className="grid grid-cols-3 gap-2 text-[9px]">
                  {/* Source → App */}
                  <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-1.5">
                    <div className="text-[7px] font-bold uppercase text-[#00d4ff]">Source→App</div>
                    <div className="grid grid-cols-2 gap-0.5 mt-0.5">
                      <div>Avg: <span className="font-bold text-white">{(latencyAvg.avgSrcToApp / 1000).toFixed(1)}s</span></div>
                      <div>P95: <span className="font-bold text-[#ffa502]">{(latencyAvg.p95SrcToApp! / 1000).toFixed(1)}s</span></div>
                      <div>Min: <span className="font-bold text-[#2ed573]">{(latencyAvg.minSrcToApp! / 1000).toFixed(1)}s</span></div>
                      <div>Max: <span className="font-bold text-[#ff4757]">{(latencyAvg.maxSrcToApp! / 1000).toFixed(1)}s</span></div>
                    </div>
                  </div>
                  {/* App → UI */}
                  <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-1.5">
                    <div className="text-[7px] font-bold uppercase text-[#2ed573]">App→UI</div>
                    <div className="grid grid-cols-2 gap-0.5 mt-0.5">
                      <div>Avg: <span className="font-bold text-white">{latencyAvg.avgAppToUI.toFixed(0)}ms</span></div>
                      <div>Min: <span className="font-bold text-[#2ed573]">{latencyAvg.minAppToUI.toFixed(0)}ms</span></div>
                      <div>Max: <span className="font-bold text-[#ff4757]">{latencyAvg.maxAppToUI.toFixed(0)}ms</span></div>
                    </div>
                  </div>
                  {/* App → Prediction */}
                  <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-1.5">
                    <div className="text-[7px] font-bold uppercase text-[#448AFF]">App→Prediction</div>
                    <div className="grid grid-cols-2 gap-0.5 mt-0.5">
                      <div>Avg: <span className="font-bold text-white">{latencyAvg.avgAppToPred.toFixed(0)}ms</span></div>
                      <div>Min: <span className="font-bold text-[#2ed573]">{latencyAvg.minAppToPred.toFixed(0)}ms</span></div>
                      <div>Max: <span className="font-bold text-[#ff4757]">{latencyAvg.maxAppToPred.toFixed(0)}ms</span></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* Latency note */}
            <div className="border-t border-[#1e2240] px-4 py-1.5 text-[8px] text-[#5a6a99]">
              <i className="fas fa-circle-info mr-1" />
              No stale live-result cache. Polling=2s, API always fresh. Source→App = casino settledAt → app detection.
              App→UI = internal pipeline (target &lt;300ms). App→Pred = prediction generation (target &lt;500ms).
              Initial stale result excluded from stats. Dedup by timestamp, NOT by result name.
            </div>
          </div>
        )}

        {/* ===== EVENT DEBUG TABLE (pipeline audit) ===== */}
        {eventLog.length > 0 && (
          <div className="revo-card mt-2 overflow-hidden border border-[#a78bfa]/20">
            <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#a78bfa]/5 to-transparent px-4 py-2">
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#a78bfa]">
                <i className="fas fa-list-check" /> Event Debug Log (pipeline audit)
              </span>
              <span className="text-[9px] text-[#5a6a99]">{eventLog.length} events logged</span>
            </div>
            <div className="overflow-x-auto revo-scroll">
              <table className="w-full min-w-[900px] text-center text-[8px]">
                <thead>
                  <tr className="border-b border-[#1e2240] bg-[#0d1020]/60">
                    <th className="px-1 py-1.5">Event#</th>
                    <th className="px-1 py-1.5">Actual</th>
                    <th className="px-1 py-1.5">Old Pred (LOCKED)</th>
                    <th className="px-1 py-1.5">H/M</th>
                    <th className="px-1 py-1.5">N Before</th>
                    <th className="px-1 py-1.5">N After</th>
                    <th className="px-1 py-1.5">New Pred</th>
                    <th className="px-1 py-1.5">Pred#</th>
                    <th className="px-1 py-1.5">Lock</th>
                  </tr>
                </thead>
                <tbody>
                  {eventLog.map((e, i) => (
                    <tr key={i} className="border-b border-[#1e2240]/40 hover:bg-white/[0.02]">
                      <td className="px-1 py-1 font-bold text-[#a78bfa]">{e.eventId}</td>
                      <td className="px-1 py-1">
                        <span className={`font-bold ${["COIN FLIP","CASH HUNT","PACHINKO","CRAZY TIME"].includes(e.actual) ? "text-[#FFD700]" : "text-white"}`}>
                          {e.actual}
                        </span>
                      </td>
                      <td className="px-1 py-1 text-[#5a6a99]">
                        [{e.oldPrediction.join(",")}]
                      </td>
                      <td className="px-1 py-1">
                        <span className={`font-bold ${e.hitMiss === "HIT" ? "text-[#2ed573]" : "text-[#ff4757]"}`}>
                          {e.hitMiss}
                        </span>
                      </td>
                      <td className="px-1 py-1 text-[#5a6a99]">{e.historyNBefore}</td>
                      <td className="px-1 py-1 text-[#2ed573]">{e.historyNAfter}</td>
                      <td className="px-1 py-1 font-bold text-[#00d4ff]">
                        [{e.newPrediction.join(",")}]
                      </td>
                      <td className="px-1 py-1 text-[#a78bfa]">{e.predictionId}</td>
                      <td className="px-1 py-1">
                        {e.locked ? <i className="fas fa-lock text-[#2ed573]" /> : <i className="fas fa-lock-open text-[#ff4757]" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[#1e2240] px-4 py-1 text-[8px] text-[#5a6a99]">
              <i className="fas fa-shield-halved mr-1 text-[#2ed573]" />
              <b>Pipeline proof:</b> Old prediction settled BEFORE history update. New prediction uses updated history (N+1).
              Prediction Y tested against result X+1, NEVER against result X.
            </div>
          </div>
        )}

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
              {view.excludedOutcomes.map((g) => (
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
        <PerformanceDashboardPanel dashboard={view.dashboard} roundHistory={roundHistory} />
        {/* ===== SHADOW A/B: baseline (frozen k=30) vs experimental (reliability layer) ===== */}
        <div className="mt-4 rounded-lg border-2 border-[#a855f7]/30 bg-[#0d1020]/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#a855f7]">
              <i className="fas fa-flask-vial" /> Shadow A/B — Rare-Outcome Reliability Layer
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#1e2240] px-2 py-0.5 text-[9px] font-bold uppercase text-[#8899cc]">
                RELIABILITY_K = {EXPERIMENTAL_CONFIG.reliabilityK}
              </span>
              <button
                type="button"
                onClick={toggleExperimental}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase transition-colors ${
                  experimentalEnabled
                    ? "bg-[#2ed573]/20 text-[#2ed573] hover:bg-[#2ed573]/30"
                    : "bg-[#1e2240] text-[#8899cc] hover:bg-[#2a2f4d]"
                }`}
                aria-pressed={experimentalEnabled}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${experimentalEnabled ? "bg-[#2ed573]" : "bg-[#5a6a99]"}`} />
                {experimentalEnabled ? "EXPERIMENTAL SHADOW ON" : "SHADOW OFF"}
              </button>
            </div>
          </div>

          {/* ===== START FRESH VALIDATION (prominent button + timestamp) ===== */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-[#a855f7]/40 bg-gradient-to-r from-[#a855f7]/10 to-transparent p-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startFreshValidation}
                className="flex items-center gap-2 rounded-md bg-[#a855f7] px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-white shadow-md transition hover:bg-[#9333ea]"
                title="Clears the shadow ledger, enables the experimental engine, and starts a fresh A/B validation. Both engines will be re-seeded from current history."
              >
                <i className="fas fa-play" /> START FRESH VALIDATION
              </button>
              <button
                type="button"
                onClick={clearShadow}
                className="rounded bg-[#ff4757]/10 px-2 py-1 text-[9px] font-bold uppercase text-[#ff4757] hover:bg-[#ff4757]/20"
                title="Clear only the shadow ledger (keeps experimental flag + validation timestamp)"
              >
                <i className="fas fa-broom mr-0.5" /> Clear Ledger
              </button>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-[#5a6a99]">
              {validationStartedAt ? (
                <>
                  <span className="flex items-center gap-1 rounded-full bg-[#2ed573]/10 px-2 py-0.5 font-bold uppercase text-[#2ed573]">
                    <i className="fas fa-stopwatch" /> Validation Started
                  </span>
                  <span className="font-mono text-[#8899cc]">
                    {new Date(validationStartedAt).toLocaleString()}
                  </span>
                  <span className="text-[#5a6a99]">
                    ({Math.round((Date.now() - validationStartedAt) / 1000)}s ago)
                  </span>
                  <button
                    type="button"
                    onClick={clearValidationStartTs}
                    className="ml-1 rounded bg-[#1e2240] px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#5a6a99] hover:bg-[#2a2f4d]"
                  >
                    Reset TS
                  </button>
                </>
              ) : (
                <span className="italic">No validation started — press "START FRESH VALIDATION" to begin.</span>
              )}
            </div>
          </div>

          <div className="mb-2 rounded-lg border border-[#a855f7]/20 bg-[#a855f7]/5 p-2 text-[9px] leading-relaxed text-[#8899cc]">
            <b className="text-[#a855f7]">Root cause (50-round k=30 validation, 78% HIT):</b> 7 of 11 misses
            involved PACHINKO (3 appearances → +39% deviation) displacing a higher-prior number.
            Fix: a <b>continuous, generic</b> reliability factor
            <code className="mx-1 rounded bg-[#0d1020] px-1 text-[#00d4ff]">r = N_obs / (N_obs + {EXPERIMENTAL_CONFIG.reliabilityK})</code>
            dampens the <b>positive</b> deviation of any outcome resting on few observations.
            Negative deviations pass through (never inflate unseen rare outcomes). NO hard cutoff,
            NO PACHINKO ban, NO forced [1,2,5,10]. The active displayed prediction stays the frozen
            k=30 <b>baseline</b>; experimental runs in <b>shadow</b> on the SAME live rounds.
          </div>

          {!experimentalEnabled ? (
            <div className="py-4 text-center text-xs text-[#5a6a99]">
              <i className="fas fa-toggle-off mb-1 text-xl text-[#5a6a99]" />
              <div>Shadow A/B is OFF. Enable to run the experimental engine in parallel.</div>
              <div className="text-[9px] mt-1">Baseline (frozen k=30) remains the active prediction either way.</div>
            </div>
          ) : (
            <>
              {/* Paired comparison KPIs */}
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
                  <div className="text-lg font-black text-white">{shadowStats.total}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Paired Rounds</div>
                </div>
                <div className="rounded border border-[#00d4ff]/30 bg-[#00d4ff]/8 p-2 text-center">
                  <div className="text-lg font-black text-[#00d4ff]">{Math.round(shadowStats.bRate * 100)}%</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Baseline HIT ({shadowStats.bHits}/{shadowStats.total})</div>
                </div>
                <div className="rounded border border-[#a855f7]/30 bg-[#a855f7]/8 p-2 text-center">
                  <div className="text-lg font-black text-[#a855f7]">{Math.round(shadowStats.eRate * 100)}%</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Experimental HIT ({shadowStats.eHits}/{shadowStats.total})</div>
                </div>
                <div className={`rounded border p-2 text-center ${shadowStats.delta >= 0 ? "border-[#2ed573]/30 bg-[#2ed573]/8" : "border-[#ff4757]/30 bg-[#ff4757]/8"}`}>
                  <div className={`text-lg font-black ${shadowStats.delta >= 0 ? "text-[#2ed573]" : "text-[#ff4757]"}`}>
                    {shadowStats.delta >= 0 ? "+" : ""}{Math.round(shadowStats.delta * 100)}%
                  </div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Δ (exp − base)</div>
                </div>
              </div>

              {/* ===== Normal vs Bonus HIT breakdown (4 KPIs) ===== */}
              <div className="mb-3 rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-2.5">
                <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
                  Normal vs Bonus HIT breakdown
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded border border-[#00d4ff]/30 bg-[#00d4ff]/5 p-1.5 text-center">
                    <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Baseline Normal</div>
                    <div className="text-sm font-black text-[#00d4ff]">
                      {shadowStats.bNormalTotal > 0 ? `${Math.round(shadowStats.bNormalRate * 100)}%` : "—"}
                    </div>
                    <div className="text-[7px] text-[#5a6a99]">{shadowStats.bNormalHits}/{shadowStats.bNormalTotal} normal rounds</div>
                  </div>
                  <div className="rounded border border-[#a855f7]/30 bg-[#a855f7]/5 p-1.5 text-center">
                    <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Experimental Normal</div>
                    <div className="text-sm font-black text-[#a855f7]">
                      {shadowStats.eNormalTotal > 0 ? `${Math.round(shadowStats.eNormalRate * 100)}%` : "—"}
                    </div>
                    <div className="text-[7px] text-[#5a6a99]">{shadowStats.eNormalHits}/{shadowStats.eNormalTotal} normal rounds</div>
                  </div>
                  <div className="rounded border border-[#00d4ff]/30 bg-[#00d4ff]/5 p-1.5 text-center">
                    <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Baseline Bonus</div>
                    <div className="text-sm font-black text-[#00d4ff]">
                      {shadowStats.bBonusTotal > 0 ? `${Math.round(shadowStats.bBonusRate * 100)}%` : "—"}
                    </div>
                    <div className="text-[7px] text-[#5a6a99]">{shadowStats.bBonusHits}/{shadowStats.bBonusTotal} bonus rounds</div>
                  </div>
                  <div className="rounded border border-[#a855f7]/30 bg-[#a855f7]/5 p-1.5 text-center">
                    <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Experimental Bonus</div>
                    <div className="text-sm font-black text-[#a855f7]">
                      {shadowStats.eBonusTotal > 0 ? `${Math.round(shadowStats.eBonusRate * 100)}%` : "—"}
                    </div>
                    <div className="text-[7px] text-[#5a6a99]">{shadowStats.eBonusHits}/{shadowStats.eBonusTotal} bonus rounds</div>
                  </div>
                </div>
              </div>

              {/* ===== Theoretical [1,2,5,10] baseline row ===== */}
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded border border-[#ffa502]/30 bg-[#ffa502]/8 p-2 text-center">
                  <div className="text-sm font-black text-[#ffa502]">{Math.round(shadowStats.theoRate * 100)}%</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Theoretical [1,2,5,10] ({shadowStats.theoHits}/{shadowStats.total})</div>
                </div>
                <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
                  <div className="text-sm font-black text-[#00d4ff]">{shadowStats.bPredChanges}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Baseline Pred Changes</div>
                </div>
                <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
                  <div className="text-sm font-black text-[#a855f7]">{shadowStats.ePredChanges}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Experimental Pred Changes</div>
                </div>
                <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
                  <div className="text-[9px] text-[#5a6a99]">Stale Runs</div>
                  <div className="text-sm font-black">
                    <span className="text-[#00d4ff]">{shadowStats.bStaleRuns}</span>
                    <span className="text-[#5a6a99]"> / </span>
                    <span className="text-[#a855f7]">{shadowStats.eStaleRuns}</span>
                  </div>
                  <div className="text-[7px] text-[#5a6a99]">base / exp (3+ same)</div>
                </div>
              </div>

              {/* ===== Avg expected coverage comparison ===== */}
              <div className="mb-3 rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-2.5">
                <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
                  Avg Expected Coverage (sum of 4 selected calibrated probs per round)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded border border-[#00d4ff]/30 bg-[#00d4ff]/5 p-1.5 text-center">
                    <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Baseline Avg Coverage</div>
                    <div className="text-sm font-black text-[#00d4ff]">{(shadowStats.bAvgCoverage * 100).toFixed(2)}%</div>
                  </div>
                  <div className="rounded border border-[#a855f7]/30 bg-[#a855f7]/5 p-1.5 text-center">
                    <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Experimental Avg Coverage</div>
                    <div className="text-sm font-black text-[#a855f7]">{(shadowStats.eAvgCoverage * 100).toFixed(2)}%</div>
                  </div>
                </div>
                <div className="mt-1 text-[8px] text-[#5a6a99]">
                  <i className="fas fa-circle-info mr-0.5" />
                  Higher coverage = the 4 chosen outcomes cover more of the probability mass. Doesn't equal hit rate, but tracks expected value.
                </div>
              </div>

              {/* Flips */}
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded border border-[#2ed573]/30 bg-[#2ed573]/8 p-2 text-center">
                  <div className="text-sm font-black text-[#2ed573]">{shadowStats.flipsToHit}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">MISS→HIT (experimental saved)</div>
                </div>
                <div className="rounded border border-[#ff4757]/30 bg-[#ff4757]/8 p-2 text-center">
                  <div className="text-sm font-black text-[#ff4757]">{shadowStats.flipsToMiss}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">HIT→MISS (experimental lost)</div>
                </div>
              </div>

              {/* Per-outcome inclusion table */}
              <div className="mb-3 overflow-x-auto rounded border border-[#1e2240]">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="bg-[#1e2240] text-[#5a6a99]">
                      <th className="px-2 py-1 text-left">Outcome</th>
                      <th className="px-2 py-1 text-right">Actuals</th>
                      <th className="px-2 py-1 text-right">Base Inc</th>
                      <th className="px-2 py-1 text-right">Exp Inc</th>
                      <th className="px-2 py-1 text-right">Base Rate</th>
                      <th className="px-2 py-1 text-right">Exp Rate</th>
                      <th className="px-2 py-1 text-right">Δ Inc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ENGINE_GAMES.map((g) => {
                      const st = shadowStats.perOutcome[g.name];
                      const dInc = st.expInc - st.baseInc;
                      return (
                        <tr key={g.name} className="border-t border-[#1e2240]">
                          <td className="px-2 py-1 font-bold text-white">{g.name}</td>
                          <td className="px-2 py-1 text-right text-[#8899cc]">{st.actuals}</td>
                          <td className="px-2 py-1 text-right text-[#00d4ff]">{st.baseInc}</td>
                          <td className="px-2 py-1 text-right text-[#a855f7]">{st.expInc}</td>
                          <td className="px-2 py-1 text-right text-[#8899cc]">{Math.round(st.baseRate * 100)}%</td>
                          <td className="px-2 py-1 text-right text-[#8899cc]">{Math.round(st.expRate * 100)}%</td>
                          <td className={`px-2 py-1 text-right font-bold ${dInc < 0 ? "text-[#2ed573]" : dInc > 0 ? "text-[#ffa502]" : "text-[#5a6a99]"}`}>{dInc > 0 ? "+" : ""}{dInc}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 1/2/5/10 exclusion rates */}
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(["1", "2", "5", "10"] as const).map((num) => {
                  const er = shadowStats.exclusionRates[num];
                  const dExcl = er.exp - er.base;
                  return (
                    <div key={num} className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
                      <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">"{num}" excluded</div>
                      <div className="text-sm font-black text-white">
                        {Math.round(er.base * 100)}% <span className="text-[#5a6a99]">→</span> {Math.round(er.exp * 100)}%
                      </div>
                      <div className={`text-[8px] font-bold ${dExcl < 0 ? "text-[#2ed573]" : dExcl > 0 ? "text-[#ff4757]" : "text-[#5a6a99]"}`}>
                        {dExcl < 0 ? "less excluded" : dExcl > 0 ? "more excluded" : "same"}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ===== MISS RCA flips summary ===== */}
              {shadowStats.flips.length > 0 && (
                <div className="mb-3 rounded-lg border border-[#ffa502]/30 bg-[#ffa502]/5 p-2.5">
                  <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[#ffa502]">
                    MISS RCA — flips ({shadowStats.flips.length} total)
                  </div>
                  <div className="max-h-48 overflow-y-auto revo-scroll space-y-1">
                    {shadowStats.flips.map((f, i) => (
                      <div key={i} className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-1.5 text-[9px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-white">#{f.roundId}</span>
                          <span className={`rounded px-1 py-0.5 text-[8px] font-bold uppercase ${f.type === "MISS_TO_HIT" ? "bg-[#2ed573]/15 text-[#2ed573]" : "bg-[#ff4757]/15 text-[#ff4757]"}`}>
                            {f.type === "MISS_TO_HIT" ? "MISS→HIT" : "HIT→MISS"}
                          </span>
                          <span className="text-[#8899cc]">actual:</span>
                          <span className={`font-bold ${BONUS_NAMES.includes(f.actual) ? "text-[#FFD700]" : "text-white"}`}>{f.actual}</span>
                        </div>
                        <div className="mt-0.5 text-[#8899cc]">
                          <span className="text-[#00d4ff]">base: [{f.bPreds.join(",")}]</span>
                          {" → "}
                          <span className="text-[#a855f7]">exp: [{f.ePreds.join(",")}]</span>
                        </div>
                        <div className="mt-0.5 italic text-[#ffa502]">↳ {f.rca}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="text-[8px] text-[#5a6a99]">
                  <i className="fas fa-shield-halved mr-1 text-[#2ed573]" />
                  Both engines see the SAME pre-result history. No data leakage. Persisted across reloads.
                </div>
                <button
                  type="button"
                  onClick={clearShadow}
                  className="rounded bg-[#ff4757]/10 px-2 py-1 text-[9px] font-bold uppercase text-[#ff4757] hover:bg-[#ff4757]/20"
                >
                  Clear Ledger
                </button>
              </div>
              {shadowStats.total < 50 && (
                <div className="mt-2 rounded border border-[#ffa502]/30 bg-[#ffa502]/8 p-2 text-[9px] text-[#ffa502]">
                  <i className="fas fa-triangle-exclamation mr-1" />
                  {shadowStats.total}/50 paired rounds. Need 50+ for a meaningful comparison. No mid-test tuning.
                </div>
              )}
            </>
          )}
        </div>

        {/* ===== ROUND-BY-ROUND VALIDATION LOG (collapsible, scrollable) ===== */}
        <RoundByRoundLog ledger={shadowLedger} experimentalEnabled={experimentalEnabled} />

        {/* ===== RETROSPECTIVE DIAGNOSTIC (SIMULATION — not a validation result) ===== */}
        <div className="mt-4 rounded-lg border-2 border-[#ffa502]/30 bg-[#0d1020]/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#ffa502]">
              <i className="fas fa-magnifying-glass-chart" /> Retrospective Diagnostic
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={runRetroLive}
                className="rounded bg-[#00d4ff]/10 px-2.5 py-1 text-[10px] font-bold uppercase text-[#00d4ff] hover:bg-[#00d4ff]/20"
              >
                Replay LIVE rounds ({roundHistory.length})
              </button>
              <button
                type="button"
                onClick={runRetroSynthetic}
                className="rounded bg-[#a855f7]/10 px-2.5 py-1 text-[10px] font-bold uppercase text-[#a855f7] hover:bg-[#a855f7]/20"
              >
                Replay Synthetic 50
              </button>
            </div>
          </div>

          <div className="mb-2 rounded-lg border border-[#ffa502]/20 bg-[#ffa502]/5 p-2 text-[9px] leading-relaxed text-[#8899cc]">
            <b className="text-[#ffa502]">SIMULATION ONLY.</b> Replays a result sequence through BOTH engines
            round-by-round (no leakage) to estimate direction/magnitude of the reliability layer.
            <b> This is NOT a validation result.</b> Do NOT claim improved accuracy from this test.
            Genuine validation = the live Shadow A/B above on fresh out-of-sample rounds.
          </div>

          {retroResult ? (
            <>
              <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
                Source: {retroSource === "live"
                  ? `${roundHistory.length} real verified rounds (replayed)`
                  : "synthetic 50-round representative sample"}
              </div>

              {/* Headline comparison */}
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
                  <div className="text-lg font-black text-white">{retroResult.baseline.totalRounds}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Rounds Replayed</div>
                </div>
                <div className="rounded border border-[#00d4ff]/30 bg-[#00d4ff]/8 p-2 text-center">
                  <div className="text-lg font-black text-[#00d4ff]">{Math.round(retroResult.baseline.hitRate * 100)}%</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Baseline HIT ({retroResult.baseline.hits}/{retroResult.baseline.totalRounds})</div>
                </div>
                <div className="rounded border border-[#a855f7]/30 bg-[#a855f7]/8 p-2 text-center">
                  <div className="text-lg font-black text-[#a855f7]">{Math.round(retroResult.experimental.hitRate * 100)}%</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Experimental HIT ({retroResult.experimental.hits}/{retroResult.experimental.totalRounds})</div>
                </div>
                <div className={`rounded border p-2 text-center ${(retroResult.experimental.hits - retroResult.baseline.hits) >= 0 ? "border-[#2ed573]/30 bg-[#2ed573]/8" : "border-[#ff4757]/30 bg-[#ff4757]/8"}`}>
                  <div className={`text-lg font-black ${(retroResult.experimental.hits - retroResult.baseline.hits) >= 0 ? "text-[#2ed573]" : "text-[#ff4757]"}`}>
                    {retroResult.flipsToHit > 0 ? "+" : ""}{retroResult.experimental.hits - retroResult.baseline.hits}
                  </div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Net Δ Hits</div>
                </div>
              </div>

              {/* Flip summary */}
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded border border-[#2ed573]/30 bg-[#2ed573]/8 p-2 text-center">
                  <div className="text-sm font-black text-[#2ed573]">{retroResult.flipsToHit}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">MISS→HIT saved</div>
                </div>
                <div className="rounded border border-[#ff4757]/30 bg-[#ff4757]/8 p-2 text-center">
                  <div className="text-sm font-black text-[#ff4757]">{retroResult.flipsToMiss}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">HIT→MISS lost</div>
                </div>
                <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
                  <div className="text-sm font-black text-[#a855f7]">{retroResult.pachinkoInclusionsRemoved}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">PACHINKO Inc Removed</div>
                </div>
                <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
                  <div className="text-sm font-black text-[#2ed573]">{retroResult.pachinkoActualsRetained}/{retroResult.baseline.pachinkoActuals}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">PACHINKO Actuals Retained</div>
                </div>
              </div>

              {/* Per-outcome inclusion comparison */}
              <div className="mb-3 overflow-x-auto rounded border border-[#1e2240]">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="bg-[#1e2240] text-[#5a6a99]">
                      <th className="px-2 py-1 text-left">Outcome</th>
                      <th className="px-2 py-1 text-right">Actuals</th>
                      <th className="px-2 py-1 text-right">Base Inc</th>
                      <th className="px-2 py-1 text-right">Exp Inc</th>
                      <th className="px-2 py-1 text-right">Base Cov</th>
                      <th className="px-2 py-1 text-right">Exp Cov</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retroResult.baseline.perOutcome.map((b, i) => {
                      const e = retroResult.experimental.perOutcome[i];
                      return (
                        <tr key={b.name} className="border-t border-[#1e2240]">
                          <td className="px-2 py-1 font-bold text-white">{b.name}</td>
                          <td className="px-2 py-1 text-right text-[#8899cc]">{b.actuals}</td>
                          <td className="px-2 py-1 text-right text-[#00d4ff]">{b.inclusions}</td>
                          <td className="px-2 py-1 text-right text-[#a855f7]">{e.inclusions}</td>
                          <td className="px-2 py-1 text-right text-[#2ed573]">{b.actuals > 0 ? `${b.coveredActuals}/${b.actuals}` : "—"}</td>
                          <td className="px-2 py-1 text-right text-[#2ed573]">{e.actuals > 0 ? `${e.coveredActuals}/${e.actuals}` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 1/2/5/10 exclusion rate comparison */}
              <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(["1", "2", "5", "10"] as const).map((num) => {
                  const b = retroResult.baseline.exclusionRates[num] ?? 0;
                  const e = retroResult.experimental.exclusionRates[num] ?? 0;
                  const prevented = retroResult.exclusionPrevented[num] ?? 0;
                  return (
                    <div key={num} className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
                      <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">"{num}" excluded</div>
                      <div className="text-xs font-black text-white">
                        {Math.round(b * 100)}% <span className="text-[#5a6a99]">→</span> {Math.round(e * 100)}%
                      </div>
                      <div className={`text-[8px] font-bold ${prevented > 0 ? "text-[#2ed573]" : "text-[#5a6a99]"}`}>
                        {prevented > 0 ? `${prevented} exclusions prevented` : "no change"}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg border border-[#ffa502]/20 bg-[#ffa502]/5 p-2 text-[9px] italic text-[#ffa502]">
                <i className="fas fa-circle-info mr-1" />
                {retroResult.note}
              </div>
            </>
          ) : (
            <div className="py-4 text-center text-xs text-[#5a6a99]">
              <i className="fas fa-play mb-1 text-xl text-[#5a6a99]" />
              <div>Run a retrospective replay to estimate the reliability layer's effect.</div>
              <div className="text-[9px] mt-1">"Replay LIVE rounds" uses your actual verified history. "Synthetic 50" uses a representative sample.</div>
            </div>
          )}
        </div>

        {/* ===== C1–C7 EXPERIMENTAL FLAGS (bit-for-bit OFF by default) ===== */}
        <section className="mt-4 rounded-2xl border border-[#1e2240] bg-[#141827] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#448AFF]">
              <i className="fas fa-flag" /> C1–C7 EXPERIMENTAL FLAGS (bit-for-bit OFF)
            </span>
            <span className="rounded-full bg-[#1e2240] px-2 py-0.5 text-[9px] font-bold uppercase text-[#8899cc]">
              {MODEL_VERSION}
            </span>
          </div>

          <div className="mb-3 rounded-lg border border-[#448AFF]/20 bg-[#448AFF]/5 p-2 text-[9px] leading-relaxed text-[#8899cc]">
            <b className="text-[#448AFF]">All flags OFF = bit-for-bit production baseline.</b>{" "}
            Shadow A/B remains OFF until you enable it above. These flags ONLY affect
            the experimental shadow engine — never the active displayed prediction.
          </div>

          {/* 7 toggle switches — mirrors the experimentalEnabled toggle styling */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FLAG_META.map((f) => {
              const on = cFlags[f.key];
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => toggleCFlag(f.key)}
                  className={`flex items-start justify-between gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                    on
                      ? "border-[#448AFF]/40 bg-[#448AFF]/8"
                      : "border-[#1e2240] bg-[#0d1020]/60 hover:bg-[#0d1020]"
                  }`}
                  aria-pressed={on}
                  aria-label={`Toggle ${f.key}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <code className="rounded bg-[#0d1020] px-1 text-[9px] font-bold text-[#448AFF]">{f.key}</code>
                      {on && <span className="text-[8px] font-bold uppercase text-[#2ed573]">ON</span>}
                    </div>
                    <div className="mt-1 text-[9px] leading-snug text-[#8899cc]">{f.desc}</div>
                  </div>
                  <span
                    className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${
                      on ? "bg-[#2ed573]/20 text-[#2ed573]" : "bg-[#1e2240] text-[#5a6a99]"
                    }`}
                  >
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${on ? "bg-[#2ed573]" : "bg-[#5a6a99]"}`} />
                    {on ? "ON" : "OFF"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ===== C7 FROZEN WALK-FORWARD button + result viewer ===== */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#ffa502]/30 bg-gradient-to-r from-[#ffa502]/10 to-transparent p-2.5">
            <button
              type="button"
              onClick={runFwf}
              className="flex items-center gap-2 rounded-md bg-[#ffa502] px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-[#0a0b14] shadow-md transition hover:bg-[#ff9f1c]"
              title="Runs the C7 frozen walk-forward harness on current round history: current flags vs ALL_FLAGS_OFF baseline, with theoretical [1,2,5,10] reference. Build path only — NOT a validation claim."
            >
              <i className="fas fa-play" /> Run C7 Frozen Walk-Forward (current flags vs baseline)
            </button>
            <span className="text-[9px] text-[#5a6a99]">
              {roundHistory.length} round{roundHistory.length !== 1 ? "s" : ""} available
            </span>
          </div>

          {fwfResult ? (
            <div className="mt-3 rounded-lg border border-[#1e2240] bg-[#0d1020]/60 p-3">
              {/* Headline KPIs */}
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
                  <div className="text-lg font-black text-white">{fwfResult.freshRounds}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Fresh Rounds</div>
                </div>
                <div className="rounded border border-[#00d4ff]/30 bg-[#00d4ff]/8 p-2 text-center">
                  <div className="text-lg font-black text-[#00d4ff]">{(fwfResult.baseline.hitRate * 100).toFixed(1)}%</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Baseline HIT ({fwfResult.baseline.hits}/{fwfResult.baseline.totalRounds})</div>
                </div>
                <div className="rounded border border-[#a855f7]/30 bg-[#a855f7]/8 p-2 text-center">
                  <div className="text-lg font-black text-[#a855f7]">{(fwfResult.experimental.hitRate * 100).toFixed(1)}%</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Experimental HIT ({fwfResult.experimental.hits}/{fwfResult.experimental.totalRounds})</div>
                </div>
                <div className="rounded border border-[#FFD700]/30 bg-[#FFD700]/8 p-2 text-center">
                  <div className="text-lg font-black text-[#FFD700]">{(fwfResult.theoretical.hitRate * 100).toFixed(1)}%</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Theoretical [1,2,5,10] ({fwfResult.theoretical.hits}/{fwfResult.freshRounds})</div>
                </div>
              </div>

              {/* Flips + bonus inclusion rate */}
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded border border-[#2ed573]/30 bg-[#2ed573]/8 p-2 text-center">
                  <div className="text-sm font-black text-[#2ed573]">{fwfResult.flipsToHit}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">MISS→HIT saved</div>
                </div>
                <div className="rounded border border-[#ff4757]/30 bg-[#ff4757]/8 p-2 text-center">
                  <div className="text-sm font-black text-[#ff4757]">{fwfResult.flipsToMiss}</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">HIT→MISS lost</div>
                </div>
                <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
                  <div className="text-sm font-black text-[#00d4ff]">{(fwfResult.baseline.bonusInclusionRate * 100).toFixed(1)}%</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Base Bonus Inc Rate</div>
                </div>
                <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
                  <div className="text-sm font-black text-[#a855f7]">{(fwfResult.experimental.bonusInclusionRate * 100).toFixed(1)}%</div>
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Exp Bonus Inc Rate</div>
                </div>
              </div>

              {/* McNemar note */}
              <div className="mb-2 rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-2 text-[9px] text-[#8899cc]">
                <b className="text-[#8899cc]">McNemar:</b> {fwfResult.mcnemar.note}{" "}
                (χ² = {fwfResult.mcnemar.statistic.toFixed(2)}, p = {fwfResult.mcnemar.pValue.toExponential(2)}
                {fwfResult.mcnemar.significant ? ", significant" : ", not significant"})
              </div>

              {/* Prominent disclaimer */}
              <div className="rounded-lg border border-[#ff4757]/40 bg-[#ff4757]/8 p-2.5 text-[10px] font-bold leading-relaxed text-[#ff4757]">
                <i className="fas fa-triangle-exclamation mr-1" />
                {fwfResult.note}
              </div>
            </div>
          ) : (
            <div className="mt-3 py-3 text-center text-xs text-[#5a6a99]">
              <i className="fas fa-flask mb-1 text-xl text-[#5a6a99]" />
              <div>Press “Run C7 Frozen Walk-Forward” to replay current history through both arms.</div>
              <div className="text-[9px] mt-1">Build path only — NOT a validation claim.</div>
            </div>
          )}

          {/* ===== C6 LOCKED RCA viewer (only when c6 ON + shadow ON) ===== */}
          {cFlags.c6_rcaInstrumentation && experimentalEnabled && expLockedRca ? (
            <div className="mt-3 rounded-lg border border-[#2ed573]/30 bg-[#2ed573]/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#2ed573]">
                <i className="fas fa-microscope" /> C6 Locked RCA (latest experimental lock)
              </div>
              <div className="mb-1.5 text-[10px] text-[#8899cc]">
                <b className="text-white">Winning Top-4:</b>{" "}
                <span className="font-mono text-[#2ed573]">{expLockedRca.winningCombination.join(" · ")}</span>
              </div>
              <div className="mb-1.5 text-[10px] text-[#8899cc]">
                <b className="text-white">Excluded #5:</b>{" "}
                <span className="font-mono text-[#ff4757]">{expLockedRca.excludedFifth}</span>
              </div>
              <div className="text-[10px] leading-relaxed text-[#8899cc]">
                <b className="text-white">Optimizer note:</b> {expLockedRca.optimizerNote}
              </div>
              <div className="mt-1.5 text-[8px] text-[#5a6a99]">
                modelVersion: {expLockedRca.modelVersion} · timestamp: {new Date(expLockedRca.timestamp).toLocaleString()} · mode: {expLockedRca.engineMode}
              </div>
            </div>
          ) : null}
        </section>

        {/* ===== WHEEL BASE-PROBABILITY MODEL (54 segments) ===== */}
        <WheelProbabilityPanel candidateScores={view.candidateScores} />

        {/* ===== ADVANCED DECISION ENGINE ===== */}
        <DecisionEnginePanel engine={view} />

        {/* ===== VERIFIED ACCURACY (from manual results only) ===== */}
        {verifiedRounds > 0 && (
          <div className="revo-card mt-4 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-circle-check text-[#2ed573]" /> Verified Accuracy
              </span>
              <span className="text-[10px] text-[#5a6a99]">
                from {verifiedRounds} result{verifiedRounds !== 1 ? "s" : ""}
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
            {/* Sample-size validation tier — honest disclaimer */}
            {verifiedRounds < 20 && (
              <div className="mt-3 rounded-lg border border-[#ffa502]/30 bg-[#ffa502]/8 p-2.5 text-[10px] text-[#ffa502]">
                <i className="fas fa-triangle-exclamation mr-1" />
                <b>EARLY DATA — sample size {verifiedRounds}/20.</b>{" "}
                {verifiedRounds < 5
                  ? "Insufficient for any accuracy claim. Predictions are exploratory."
                  : verifiedRounds < 10
                    ? "Low confidence — need 10+ rounds for LOW CONFIDENCE tier."
                    : verifiedRounds < 20
                      ? "Moderate tier — need 20+ rounds for STRONG label."
                      : ""}
                {" "}A few HITs do NOT prove predictive accuracy.
              </div>
            )}
            {/* Validation tier progress bars: 5 / 10 / 20 / 50 / 100+ */}
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {[
                { tier: 5, label: "5" },
                { tier: 10, label: "10" },
                { tier: 20, label: "20" },
                { tier: 50, label: "50" },
                { tier: 100, label: "100+" },
              ].map((t) => {
                const reached = verifiedRounds >= t.tier;
                const pct = Math.min(100, (verifiedRounds / t.tier) * 100);
                return (
                  <div key={t.tier} className="text-center">
                    <div className="mx-auto mb-0.5 h-1.5 w-full overflow-hidden rounded-full bg-[#1e2240]">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background: reached ? "#2ed573" : "#448AFF",
                        }}
                      />
                    </div>
                    <div className={`text-[8px] font-bold ${reached ? "text-[#2ed573]" : "text-[#5a6a99]"}`}>
                      {t.label}{reached ? " ✓" : ""}
                    </div>
                  </div>
                );
              })}
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
function PerformanceDashboardPanel({ dashboard, roundHistory: rh }: { dashboard: PerformanceDashboard; roundHistory: RoundResult[] }) {
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
    // NEW performance windows:
    recent5HitRate,
    recent10HitRate,
    recent20HitRate,
    recent50HitRate,
    recent100HitRate,
    recent5Count,
    recent10Count,
    recent20Count,
    recent50Count,
    recent100Count,
    hitStreak,
    missStreak,
    predictionCoverage,
    // NEW bonus risk analysis:
    normalOutcomeCoverage,
    bonusOutcomeCoverage,
    bonusOutcomeRisk,
    totalPredictionCoverage,
    bonusRecentRate,
    bonusLongTermRate,
    bonusTrend,
    bonusBursts,
    bonusActive,
    // NEW normal vs bonus result performance:
    normalResultHitRate,
    bonusResultHitRate,
    normalResultMissRate,
    bonusResultMissRate,
    normalResultCount,
    bonusResultCount,
    // NEW excluded risk breakdown:
    excludedNormalRisk,
    excludedBonusRisk,
    totalMissExposure,
    // NEW per-bonus performance:
    perBonusPerformance,
    bonusUnderrepresented,
    bonusUnderrepresentationNote,
    modelBiasWarning,
    modelBiasNote,
    // NEW selection bias detection:
    perBonusSelectionBias,
    selectionBiasWarning,
    selectionBiasNote,
  } = dashboard;

  return (
    <div className="revo-card mt-4 overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#00d4ff]/10 to-transparent px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-gauge-high text-[#00d4ff]" /> Performance Dashboard
        </span>
        <div className="flex items-center gap-1.5">
          {hitStreak > 0 && (
            <span className="rounded-full bg-[#2ed573]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#2ed573]">
              {hitStreak}× HIT streak
            </span>
          )}
          {missStreak > 0 && (
            <span className="rounded-full bg-[#ff4757]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#ff4757]">
              {missStreak}× MISS streak
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
          <Kpi label="Coverage" value={`${Math.round(predictionCoverage * 100)}%`} color="#FFD700" />
          <Kpi label="Stability" value={`${modelStability}%`} color={modelStability >= 50 ? "#2ed573" : "#ffa502"} />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Long-Term" value={`${Math.round(longTermHitRate * 100)}%`} color="#a78bfa" />
          <Kpi label="Excluded Rate" value={`${Math.round(excludedResultRate * 100)}%`} color="#ff4757" />
          <Kpi label="Adaptive Wt" value={`${Math.round(adaptiveWeight * 100)}%`} color="#FFD700" />
          <Kpi label="Recent (5)" value={`${Math.round(recentHitRate * 100)}%`} color="#448AFF" />
        </div>

        {/* ===== NEW: Performance Windows (5/10/20/50/100+) ===== */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Performance Windows (separate hit-rates)
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {[
              { label: "5", rate: recent5HitRate, count: recent5Count },
              { label: "10", rate: recent10HitRate, count: recent10Count },
              { label: "20", rate: recent20HitRate, count: recent20Count },
              { label: "50", rate: recent50HitRate, count: recent50Count },
              { label: "100+", rate: recent100HitRate, count: recent100Count },
            ].map((w) => {
              const pct = Math.round(w.rate * 100);
              const color = w.count === 0 ? "#5a6a99" : w.rate >= 0.7 ? "#2ed573" : w.rate >= 0.5 ? "#448AFF" : w.rate >= 0.3 ? "#ffa502" : "#ff4757";
              return (
                <div key={w.label} className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-1.5 text-center">
                  <div className="text-[9px] uppercase tracking-wider text-[#5a6a99]">Last {w.label}</div>
                  <div className="text-sm font-black" style={{ color }}>{w.count > 0 ? `${pct}%` : "—"}</div>
                  <div className="text-[7px] text-[#5a6a99]">{w.count} rounds</div>
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 text-[9px] text-[#5a6a99]">
            <i className="fas fa-circle-info mr-1" />
            Separate windows prevent small streaks from inflating perceived accuracy.
            A few HITs do NOT prove predictive performance.
          </div>
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

        {/* ===== BONUS RISK ANALYSIS (no bonus blind spot) ===== */}
        <div className="rounded-lg border border-[#FFD700]/30 bg-[#FFD700]/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#FFD700]">
              <i className="fas fa-triangle-exclamation" /> Bonus Risk Analysis
            </span>
            {bonusActive && (
              <span className="rounded-full bg-[#ff4757]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#ff4757]">
                <i className="fas fa-circle-dot mr-0.5" /> Bonus Active
              </span>
            )}
          </div>
          {/* Coverage breakdown */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded border border-[#448AFF]/30 bg-[#448AFF]/5 p-1.5 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Normal Coverage</div>
              <div className="text-sm font-black text-[#448AFF]">{(normalOutcomeCoverage * 100).toFixed(1)}%</div>
            </div>
            <div className="rounded border border-[#FFD700]/30 bg-[#FFD700]/5 p-1.5 text-center">
              <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Bonus Coverage</div>
              <div className="text-sm font-black text-[#FFD700]">{(bonusOutcomeCoverage * 100).toFixed(1)}%</div>
            </div>
            <div className={`rounded border p-1.5 text-center ${bonusOutcomeRisk > 0.1 ? "border-[#ff4757]/40 bg-[#ff4757]/8" : "border-[#2ed573]/30 bg-[#2ed573]/5"}`}>
              <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Bonus Risk</div>
              <div className={`text-sm font-black ${bonusOutcomeRisk > 0.1 ? "text-[#ff4757]" : "text-[#2ed573]"}`}>{(bonusOutcomeRisk * 100).toFixed(1)}%</div>
            </div>
          </div>
          {/* Bonus activity stats */}
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[9px] sm:grid-cols-4">
            <div className="rounded bg-[#0d1020]/60 px-1.5 py-1 text-center">
              <div className="text-[#5a6a99]">Bonus Recent</div>
              <div className="font-bold text-white">{(bonusRecentRate * 100).toFixed(1)}%</div>
            </div>
            <div className="rounded bg-[#0d1020]/60 px-1.5 py-1 text-center">
              <div className="text-[#5a6a99]">Bonus Long-Term</div>
              <div className="font-bold text-white">{(bonusLongTermRate * 100).toFixed(1)}%</div>
            </div>
            <div className="rounded bg-[#0d1020]/60 px-1.5 py-1 text-center">
              <div className="text-[#5a6a99]">Trend</div>
              <div className={`font-bold ${bonusTrend > 0 ? "text-[#ff4757]" : bonusTrend < 0 ? "text-[#2ed573]" : "text-[#5a6a99]"}`}>
                {bonusTrend > 0 ? "↑" : bonusTrend < 0 ? "↓" : "→"} {Math.abs(bonusTrend * 100).toFixed(1)}%
              </div>
            </div>
            <div className="rounded bg-[#0d1020]/60 px-1.5 py-1 text-center">
              <div className="text-[#5a6a99]">Clusters</div>
              <div className="font-bold text-white">{bonusBursts}</div>
            </div>
          </div>
          {/* Total coverage bar */}
          <div className="mt-2">
            <div className="mb-0.5 flex items-center justify-between text-[9px]">
              <span className="text-[#5a6a99]">Total Prediction Coverage</span>
              <span className="font-bold text-[#2ed573]">{(totalPredictionCoverage * 100).toFixed(1)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#1e2240]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${totalPredictionCoverage * 100}%`,
                  background: "linear-gradient(90deg,#448AFF,#FFD700,#2ed573)",
                }}
              />
            </div>
          </div>
          <div className="mt-1.5 text-[9px] text-[#8899cc]">
            <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
            <b className="text-white">No bonus blind spot:</b> ALL 8 outcomes (numbers + bonuses) are scored
            equally. If bonus evidence is strong, a bonus CAN enter the Top-4 — no
            fixed [1,2,5,10]. Bonus risk = probability of MISS from excluded bonus outcomes.
          </div>

          {/* ===== Excluded Risk Breakdown ===== */}
          <div className="mt-2 rounded-lg border border-[#ff4757]/20 bg-[#0d1020]/40 p-2">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              Excluded Risk Breakdown (MISS exposure)
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded bg-[#448AFF]/5 px-1.5 py-1 text-center">
                <div className="text-[8px] text-[#5a6a99]">Excl. Normal</div>
                <div className="text-[11px] font-bold text-[#448AFF]">{(excludedNormalRisk * 100).toFixed(1)}%</div>
              </div>
              <div className="rounded bg-[#FFD700]/5 px-1.5 py-1 text-center">
                <div className="text-[8px] text-[#5a6a99]">Excl. Bonus</div>
                <div className="text-[11px] font-bold text-[#FFD700]">{(excludedBonusRisk * 100).toFixed(1)}%</div>
              </div>
              <div className="rounded bg-[#ff4757]/8 px-1.5 py-1 text-center">
                <div className="text-[8px] text-[#5a6a99]">Total Exposure</div>
                <div className="text-[11px] font-bold text-[#ff4757]">{(totalMissExposure * 100).toFixed(1)}%</div>
              </div>
            </div>
          </div>

          {/* ===== Normal vs Bonus Result Performance Validation ===== */}
          <div className="mt-2 rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-2">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              Result-Type Performance (reveals genuine improvement)
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {/* Normal results */}
              <div className="rounded border border-[#448AFF]/30 bg-[#448AFF]/5 p-1.5">
                <div className="mb-0.5 text-[8px] font-bold uppercase text-[#448AFF]">Normal Results</div>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-[#2ed573]">HIT {Math.round(normalResultHitRate * 100)}%</span>
                  <span className="text-[#ff4757]">MISS {Math.round(normalResultMissRate * 100)}%</span>
                </div>
                <div className="text-[7px] text-[#5a6a99]">n={normalResultCount} rounds</div>
              </div>
              {/* Bonus results */}
              <div className="rounded border border-[#FFD700]/30 bg-[#FFD700]/5 p-1.5">
                <div className="mb-0.5 text-[8px] font-bold uppercase text-[#FFD700]">Bonus Results</div>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-[#2ed573]">HIT {Math.round(bonusResultHitRate * 100)}%</span>
                  <span className="text-[#ff4757]">MISS {Math.round(bonusResultMissRate * 100)}%</span>
                </div>
                <div className="text-[7px] text-[#5a6a99]">n={bonusResultCount} rounds</div>
              </div>
            </div>
            <div className="mt-1 text-[8px] text-[#5a6a99]">
              <i className="fas fa-circle-info mr-0.5" />
              Reveals whether the model genuinely improves or merely selects high-frequency numbers.
              Low bonus-result HIT rate = bonus blind spot persists.
            </div>
          </div>

          {/* ===== Per-Bonus Performance Tracking ===== */}
          <div className="mt-2 rounded-lg border border-[#FFD700]/20 bg-[#0d1020]/40 p-2">
            <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              Per-Bonus Performance (Predicted / Actual / HIT / MISS)
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {["COIN FLIP", "CASH HUNT", "PACHINKO", "CRAZY TIME"].map((bonusName) => {
                const p = perBonusPerformance[bonusName];
                if (!p) return null;
                return (
                  <div
                    key={bonusName}
                    className={`rounded border p-1.5 ${
                      p.underrepresented
                        ? "border-[#ff4757]/40 bg-[#ff4757]/8"
                        : "border-[#1e2240] bg-[#0d1020]/60"
                    }`}
                  >
                    <div className="text-[8px] font-bold uppercase text-[#FFD700]">{bonusName}</div>
                    <div className="mt-0.5 grid grid-cols-2 gap-0.5 text-[8px]">
                      <div className="text-[#5a6a99]">Pred: <span className="font-bold text-white">{p.predictedCount}</span></div>
                      <div className="text-[#5a6a99]">Act: <span className="font-bold text-white">{p.actualCount}</span></div>
                      <div className="text-[#2ed573]">HIT: <span className="font-bold">{p.hitCount}</span></div>
                      <div className="text-[#ff4757]">MISS: <span className="font-bold">{p.missCount}</span></div>
                    </div>
                    {p.underrepresented && (
                      <div className="mt-0.5 text-[7px] font-bold uppercase text-[#ff4757]">
                        ⚠ Under-predicted
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ===== Model-Bias Warning ===== */}
          {modelBiasWarning && (
            <div className="mt-2 rounded-lg border border-[#ff4757]/40 bg-[#ff4757]/10 p-2.5">
              <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#ff4757]">
                <i className="fas fa-triangle-exclamation" /> Model Bias Detected
              </div>
              <div className="text-[10px] text-[#bcc6e0]">{modelBiasNote}</div>
            </div>
          )}
          {bonusUnderrepresented && !modelBiasWarning && (
            <div className="mt-2 rounded-lg border border-[#ffa502]/30 bg-[#ffa502]/8 p-2.5">
              <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#ffa502]">
                <i className="fas fa-circle-exclamation" /> Bonus Underrepresentation
              </div>
              <div className="text-[10px] text-[#bcc6e0]">{bonusUnderrepresentationNote}</div>
            </div>
          )}

          {/* ===== Calibration Check (per-outcome, sample-size aware) ===== */}
          <div className="mt-2 rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
                Calibration Check (per-outcome)
              </span>
              <span className="text-[8px] text-[#5a6a99]">NO reactive correction — diagnostic only</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {["COIN FLIP", "CASH HUNT", "PACHINKO", "CRAZY TIME"].map((bonusName) => {
                const sb = perBonusSelectionBias[bonusName];
                if (!sb) return null;
                return (
                  <div
                    key={bonusName}
                    className={`rounded border p-1.5 ${
                      sb.overSelected
                        ? "border-[#ff4757]/40 bg-[#ff4757]/8"
                        : sb.underSelected
                          ? "border-[#ffa502]/40 bg-[#ffa502]/8"
                          : "border-[#1e2240] bg-[#0d1020]/60"
                    }`}
                  >
                    <div className="text-[8px] font-bold uppercase text-[#FFD700]">{bonusName}</div>
                    <div className="mt-0.5 text-[8px] text-[#5a6a99]">
                      Incl: <span className="font-bold text-white">{Math.round(sb.inclusionRate * 100)}%</span>
                    </div>
                    <div className="text-[8px] text-[#5a6a99]">
                      Base: <span className="text-[#448AFF]">{Math.round(sb.baseProbability * 100)}%</span>
                      {" "}Obs: <span className="text-[#00d4ff]">{Math.round(sb.observedRate * 100)}%</span>
                    </div>
                    <div className="text-[7px] text-[#5a6a99]">
                      HIT:{sb.hitContribution} MISS:{sb.missContribution}
                    </div>
                    <div className="mt-0.5 text-[7px] font-bold text-[#5a6a99]">{sb.calibrationTier}</div>
                    {sb.overSelected && (
                      <div className="mt-0.5 text-[7px] font-bold uppercase text-[#ff4757]">⚠ Over-selected</div>
                    )}
                    {sb.underSelected && (
                      <div className="mt-0.5 text-[7px] font-bold uppercase text-[#ffa502]">⚠ Under-selected</div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Calibration tier note (sample-size aware) */}
            <div className="mt-1.5 text-[8px] text-[#5a6a99]">
              <i className="fas fa-circle-info mr-0.5" />
              {selectionBiasNote}
            </div>
            {selectionBiasWarning && (
              <div className="mt-1 rounded border border-[#ff4757]/30 bg-[#ff4757]/8 px-2 py-1 text-[9px] text-[#ff4757]">
                <i className="fas fa-triangle-exclamation mr-1" />
                {selectionBiasNote}
              </div>
            )}
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

        {/* ===== PERFORMANCE LEDGER (REAL OUT-OF-SAMPLE) ===== */}
        <PerformanceLedger
          rounds={rh}
          totalRounds={totalRounds}
          hits={hits}
          misses={misses}
          hitRate={predictionHitRate}
          normalResultHitRate={normalResultHitRate}
          bonusResultHitRate={bonusResultHitRate}
          normalResultCount={normalResultCount}
          bonusResultCount={bonusResultCount}
          recent5={recent5HitRate}
          recent10={recent10HitRate}
          recent20={recent20HitRate}
          recent50={recent50HitRate}
          recent100={recent100HitRate}
          signalWise={signalWiseHitRate}
        />

      </div>
    </div>
  );
}

// ============================================================
// PERFORMANCE LEDGER — REAL OUT-OF-SAMPLE VALIDATION
// ============================================================
function PerformanceLedger({
  rounds,
  totalRounds,
  hits,
  misses,
  hitRate,
  normalResultHitRate,
  bonusResultHitRate,
  normalResultCount,
  bonusResultCount,
  recent5,
  recent10,
  recent20,
  recent50,
  recent100,
  signalWise,
}: {
  rounds: import("./decisionEngine").RoundResult[];
  totalRounds: number;
  hits: number;
  misses: number;
  hitRate: number;
  normalResultHitRate: number;
  bonusResultHitRate: number;
  normalResultCount: number;
  bonusResultCount: number;
  recent5: number;
  recent10: number;
  recent20: number;
  recent50: number;
  recent100: number;
  signalWise: Record<string, { predicted: number; hit: number; rate: number; wilsonLower: number }>;
}) {
  // Compute per-outcome actual counts
  const actualCounts: Record<string, number> = {};
  for (const g of ENGINE_GAMES) actualCounts[g.name] = 0;
  for (const r of rounds) {
    actualCounts[r.actualResult.name] = (actualCounts[r.actualResult.name] ?? 0) + 1;
  }

  const isRealData = totalRounds > 0;
  const minSample = 100;
  const isMinMet = totalRounds >= minSample;

  return (
    <div className="mt-4 rounded-lg border-2 border-[#00d4ff]/30 bg-[#0d1020]/60 p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#00d4ff]">
          <i className="fas fa-clipboard-list" /> Performance Ledger
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${isRealData ? "bg-[#2ed573]/15 text-[#2ed573]" : "bg-[#5a6a99]/15 text-[#5a6a99]"}`}>
            {isRealData ? "● REAL OUT-OF-SAMPLE" : "○ WAITING FOR DATA"}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${isMinMet ? "bg-[#2ed573]/15 text-[#2ed573]" : "bg-[#ffa502]/15 text-[#ffa502]"}`}>
            N={totalRounds}/{minSample}
          </span>
        </div>
      </div>

      {!isRealData ? (
        <div className="py-6 text-center text-sm text-[#5a6a99]">
          <i className="fas fa-hourglass-half mb-2 text-2xl text-[#5a6a99]" />
          <div>No real out-of-sample data yet.</div>
          <div className="text-[10px] mt-1">Predictions will be recorded as live results arrive.</div>
        </div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-2 text-center">
              <div className="text-lg font-black text-white">{totalRounds}</div>
              <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Total Predictions</div>
            </div>
            <div className="rounded border border-[#2ed573]/30 bg-[#2ed573]/8 p-2 text-center">
              <div className="text-lg font-black text-[#2ed573]">{hits}</div>
              <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">HIT</div>
            </div>
            <div className="rounded border border-[#ff4757]/30 bg-[#ff4757]/8 p-2 text-center">
              <div className="text-lg font-black text-[#ff4757]">{misses}</div>
              <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">MISS</div>
            </div>
            <div className="rounded border border-[#00d4ff]/30 bg-[#00d4ff]/8 p-2 text-center">
              <div className="text-lg font-black text-[#00d4ff]">{Math.round(hitRate * 100)}%</div>
              <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">Hit Rate</div>
            </div>
          </div>

          {/* Rolling windows */}
          <div className="mb-3 grid grid-cols-5 gap-1.5">
            {[
              { label: "Last 5", rate: recent5, count: Math.min(totalRounds, 5) },
              { label: "Last 10", rate: recent10, count: Math.min(totalRounds, 10) },
              { label: "Last 25", rate: recent20, count: Math.min(totalRounds, 25) },
              { label: "Last 50", rate: recent50, count: Math.min(totalRounds, 50) },
              { label: "Last 100", rate: recent100, count: Math.min(totalRounds, 100) },
            ].map((w) => {
              const pct = w.count > 0 ? Math.round(w.rate * 100) : null;
              const color = pct === null ? "#5a6a99" : pct >= 60 ? "#2ed573" : pct >= 40 ? "#448AFF" : "#ffa502";
              return (
                <div key={w.label} className="rounded border border-[#1e2240] bg-[#0d1020]/60 p-1.5 text-center">
                  <div className="text-[8px] uppercase tracking-wider text-[#5a6a99]">{w.label}</div>
                  <div className="text-sm font-black" style={{ color }}>{pct !== null ? `${pct}%` : "—"}</div>
                  <div className="text-[7px] text-[#5a6a99]">n={w.count}</div>
                </div>
              );
            })}
          </div>

          {/* Normal vs Bonus result HIT rate */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded border border-[#448AFF]/30 bg-[#448AFF]/5 p-2">
              <div className="text-[9px] font-bold uppercase text-[#448AFF]">Normal Results</div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-sm font-black text-[#2ed573]">{normalResultCount > 0 ? `${Math.round(normalResultHitRate * 100)}%` : "—"}</span>
                <span className="text-[8px] text-[#5a6a99]">n={normalResultCount}</span>
              </div>
            </div>
            <div className="rounded border border-[#FFD700]/30 bg-[#FFD700]/5 p-2">
              <div className="text-[9px] font-bold uppercase text-[#FFD700]">Bonus Results</div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-sm font-black text-[#2ed573]">{bonusResultCount > 0 ? `${Math.round(bonusResultHitRate * 100)}%` : "—"}</span>
                <span className="text-[8px] text-[#5a6a99]">n={bonusResultCount}</span>
              </div>
            </div>
          </div>

          {/* Per-outcome ledger table */}
          <div className="overflow-x-auto revo-scroll">
            <table className="w-full min-w-[800px] text-center text-[9px]">
              <thead>
                <tr className="border-b border-[#1e2240] bg-[#0d1020]/60">
                  <th className="px-1.5 py-2 text-left">Outcome</th>
                  <th className="px-1.5 py-2">Predicted</th>
                  <th className="px-1.5 py-2">Actual</th>
                  <th className="px-1.5 py-2">HIT</th>
                  <th className="px-1.5 py-2">MISS</th>
                  <th className="px-1.5 py-2">Sel Rate</th>
                  <th className="px-1.5 py-2">Act Rate</th>
                  <th className="px-1.5 py-2">Precision</th>
                  <th className="px-1.5 py-2">Recall</th>
                </tr>
              </thead>
              <tbody>
                {ENGINE_GAMES.map((g) => {
                  const sw = signalWise[g.name];
                  const actual = actualCounts[g.name] ?? 0;
                  const selRate = totalRounds > 0 ? sw.predicted / totalRounds : 0;
                  const actRate = totalRounds > 0 ? actual / totalRounds : 0;
                  // Precision = HIT / Predicted (of all times predicted, how often correct)
                  const precision = sw.predicted > 0 ? sw.hit / sw.predicted : 0;
                  // Recall = HIT / Actual (of all times it was the actual result, how often predicted)
                  const recall = actual > 0 ? sw.hit / actual : 0;
                  return (
                    <tr key={g.name} className="border-b border-[#1e2240]/40 hover:bg-white/[0.02]">
                      <td className="px-1.5 py-1.5 text-left">
                        <span className={`font-bold ${g.isBonus ? "text-[#FFD700]" : "text-white"}`}>
                          {g.name}
                        </span>
                        {g.isBonus && <span className="ml-0.5 text-[7px] text-[#FFD700]">★</span>}
                      </td>
                      <td className="px-1.5 py-1.5 text-[#448AFF]">{sw.predicted}</td>
                      <td className="px-1.5 py-1.5 text-[#00d4ff]">{actual}</td>
                      <td className="px-1.5 py-1.5 text-[#2ed573]">{sw.hit}</td>
                      <td className="px-1.5 py-1.5 text-[#ff4757]">{actual - sw.hit}</td>
                      <td className="px-1.5 py-1.5 text-[#8899cc]">{(selRate * 100).toFixed(1)}%</td>
                      <td className="px-1.5 py-1.5 text-[#8899cc]">{(actRate * 100).toFixed(1)}%</td>
                      <td className="px-1.5 py-1.5 text-[#2ed573]">{sw.predicted > 0 ? `${(precision * 100).toFixed(0)}%` : "—"}</td>
                      <td className="px-1.5 py-1.5 text-[#448AFF]">{actual > 0 ? `${(recall * 100).toFixed(0)}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Sample-size warning */}
          {!isMinMet && (
            <div className="mt-2 rounded-lg border border-[#ffa502]/30 bg-[#ffa502]/8 p-2.5 text-[10px] text-[#ffa502]">
              <i className="fas fa-triangle-exclamation mr-1" />
              <b>INSUFFICIENT SAMPLE:</b> {totalRounds}/{minSample} real rounds completed.
              Minimum 100 rounds required for meaningful calibration assessment.
              Do NOT interpret current hit rate as proof of model accuracy.
            </div>
          )}

          {/* Data integrity notice */}
          <div className="mt-2 text-[8px] text-[#5a6a99]">
            <i className="fas fa-shield-halved mr-1 text-[#2ed573]" />
            <b>REAL OUT-OF-SAMPLE:</b> Each prediction was LOCKED before the actual result arrived.
            No data leakage. No retrospective modification. No reactive correction.
            Result entered history only AFTER HIT/MISS was recorded.
          </div>
        </>
      )}
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
// WHEEL BASE-PROBABILITY MODEL PANEL (54 segments)
// ============================================================
function WheelProbabilityPanel({ candidateScores }: { candidateScores: CandidateScore[] }) {
  // Sort by final AI score descending (same as evidence ranking)
  const sorted = [...candidateScores].sort((a, b) => b.finalAIScore - a.finalAIScore);
  const totalCoverage = sorted.slice(0, 4).reduce((s, c) => s + c.basePrior, 0);
  // Top-4 expected coverage (sum of calibrated probabilities of selected 4)
  const top4CalProb = sorted.slice(0, 4).reduce((s, c) => {
    const cp = (c as CandidateScore & { calibratedProbability?: number }).calibratedProbability;
    return s + (cp ?? 0);
  }, 0);

  return (
    <div className="revo-card mt-4 overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#FFD700]/10 to-transparent px-4 py-3">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-circle-nodes text-[#FFD700]" /> Wheel Base-Probability Model
        </span>
        <span className="rounded-full bg-[#FFD700]/15 px-2 py-0.5 text-[9px] font-bold uppercase text-[#FFD700]">
          {WHEEL_TOTAL_SEGMENTS} segments
        </span>
      </div>

      <div className="space-y-3 p-4">
        {/* Header explanation */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-2.5 text-[10px] text-[#8899cc]">
          <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
          <b className="text-white">54-segment wheel = BASE PRIOR.</b>{" "}
          Live data = EVIDENCE. AI combines both. Base probability is NEVER used
          directly as a live prediction — only as the prior for evidence combination.
          <b className="text-[#FFD700]"> 83.33% coverage ≠ 83.33% accuracy.</b>
        </div>

        {/* Per-outcome breakdown table — ALL 8 outcomes with full debug fields */}
        <div className="overflow-x-auto revo-scroll">
          <table className="w-full min-w-[1100px] text-center text-[9px]">
            <thead>
              <tr className="border-b border-[#1e2240] bg-[#0d1020]/60">
                <th className="px-1.5 py-2 text-left">Outcome</th>
                <th className="px-1.5 py-2">Prior</th>
                <th className="px-1.5 py-2">N</th>
                <th className="px-1.5 py-2">Smoothed</th>
                <th className="px-1.5 py-2">Stab. Dev</th>
                <th className="px-1.5 py-2">Log Ev</th>
                <th className="px-1.5 py-2">Cal. Prob</th>
                <th className="px-1.5 py-2">Final</th>
                <th className="px-1.5 py-2">Rank</th>
                <th className="px-1.5 py-2">Sel</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c, i) => {
                const isTop4 = i < 4;
                const stabDevPct = (c.stabilizedDeviation * 100);
                const stabColor = stabDevPct > 5 ? "#2ed573" : stabDevPct < -5 ? "#ff4757" : "#5a6a99";
                const calProb = (c as CandidateScore & { calibratedProbability?: number }).calibratedProbability;
                const logEv = (c as CandidateScore & { logEvidence?: number }).logEvidence;
                return (
                  <tr
                    key={c.game.name}
                    className={`border-b border-[#1e2240]/40 ${isTop4 ? "bg-[#2ed573]/5" : "hover:bg-white/[0.02]"}`}
                  >
                    <td className="px-1.5 py-1.5 text-left">
                      <span className={`font-bold ${c.game.isBonus ? "text-[#FFD700]" : "text-white"}`}>
                        {c.game.name}
                      </span>
                      {c.game.isBonus && <span className="ml-0.5 text-[7px] text-[#FFD700]">★</span>}
                    </td>
                    <td className="px-1.5 py-1.5 text-[#448AFF]">{(c.basePrior * 100).toFixed(1)}%</td>
                    <td className="px-1.5 py-1.5 text-[#5a6a99]">{c.sampleN}</td>
                    <td className="px-1.5 py-1.5 text-[#8899cc]">{(c.smoothedFrequency * 100).toFixed(1)}%</td>
                    <td className="px-1.5 py-1.5" style={{ color: stabColor }}>
                      {stabDevPct > 0 ? "+" : ""}{stabDevPct.toFixed(0)}%
                    </td>
                    <td className="px-1.5 py-1.5 text-[#a78bfa]">{logEv !== undefined ? logEv.toFixed(3) : "—"}</td>
                    <td className="px-1.5 py-1.5 text-[#00d4ff]">{calProb !== undefined ? `${(calProb * 100).toFixed(1)}%` : "—"}</td>
                    <td className="px-1.5 py-1.5 font-black text-[#2ed573]">{(c.finalAIScore * 100).toFixed(2)}</td>
                    <td className="px-1.5 py-1.5">
                      <span className={`grid h-4 w-4 place-items-center rounded-full text-[7px] font-black ${
                        i === 0 ? "bg-[#2ed573] text-white"
                          : i === 1 ? "bg-[#448AFF] text-white"
                          : i === 2 ? "bg-[#FFD700] text-black"
                          : i === 3 ? "bg-[#00d4ff] text-black"
                          : "bg-[#1e2240] text-[#5a6a99]"
                      }`}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-1.5 py-1.5">
                      {isTop4 ? (
                        <i className="fas fa-check text-[10px] text-[#2ed573]" />
                      ) : (
                        <i className="fas fa-xmark text-[10px] text-[#5a6a99]" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 70-Combination Optimizer result */}
        <div className="rounded-lg border border-[#a78bfa]/20 bg-[#a78bfa]/5 p-3">
          <div className="mb-1 flex items-center justify-between text-[10px]">
            <span className="font-bold uppercase tracking-wider text-[#5a6a99]">
              70-Combination Optimizer (C(8,4) = 70)
            </span>
            <span className="font-black text-[#a78bfa]">
              Top-4 Expected Coverage: {(top4CalProb * 100).toFixed(1)}%
            </span>
          </div>
          <div className="text-[9px] text-[#5a6a99]">
            <i className="fas fa-circle-info mr-1" />
            All 70 possible 4-outcome combinations evaluated. Best subset selected by
            highest sum of calibrated probabilities (mutually exclusive: P = P(A)+P(B)+P(C)+P(D)).
          </div>
        </div>

        {/* Theoretical coverage bar */}
        <div className="rounded-lg border border-[#1e2240] bg-[#0d1020]/40 p-3">
          <div className="mb-1 flex items-center justify-between text-[10px]">
            <span className="font-bold uppercase tracking-wider text-[#5a6a99]">
              Theoretical Coverage (Top-4 by base prior)
            </span>
            <span className="font-black text-[#FFD700]">{(totalCoverage * 100).toFixed(2)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#1e2240]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${totalCoverage * 100}%`,
                background: "linear-gradient(90deg,#448AFF,#FFD700,#2ed573)",
              }}
            />
          </div>
          <div className="mt-1 text-[9px] text-[#5a6a99]">
            <i className="fas fa-triangle-exclamation mr-1 text-[#ffa502]" />
            <b>83.33% coverage ≠ 83.33% accuracy.</b> Theoretical wheel coverage is a
            mathematical baseline — NOT a guaranteed prediction accuracy. Each spin is
            independent RNG.
          </div>
        </div>

        {/* RTP disclaimer */}
        <div className="rounded-lg border border-[#ff4757]/20 bg-[#ff4757]/5 p-2.5 text-[10px] text-[#8899cc]">
          <i className="fas fa-ban mr-1 text-[#ff4757]" />
          <b className="text-[#ff4757]">RTP rule:</b> RTP is a long-term payout/return statistic.
          RTP ≠ next-spin probability. Next-result probability uses wheel segment distribution
          as the base prior — NOT RTP.
        </div>

        {/* Sample-size protection */}
        <div className="rounded-lg border border-[#448AFF]/20 bg-[#448AFF]/5 p-2.5 text-[10px] text-[#8899cc]">
          <i className="fas fa-shield-halved mr-1 text-[#448AFF]" />
          <b className="text-[#448AFF]">Sample-size protection:</b> Small-sample deviations are
          NOT treated as real probability shifts. E.g., CRAZY TIME (1.85% base) appearing 2-3×
          in a small sample does NOT mean its probability permanently increased. Sufficient
          evidence is required before any major probability adjustment.
        </div>
      </div>
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

// ============================================================
// ROUND-BY-ROUND VALIDATION LOG (collapsible, scrollable)
// ============================================================
function RoundByRoundLog({
  ledger,
  experimentalEnabled,
}: {
  ledger: ShadowRow[];
  experimentalEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const BONUS_NAMES_LOG = ["PACHINKO", "COIN FLIP", "CASH HUNT", "CRAZY TIME"];

  if (!experimentalEnabled) return null;
  if (ledger.length === 0) {
    return (
      <div className="mt-4 rounded-lg border-2 border-[#a855f7]/20 bg-[#0d1020]/40 p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#a855f7]">
            <i className="fas fa-list" /> Round-by-Round Validation Log
          </span>
          <span className="text-[9px] text-[#5a6a99]">No rounds yet</span>
        </div>
        <div className="mt-2 text-center text-[10px] text-[#5a6a99]">
          Live rounds will appear here as they accumulate.
        </div>
      </div>
    );
  }

  const reversed = [...ledger].reverse(); // newest first

  return (
    <div className="mt-4 rounded-lg border-2 border-[#a855f7]/20 bg-[#0d1020]/40 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#a855f7]">
          <i className={`fas ${open ? "fa-chevron-down" : "fa-chevron-right"}`} />
          Round-by-Round Validation Log
        </span>
        <span className="text-[9px] text-[#5a6a99]">
          {ledger.length} round{ledger.length !== 1 ? "s" : ""} • {open ? "click to collapse" : "click to expand"}
        </span>
      </button>

      {open && (
        <div className="mt-2 max-h-96 overflow-y-auto revo-scroll space-y-1.5 pr-1">
          {reversed.map((row, i) => {
            const isFlip = row.baselineHit !== row.expHit;
            const flipType =
              !row.baselineHit && row.expHit ? "MISS_TO_HIT"
              : row.baselineHit && !row.expHit ? "HIT_TO_MISS"
              : null;

            // Compute RCA inline for highlighting
            let rca: string | null = null;
            if (isFlip && flipType === "MISS_TO_HIT") {
              const bonusBaselineHad = row.baselinePreds.filter((n) => BONUS_NAMES_LOG.includes(n) && !row.expPreds.includes(n));
              const numExpAdded = row.expPreds.filter((n) => ["1", "2", "5", "10"].includes(n) && !row.baselinePreds.includes(n));
              if (bonusBaselineHad.length > 0) {
                rca = `rare-outcome displacement correction: baseline included ${bonusBaselineHad.join(",")} which displaced a number`;
              } else if (numExpAdded.length > 0) {
                rca = `number restored: experimental included ${numExpAdded.join(",")} which baseline excluded`;
              } else {
                rca = "better combination selection";
              }
            } else if (isFlip && flipType === "HIT_TO_MISS") {
              const bonusExpDropped = row.baselinePreds.filter((n) => BONUS_NAMES_LOG.includes(n) && !row.expPreds.includes(n));
              const numExpDifferent = row.expPreds.filter((n) => ["1", "2", "5", "10"].includes(n) && !row.baselinePreds.includes(n));
              if (bonusExpDropped.length > 0) {
                rca = `reliability layer dampened ${bonusExpDropped.join(",")} evidence below selection threshold`;
              } else if (numExpDifferent.length > 0) {
                rca = `reliability layer shifted combination: experimental swapped in ${numExpDifferent.join(",")}`;
              } else {
                rca = "combination changed by reliability adjustment";
              }
            }

            return (
              <div
                key={i}
                className={`rounded border p-2 text-[9px] ${
                  isFlip
                    ? flipType === "MISS_TO_HIT"
                      ? "border-[#2ed573]/50 bg-[#2ed573]/8"
                      : "border-[#ff4757]/50 bg-[#ff4757]/8"
                    : "border-[#1e2240] bg-[#0d1020]/60"
                }`}
              >
                {/* Row header: roundId, timestamp, actual */}
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="font-black text-white">#{row.roundId}</span>
                  <span className="text-[#5a6a99]">
                    {new Date(row.ts).toLocaleTimeString(undefined, { hour12: false })}
                  </span>
                  <span className="text-[#5a6a99]">·</span>
                  <span className="text-[#8899cc]">actual:</span>
                  <span className={`font-bold ${BONUS_NAMES_LOG.includes(row.actual) ? "text-[#FFD700]" : "text-white"}`}>
                    {row.actual}
                  </span>
                  {isFlip && (
                    <span className={`rounded px-1 py-0.5 text-[8px] font-bold uppercase ${
                      flipType === "MISS_TO_HIT"
                        ? "bg-[#2ed573]/20 text-[#2ed573]"
                        : "bg-[#ff4757]/20 text-[#ff4757]"
                    }`}>
                      {flipType === "MISS_TO_HIT" ? "MISS→HIT" : "HIT→MISS"}
                    </span>
                  )}
                </div>

                {/* Baseline + Experimental columns */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {/* Baseline */}
                  <div className="rounded border border-[#00d4ff]/30 bg-[#00d4ff]/5 p-1.5">
                    <div className="mb-0.5 flex items-center justify-between">
                      <span className="text-[8px] font-bold uppercase text-[#00d4ff]">Baseline</span>
                      <span className={`rounded px-1 py-0.5 text-[7px] font-bold uppercase ${row.baselineHit ? "bg-[#2ed573]/20 text-[#2ed573]" : "bg-[#ff4757]/20 text-[#ff4757]"}`}>
                        {row.baselineHit ? "HIT" : "MISS"}
                      </span>
                    </div>
                    <div className="text-[#8899cc]">
                      <span className="text-[#00d4ff]">[{row.baselinePreds.join(",")}]</span>
                      <span className="ml-1 text-[#5a6a99]">cov {(row.baselineCoverage * 100).toFixed(1)}%</span>
                    </div>
                    {/* mini bar of all 8 probs */}
                    <ProbBar probs={row.baselineProbs} selected={row.baselinePreds} color="#00d4ff" />
                  </div>

                  {/* Experimental */}
                  <div className="rounded border border-[#a855f7]/30 bg-[#a855f7]/5 p-1.5">
                    <div className="mb-0.5 flex items-center justify-between">
                      <span className="text-[8px] font-bold uppercase text-[#a855f7]">Experimental</span>
                      <span className={`rounded px-1 py-0.5 text-[7px] font-bold uppercase ${row.expHit ? "bg-[#2ed573]/20 text-[#2ed573]" : "bg-[#ff4757]/20 text-[#ff4757]"}`}>
                        {row.expHit ? "HIT" : "MISS"}
                      </span>
                    </div>
                    <div className="text-[#8899cc]">
                      <span className="text-[#a855f7]">[{row.expPreds.join(",")}]</span>
                      <span className="ml-1 text-[#5a6a99]">cov {(row.expCoverage * 100).toFixed(1)}%</span>
                    </div>
                    {/* mini bar of all 8 probs */}
                    <ProbBar probs={row.expProbs} selected={row.expPreds} color="#a855f7" />
                  </div>
                </div>

                {/* Theoretical row + RCA */}
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[#5a6a99]">Theo [1,2,5,10]:</span>
                  <span className={`rounded px-1 py-0.5 text-[7px] font-bold uppercase ${row.theoHit ? "bg-[#2ed573]/20 text-[#2ed573]" : "bg-[#ff4757]/20 text-[#ff4757]"}`}>
                    {row.theoHit ? "HIT" : "MISS"}
                  </span>
                  {rca && (
                    <span className="italic text-[#ffa502]">↳ {rca}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Mini horizontal bar showing all 8 calibrated probabilities, with the
 *  selected Top-4 outcomes highlighted. */
function ProbBar({
  probs,
  selected,
  color,
}: {
  probs: Record<string, number>;
  selected: string[];
  color: string;
}) {
  const ordered = ENGINE_GAMES.map((g) => ({ name: g.name, p: probs[g.name] ?? 0 }));
  const total = ordered.reduce((s, o) => s + o.p, 0) || 1;
  return (
    <div className="mt-1 flex h-2 w-full overflow-hidden rounded-sm bg-[#0d1020]">
      {ordered.map((o) => {
        const isSel = selected.includes(o.name);
        const w = (o.p / total) * 100;
        return (
          <div
            key={o.name}
            title={`${o.name}: ${(o.p * 100).toFixed(2)}%${isSel ? " (selected)" : ""}`}
            style={{
              width: `${w}%`,
              backgroundColor: isSel ? color : "#2a2f4d",
              opacity: isSel ? 1 : 0.4,
            }}
          />
        );
      })}
    </div>
  );
}
