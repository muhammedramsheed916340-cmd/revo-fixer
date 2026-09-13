/**
 * FROZEN FRESH-ROUND SHADOW A/B VALIDATION COLLECTOR
 * ===================================================
 *
 * Collects genuinely NEW paired rounds from the live Crazy Time feed and runs
 * BOTH engines on each round — baseline (ALL_FLAGS_OFF) vs experimental
 * (C1–C7 ALL_FLAGS_ON) — with NO data leakage (each prediction is computed
 * from history BEFORE that round's actual arrives), ONE settlement per round,
 * and FROZEN flags for the entire run (no mid-test tuning).
 *
 * Per the directive:
 *   - Do NOT use the previous 178 diagnostic rounds (cold-start: only count
 *     spins that settle AFTER the collector starts).
 *   - Do NOT tune parameters during the test.
 *   - Do NOT modify production prediction behavior (this is a separate
 *     process — the live UI is untouched).
 *   - Do NOT stop early because of a good streak.
 *   - If the feed is invalid/stalled, PAUSE rather than altering the engine.
 *
 * Output:
 *   - scripts/data/frozen_validation_rounds.jsonl  (one JSON row per round)
 *   - scripts/data/frozen_validation_actuals.json  (just the names array)
 *   - scripts/data/frozen_validation_state.json    (collector state for resume)
 *
 * Auto-stops at TARGET_ROUNDS (200) or on feed stall (> STALL_TIMEOUT_MS).
 */
import { writeFileSync, readFileSync, existsSync, appendFileSync } from "fs";
import { buildInitial, ALL_FLAGS_OFF, MODEL_VERSION, type FeatureFlags, type RoundResult, type GameModel } from "../../src/components/revo/decisionEngine";

// ===== CONFIG (FROZEN — do not change during the run) =====
const TARGET_ROUNDS = 200;
const MIN_ROUNDS = 100;
const POLL_INTERVAL_MS = 20_000;       // poll every 20s (spins arrive ~every 44s)
const STALL_TIMEOUT_MS = 10 * 60_000;  // 10 min with no new spin = stall → stop
const FEED_URL = "http://localhost:3000/api/crazy-time?type=recent&size=30";
const ROUNDS_FILE = "scripts/data/frozen_validation_rounds.jsonl";
const ACTUALS_FILE = "scripts/data/frozen_validation_actuals.json";
const STATE_FILE = "scripts/data/frozen_validation_state.json";

// The experimental arm: ALL C1–C7 flags ON (the approved experimental channel).
const EXPERIMENTAL_FLAGS: FeatureFlags = {
  c1_calibratedChannel: true,
  c2_genericReliability: true,
  c3_uncertaintyShrinkage: true,
  c4_realOptimizer: true,
  c5_deScopeHarmful: true,
  c6_rcaInstrumentation: true,
  c7_frozenWalkForward: true,
};

// Map the CasinoScores wheelSector to the engine's game name (mirrors
// SPIN_TO_GAME_NAME in decisionEngine.ts — kept local to avoid importing
// the non-exported const).
const SECTOR_TO_GAME: Record<string, string> = {
  "1": "1", "2": "2", "5": "5", "10": "10",
  CoinFlip: "COIN FLIP",
  Pachinko: "PACHINKO",
  CashHunt: "CASH HUNT",
  CrazyTime: "CRAZY TIME",
  CrazyBonus: "CRAZY TIME",
};
const BONUS_NAMES = ["PACHINKO", "COIN FLIP", "CASH HUNT", "CRAZY TIME"];
const GAME_BY_NAME: Record<string, GameModel> = {}; // filled from GAMES at init

interface SpinRecord {
  id: string;            // outer id (unique per spin)
  dataId: string;        // inner data.id
  startedAt: string;
  settledAt: string;
  sector: string;        // raw wheelSector
  gameName: string;      // mapped engine name
}

interface RoundRow {
  roundId: number;            // 1-based sequential validation round
  spinId: string;             // unique feed id
  dataId: string;
  startedAt: string;
  settledAt: string;
  timestamp: number;         // collector wall-clock when settled
  actualResult: string;      // engine game name
  baselineTop4: string[];
  experimentalTop4: string[];
  baselineHit: boolean;
  experimentalHit: boolean;
  theoreticalHit: boolean;    // [1,2,5,10]
  selectedBonusCount: { baseline: number; experimental: number };
  excludedFifth: { baseline: string; experimental: string };
  modelVersion: string;
  featureFlags: { baseline: FeatureFlags; experimental: FeatureFlags };
  duplicateCheck: { isDuplicate: boolean; seenIdsBefore: number };
  leakageCheck: { historyLengthBefore: number; predictionComputedBeforeSettle: boolean };
}

interface CollectorState {
  startedAt: number;
  lastPollAt: number;
  lastNewRoundAt: number;
  roundsCollected: number;
  seenIds: string[];        // all spin ids ever seen (capped to last 500)
  actualNames: string[];    // accumulated actuals (walk-forward history)
  status: "running" | "stopped_target" | "stopped_stall" | "stopped_error" | "stopped_manual";
  stopReason: string;
}

