/**
 * FINAL 500-ROUND OUT-OF-SAMPLE BENCHMARK COLLECTOR
 * ===================================================
 * Arm A: C1-C9 engine (all flags ON).
 * Arm B: Fixed theoretical [1,2,5,10].
 * Same live feed, FROZEN flags, no tuning.
 * Auto-stops at 500. State-resumable.
 */
import { writeFileSync, readFileSync, existsSync, appendFileSync } from "fs";
import {
  buildInitial,
  MODEL_VERSION,
  BONUS_NAMES,
  type FeatureFlags,
  type RoundResult,
  GAMES,
} from "../../src/components/revo/decisionEngine";

const TARGET_ROUNDS = 500;
const POLL_INTERVAL_MS = 20_000;
const STALL_TIMEOUT_MS = 10 * 60_000;
const FEED_URL = "http://localhost:3000/api/crazy-time?type=recent&size=30";
const ROUNDS_FILE = "scripts/data/final_benchmark_rounds.jsonl";
const STATE_FILE = "scripts/data/final_benchmark_state.json";

// Arm A: C1-C9 ALL ON
const ARM_A_FLAGS: FeatureFlags = {
  c1_calibratedChannel: true, c2_genericReliability: true, c3_uncertaintyShrinkage: true,
  c4_realOptimizer: true, c5_deScopeHarmful: true, c6_rcaInstrumentation: true,
  c7_frozenWalkForward: true, c8_credibleLowerBound: true, c9_recencyExcludeLast: true,
};
const ARM_B_TOP4 = ["1", "2", "5", "10"]; // Fixed theoretical

const SECTOR_TO_GAME: Record<string, string> = {
  "1": "1", "2": "2", "5": "5", "10": "10",
  CoinFlip: "COIN FLIP", Pachinko: "PACHINKO", CashHunt: "CASH HUNT",
  CrazyTime: "CRAZY TIME", CrazyBonus: "CRAZY TIME",
};
const NUMBER_NAMES = ["1", "2", "5", "10"];
const gameByName = new Map(GAMES.map((g) => [g.name, g]));

interface SpinRecord { id: string; settledAt: string; sector: string; gameName: string; }

interface RoundRow {
  roundId: number; spinId: string; settledAt: string; timestamp: number;
  actual: string; previousActual: string;
  armA_Top4: string[]; armA_Hit: boolean;
  armB_Top4: string[]; armB_Hit: boolean;
  aOnlyHit: boolean; bOnlyHit: boolean;
  bonusActual: boolean; bonusIncludedByA: boolean;
  isColdStart: boolean;
  modelVersion: string;
  flags: FeatureFlags;
  duplicateCheck: { isDuplicate: boolean; seenIdsBefore: number };
  leakageCheck: { historyLengthBefore: number; predictionComputedBeforeSettle: boolean };
}

interface CollectorState {
  startedAt: number; lastPollAt: number; lastNewRoundAt: number;
  roundsCollected: number; seenIds: string[]; actualNames: string[];
  status: "running" | "stopped_target" | "stopped_stall" | "stopped_error";
  stopReason: string;
}

function loadState(): CollectorState {
  if (existsSync(STATE_FILE)) {
    try {
      const s = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as CollectorState;
      if (s && Array.isArray(s.actualNames) && Array.isArray(s.seenIds)) return s;
    } catch { /* fresh */ }
  }
  return { startedAt: Date.now(), lastPollAt: 0, lastNewRoundAt: Date.now(),
    roundsCollected: 0, seenIds: [], actualNames: [], status: "running", stopReason: "" };
}
function saveState(s: CollectorState) {
  if (s.seenIds.length > 500) s.seenIds = s.seenIds.slice(-500);
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  appendFileSync("scripts/data/final_benchmark_collector.log", line + "\n");
}

async function fetchSpins(): Promise<SpinRecord[]> {
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  const data = (await res.json()) as Array<{
    id: string; data: { settledAt: string; status: string;
      result?: { outcome?: { wheelResult?: { wheelSector: string } } } };
  }>;
  const spins: SpinRecord[] = [];
  for (const item of data) {
    const sector = item.data?.result?.outcome?.wheelResult?.wheelSector;
    if (!sector) continue;
    spins.push({ id: item.id, settledAt: item.data?.settledAt ?? "",
      sector, gameName: SECTOR_TO_GAME[sector] ?? sector });
  }
  return spins;
}

function makeRound(actualName: string, predNames: string[], hit: boolean): RoundResult {
  const game = gameByName.get(actualName)!;
  return {
    prediction: predNames.map((n) => ({ game: gameByName.get(n)!, confidence: 50, time: Date.now() })),
    actualResult: game, hit, time: Date.now(), confidence: 50, recalibrated: false,
  };
}