function loadState(): CollectorState {
  if (existsSync(STATE_FILE)) {
    try {
      const s = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as CollectorState;
      if (s && Array.isArray(s.actualNames) && Array.isArray(s.seenIds)) return s;
    } catch { /* fall through to fresh */ }
  }
  return {
    startedAt: Date.now(),
    lastPollAt: 0,
    lastNewRoundAt: Date.now(),
    roundsCollected: 0,
    seenIds: [],
    actualNames: [],
    status: "running",
    stopReason: "",
  };
}

function saveState(s: CollectorState) {
  // Cap seenIds to last 500 to bound memory.
  if (s.seenIds.length > 500) s.seenIds = s.seenIds.slice(-500);
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  appendFileSync("scripts/data/frozen_validation_collector.log", line + "\n");
}

/** Fetch the latest spins from the feed. Returns newest-first array. */
async function fetchSpins(): Promise<SpinRecord[]> {
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  const data = (await res.json()) as Array<{
    id: string;
    data: {
      id: string;
      startedAt: string;
      settledAt: string;
      status: string;
      result?: { outcome?: { wheelResult?: { wheelSector: string } } };
    };
  }>;
  const spins: SpinRecord[] = [];
  for (const item of data) {
    const sector = item.data?.result?.outcome?.wheelResult?.wheelSector;
    if (!sector) continue; // skip unresolved spins
    const gameName = SECTOR_TO_GAME[sector] ?? sector;
    spins.push({
      id: item.id,
      dataId: item.data?.id ?? item.id,
      startedAt: item.data?.startedAt ?? "",
      settledAt: item.data?.settledAt ?? "",
      sector,
      gameName,
    });
  }
  return spins; // feed is newest-first
}

/** Run both engines on the current history (BEFORE the actual arrives) and
 *  return the paired prediction. No leakage: history does not include the
 *  round being predicted. */
function runBothEngines(history: RoundResult[]): {
  baselineTop4: string[]; experimentalTop4: string[];
  baselineExcludedFifth: string; experimentalExcludedFifth: string;
} {
  // Baseline: ALL_FLAGS_OFF (bit-for-bit production).
  const baseEng = buildInitial(history, [], "baseline", ALL_FLAGS_OFF);
  // Experimental: C1–C7 ALL_FLAGS_ON.
  const expEng = buildInitial(history, [], "baseline", EXPERIMENTAL_FLAGS);
  const baseTop4 = baseEng.predictions.map((p) => p.game.name);
  const expTop4 = expEng.predictions.map((p) => p.game.name);
  // Excluded #5 = the highest-ranked excluded outcome (rank 5).
  const baseRank5 = baseEng.candidateScores
    .filter((c) => !baseTop4.includes(c.game.name))
    .sort((a, b) => b.rawScore - a.rawScore)[0]?.game.name ?? "";
  const expRank5 = expEng.candidateScores
    .filter((c) => !expTop4.includes(c.game.name))
    .sort((a, b) => b.rawScore - a.rawScore)[0]?.game.name ?? "";
  return {
    baselineTop4: baseTop4, experimentalTop4: expTop4,
    baselineExcludedFifth: baseRank5, experimentalExcludedFifth: expRank5,
  };
}

/** Build a settled RoundResult to append to the walk-forward history. */
function makeSettledRound(actualName: string, predNames: string[], hit: boolean): RoundResult {
  const now = Date.now();
  const game = GAME_BY_NAME[actualName];
  return {
    prediction: predNames.map((n) => ({ game: GAME_BY_NAME[n], confidence: 50, time: now })),
    actualResult: game,
    hit,
    time: now,
    confidence: 50,
    recalibrated: false,
  };
}

async function main() {
  // Initialize GAMES lookup from the engine.
  const { GAMES } = await import("../../src/components/revo/decisionEngine");
  for (const g of GAMES) GAME_BY_NAME[g.name] = g;

  log("=== FROZEN VALIDATION COLLECTOR STARTING ===");
  log(`Target: ${TARGET_ROUNDS} rounds (min ${MIN_ROUNDS}). Flags: experimental = ALL C1-C7 ON.`);
  log(`Baseline = ALL_FLAGS_OFF (bit-for-bit production). Feed: ${FEED_URL}`);

  let state = loadState();
  log(`Resumed with ${state.roundsCollected} rounds already collected, ${state.seenIds.length} seen ids.`);

  // COLD-START: on the first poll, mark all current spins as "seen" so we only
  // count genuinely NEW spins (those that settle AFTER the collector starts).
  if (state.seenIds.length === 0) {
    try {
      const initial = await fetchSpins();
      state.seenIds = initial.map((s) => s.id);
      state.lastNewRoundAt = Date.now();
      saveState(state);
      log(`COLD-START: marked ${state.seenIds.length} existing spins as seen (not counted).`);
    } catch (e) {
      log(`FATAL: cold-start feed fetch failed: ${(e as Error).message}`);
      state.status = "stopped_error";
      state.stopReason = `cold-start feed failure: ${(e as Error).message}`;
      saveState(state);
      process.exit(1);
    }
  }

  // MAIN LOOP
  while (state.status === "running") {
    state.lastPollAt = Date.now();
    let spins: SpinRecord[];
    try {
      spins = await fetchSpins();
    } catch (e) {
      log(`poll error (non-fatal, will retry): ${(e as Error).message}`);
      await sleep(POLL_INTERVAL_MS);
      // Check stall based on last new round.
      if (Date.now() - state.lastNewRoundAt > STALL_TIMEOUT_MS) {
        state.status = "stopped_stall";
        state.stopReason = `feed unreachable for >${STALL_TIMEOUT_MS / 60000} min`;
        break;
      }
      continue;
    }

    // Detect NEW spins: feed is newest-first, so reverse to oldest-first for
    // in-order processing. Only count spins NOT in seenIds.
    const oldestFirst = [...spins].reverse();
    let newThisPoll = 0;
    for (const spin of oldestFirst) {
      if (state.seenIds.includes(spin.id)) continue;
      // NEW spin → run both engines on current history, settle, record.
      const seenIdsBefore = state.seenIds.length;
      const historyBefore: RoundResult[] = [];
      // Reconstruct history from actualNames (walk-forward).
      for (const name of state.actualNames) {
        historyBefore.push(makeSettledRound(name, ["1", "2", "5", "10"], ["1", "2", "5", "10"].includes(name)));
      }
      const { baselineTop4, experimentalTop4, baselineExcludedFifth, experimentalExcludedFifth } =
        runBothEngines(historyBefore);
      const actualName = spin.gameName;
      const baselineHit = baselineTop4.includes(actualName);
      const experimentalHit = experimentalTop4.includes(actualName);
      const theoreticalHit = ["1", "2", "5", "10"].includes(actualName);

      const roundId = state.roundsCollected + 1;
      const row: RoundRow = {
        roundId,
        spinId: spin.id,
        dataId: spin.dataId,
        startedAt: spin.startedAt,
        settledAt: spin.settledAt,
        timestamp: Date.now(),
        actualResult: actualName,
        baselineTop4,
        experimentalTop4,
        baselineHit,
        experimentalHit,
        theoreticalHit,
        selectedBonusCount: {
          baseline: baselineTop4.filter((n) => BONUS_NAMES.includes(n)).length,
          experimental: experimentalTop4.filter((n) => BONUS_NAMES.includes(n)).length,
        },
        excludedFifth: { baseline: baselineExcludedFifth, experimental: experimentalExcludedFifth },
        modelVersion: MODEL_VERSION,
        featureFlags: { baseline: ALL_FLAGS_OFF, experimental: EXPERIMENTAL_FLAGS },
        duplicateCheck: { isDuplicate: false, seenIdsBefore },
        leakageCheck: {
          historyLengthBefore: historyBefore.length,
          predictionComputedBeforeSettle: true, // by construction
        },
      };
      appendFileSync(ROUNDS_FILE, JSON.stringify(row) + "\n");

      // Append to walk-forward history (for the NEXT prediction).
      state.actualNames.push(actualName);
      state.roundsCollected = roundId;
      state.seenIds.push(spin.id);
      state.lastNewRoundAt = Date.now();
      newThisPoll++;

      log(`Round ${roundId}/${TARGET_ROUNDS}: actual=${actualName.padEnd(12)} base=[${baselineTop4.join(",")}] ${baselineHit ? "HIT" : "miss"}  exp=[${experimentalTop4.join(",")}] ${experimentalHit ? "HIT" : "miss"}  theo=${theoreticalHit ? "HIT" : "miss"}`);

      // Check target.
      if (state.roundsCollected >= TARGET_ROUNDS) {
        state.status = "stopped_target";
        state.stopReason = `reached target of ${TARGET_ROUNDS} rounds`;
        break;
      }
    }

    saveState(state);

    // Stall check: no new round for > STALL_TIMEOUT_MS.
    if (Date.now() - state.lastNewRoundAt > STALL_TIMEOUT_MS) {
      state.status = "stopped_stall";
      state.stopReason = `no new spins for >${STALL_TIMEOUT_MS / 60000} min`;
      break;
    }

    if (newThisPoll === 0) {
      // no new spins this poll — brief status
    }

    if (state.status !== "running") break;
    await sleep(POLL_INTERVAL_MS);
  }

  // Write final actuals.
  writeFileSync(ACTUALS_FILE, JSON.stringify(state.actualNames, null, 2));
  saveState(state);
  log(`=== COLLECTOR STOPPED: ${state.status} — ${state.stopReason} ===`);
  log(`Collected ${state.roundsCollected} paired rounds. Actuals → ${ACTUALS_FILE}`);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => {
  log(`UNHANDLED ERROR: ${(e as Error).stack}`);
  const s = loadState();
  s.status = "stopped_error";
  s.stopReason = `unhandled: ${(e as Error).message}`;
  saveState(s);
  process.exit(1);
});