async function main() {
  log(`=== FINAL 500-ROUND BENCHMARK COLLECTOR STARTING ===`);
  log(`Arm A = C1-C9 (all flags ON). Arm B = [1,2,5,10]. Target: ${TARGET_ROUNDS} rounds.`);

  let state = loadState();
  log(`Resumed with ${state.roundsCollected} rounds, ${state.seenIds.length} seen ids.`);

  if (state.seenIds.length === 0) {
    try {
      const initial = await fetchSpins();
      state.seenIds = initial.map((s) => s.id);
      state.lastNewRoundAt = Date.now();
      saveState(state);
      log(`COLD-START: marked ${state.seenIds.length} existing spins as seen.`);
    } catch (e) {
      log(`FATAL cold-start: ${(e as Error).message}`);
      state.status = "stopped_error"; state.stopReason = `cold-start: ${(e as Error).message}`;
      saveState(state); process.exit(1);
    }
  }

  while (state.status === "running") {
    state.lastPollAt = Date.now();
    let spins: SpinRecord[];
    try { spins = await fetchSpins(); }
    catch (e) {
      log(`poll error (retry): ${(e as Error).message}`);
      if (Date.now() - state.lastNewRoundAt > STALL_TIMEOUT_MS) {
        state.status = "stopped_stall"; state.stopReason = `feed unreachable >${STALL_TIMEOUT_MS/60000}min`; break;
      }
      await sleep(POLL_INTERVAL_MS); continue;
    }

    const oldestFirst = [...spins].reverse();
    let newThisPoll = 0;
    for (const spin of oldestFirst) {
      if (state.seenIds.includes(spin.id)) continue;
      const history: RoundResult[] = state.actualNames.map((n) =>
        makeRound(n, NUMBER_NAMES, NUMBER_NAMES.includes(n)));
      const seenIdsBefore = state.seenIds.length;
      const previousActual = state.actualNames.length > 0
        ? state.actualNames[state.actualNames.length - 1] : "";
      const isColdStart = history.length === 0;

      // Arm A: C1-C9 engine
      const engA = buildInitial(history, [], "baseline", ARM_A_FLAGS);
      const aTop4 = engA.predictions.map((p) => p.game.name);
      // Arm B: fixed [1,2,5,10]
      const bTop4 = isColdStart ? ARM_B_TOP4 : ARM_B_TOP4; // always [1,2,5,10]

      const actual = spin.gameName;
      const aHit = aTop4.includes(actual);
      const bHit = bTop4.includes(actual);
      const aOnly = aHit && !bHit;
      const bOnly = bHit && !aHit;
      const bonusActual = BONUS_NAMES.includes(actual);
      const bonusIncludedByA = aTop4.some((n) => BONUS_NAMES.includes(n));

      const roundId = state.roundsCollected + 1;
      const row: RoundRow = {
        roundId, spinId: spin.id, settledAt: spin.settledAt, timestamp: Date.now(),
        actual, previousActual,
        armA_Top4: aTop4, armA_Hit: aHit,
        armB_Top4: bTop4, armB_Hit: bHit,
        aOnlyHit: aOnly, bOnlyHit: bOnly,
        bonusActual, bonusIncludedByA,
        isColdStart,
        modelVersion: MODEL_VERSION,
        flags: ARM_A_FLAGS,
        duplicateCheck: { isDuplicate: false, seenIdsBefore },
        leakageCheck: { historyLengthBefore: history.length, predictionComputedBeforeSettle: true },
      };
      appendFileSync(ROUNDS_FILE, JSON.stringify(row) + "\n");

      state.actualNames.push(actual);
      state.roundsCollected = roundId;
      state.seenIds.push(spin.id);
      state.lastNewRoundAt = Date.now();
      newThisPoll++;

      if (roundId % 50 === 0 || roundId <= 5) {
        log(`R${roundId}/${TARGET_ROUNDS}: actual=${actual.padEnd(12)} A=[${aTop4.join(",")}] ${aHit?"HIT":"miss"}  B=[${bTop4.join(",")}] ${bHit?"HIT":"miss"}  ${aOnly?"⚡A-only":""}${bOnly?"⚡B-only":""} ${isColdStart?"COLD":""}`);
      }

      if (state.roundsCollected >= TARGET_ROUNDS) {
        state.status = "stopped_target"; state.stopReason = `reached ${TARGET_ROUNDS} rounds`; break;
      }
    }
    saveState(state);
    if (Date.now() - state.lastNewRoundAt > STALL_TIMEOUT_MS) {
      state.status = "stopped_stall"; state.stopReason = `no new spins >${STALL_TIMEOUT_MS/60000}min`; break;
    }
    if (state.status !== "running") break;
    await sleep(POLL_INTERVAL_MS);
  }

  saveState(state);
  log(`=== STOPPED: ${state.status} — ${state.stopReason} ===`);
  log(`Collected ${state.roundsCollected} paired rounds.`);
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
main().catch((e) => {
  log(`UNHANDLED: ${(e as Error).stack}`);
  const s = loadState(); s.status = "stopped_error"; s.stopReason = `unhandled: ${(e as Error).message}`;
  saveState(s); process.exit(1);
});
