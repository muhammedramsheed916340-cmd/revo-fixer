/**
 * SIGNAL DATA STORE + LIVE INTEGRATION (ADDITIVE — new file)
 * ==========================================================
 *
 * The single place where the three experimental layers get their REAL data:
 *
 *   · settled rounds with exact timestamps (time layer + dealer attribution)
 *   · wheel motion frames from the live video sensor (physics layer)
 *   · dealer observations from the public game UI / coarse appearance match
 *
 * It never creates data: every writer rejects rows that are not real
 * (no fabricated rounds, no invented timestamps, no duplicate settlement).
 *
 * `buildLiveSignalBundle()` is the integration point used by the UI: at a lock
 * timestamp it computes the time signal, the dealer signal, the physics
 * evidence and the ensemble — with every new signal governed by its own
 * feature flag (all OFF by default, so the production prediction is returned
 * unchanged in passthrough mode).
 */

import {
  OUTCOMES_8,
  duplicateAudit,
  normalizeRounds,
  toTimedRound,
  computeTimeSignal,
  type TimedRound,
  type TimeSignalResult,
} from "./timeSignal";
import {
  computeDealerSignal,
  getDealerProfiles,
  identifyDealer,
  recordDealerObservation,
  attachRoundToDealer,
  type DealerSignalResult,
} from "./dealerSignal";
import {
  learnDeceleration,
  computePhysicsEvidence,
  frameFromSensorState,
  type MotionFrame,
  type PhysicsEvidence,
  type DecelerationObservation,
} from "./wheelPhysicsLayer";
import { computeArms, fuseSignals, type AblationArm, type EnsembleOutput } from "./signalEnsemble";
import { appendPrediction, buildPredictionRecord, upsertDossier, type PredictionRecord } from "./physicsDossier";
import { getSignalFlags, type SignalFeatureFlags } from "./signalFlags";
import { LIVE_RESULT_SECTOR_TO_OUTCOME } from "./signalSectorMap";

export const SIGNAL_STORE_VERSION = "signal-data-store-v1.0";

const STORAGE_KEY = "revo_signalStore_v1";
const MAX_ROUNDS = 2000;
const MAX_FRAMES = 24000;

// ============================================================
// 1. STATE
// ============================================================

interface StoreState {
  rounds: TimedRound[];
  frames: MotionFrame[];
  decelObservations: DecelerationObservation[];
  lastResultKey: string | null;
  loaded: boolean;
}

const state: StoreState = {
  rounds: [],
  frames: [],
  decelObservations: [],
  lastResultKey: null,
  loaded: false,
};

const listeners = new Set<() => void>();
let storeVersion = 0;

function notify(): void {
  storeVersion++;
  listeners.forEach((l) => l());
}

export function subscribeSignalStore(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getSignalStoreVersion(): number {
  return storeVersion;
}

function load(): void {
  if (state.loaded) return;
  state.loaded = true;
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { rounds?: TimedRound[] };
    if (Array.isArray(parsed.rounds)) {
      state.rounds = normalizeRounds(parsed.rounds.filter((r) => r && r.verified !== false));
    }
  } catch {
    state.rounds = [];
  }
}

function persist(): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ rounds: state.rounds.slice(-MAX_ROUNDS) }));
  } catch {
    /* storage full/unavailable — in-memory data still usable this session */
  }
}

// ============================================================
// 2. WRITERS (real data only)
// ============================================================

export interface SettledRoundInput {
  sector: string;              // the raw game sector, e.g. "CoinFlip"
  settledAt: number;           // ms epoch (API settlement time of the real result)
  resultKey: string;           // dedup key, e.g. `${sector}-${time}`
  multiplier?: number;
  topSlotSector?: string | null;
  source?: string;
}

let roundCounter = 0;

/**
 * Record a REAL settled round. Rejected when:
 *   · the settlement timestamp is not a real positive epoch time,
 *   · the result key was already recorded (duplicate settlement),
 *   · the sector does not map to one of the 8 wheel outcomes.
 */
export function recordSettledRound(input: SettledRoundInput): { accepted: boolean; reason: string; round?: TimedRound } {
  load();
  const outcome = LIVE_RESULT_SECTOR_TO_OUTCOME[input.sector];
  if (!outcome) return { accepted: false, reason: `unknown sector "${input.sector}" — not a real wheel outcome` };
  if (!Number.isFinite(input.settledAt) || input.settledAt <= 0) {
    return { accepted: false, reason: "settledAt is not a real epoch timestamp" };
  }
  if (state.lastResultKey === input.resultKey && input.resultKey) {
    return { accepted: false, reason: "duplicate result key (same settlement already recorded)" };
  }
  if (state.rounds.some((r) => r.spinId === `live-${input.resultKey}`)) {
    return { accepted: false, reason: "duplicate settlement already in the store" };
  }
  roundCounter++;
  const round = toTimedRound({
    roundId: `live-${input.resultKey}-${roundCounter}`,
    spinId: `live-${input.resultKey}`,
    outcome,
    settledAt: input.settledAt,
    topSlotOutcome: input.topSlotSector ? LIVE_RESULT_SECTOR_TO_OUTCOME[input.topSlotSector] ?? null : null,
    source: input.source ?? "live-api",
  });
  state.rounds = [...state.rounds, round].slice(-MAX_ROUNDS);
  state.lastResultKey = input.resultKey;
  persist();
  notify();
  return { accepted: true, reason: "ok", round };
}

/** Feed one wheel-telemetry frame (called from the video sensor). */
export function recordMotionFrame(frame: MotionFrame): void {
  if (!Number.isFinite(frame.timestamp) || frame.timestamp <= 0) return;
  state.frames.push(frame);
  if (state.frames.length > MAX_FRAMES) state.frames = state.frames.slice(-MAX_FRAMES);
  // deceleration bookkeeping happens at spin completion (see recordSpinCompletion)
}

/** Feed the sensor's own state object (convenience adapter). */
export function recordSensorState(p: Parameters<typeof frameFromSensorState>[0]): void {
  recordMotionFrame(frameFromSensorState(p));
}

/**
 * Called when a physical spin is confirmed complete (wheel stopped). Learns the
 * deceleration profile for FUTURE spins and stores it. Post-stop frames are
 * never used for a prediction (the physics lock happens before the stop).
 */
export function recordSpinCompletion(input: {
  spinId: string;
  physicalStopTimestamp: number;
  deceleration: number;
  direction: 1 | -1;
  frames?: MotionFrame[];
}): void {
  if (!Number.isFinite(input.deceleration) || input.deceleration <= 0) return;
  state.decelObservations = [
    ...state.decelObservations,
    {
      spinId: input.spinId,
      deceleration: input.deceleration,
      endedAt: input.physicalStopTimestamp,
      direction: (input.direction > 0 ? "RIGHT" : "LEFT") as DecelerationObservation["direction"],
    },
  ].slice(-500);
  notify();
}

// ============================================================
// 2b. PRODUCTION PREDICTION PUBLISHER (read-only hand-off)
// ============================================================
// The existing engine owns its prediction; the experimental ensemble needs the
// production Top-4 + per-outcome scores to (a) run in PRODUCTION_PASSTHROUGH
// mode and (b) act as the "history" channel for the fusion arms. The production
// component publishes here; nothing here writes back into the engine.

export interface PublishedProductionPrediction {
  top4: string[];
  probabilities: Record<string, number> | null;
  lockTimestamp: number;
  publishedAt: number;
  modelVersion: string;
}

let productionPrediction: PublishedProductionPrediction | null = null;

export function publishProductionPrediction(input: {
  top4: string[];
  probabilities: Record<string, number> | null;
  lockTimestamp?: number;
  modelVersion?: string;
}): void {
  const top4 = Array.isArray(input.top4) ? input.top4.filter((n) => typeof n === "string").slice(0, 4) : [];
  if (top4.length !== 4) return; // an incomplete/degenerate prediction is never published
  productionPrediction = {
    top4,
    probabilities: input.probabilities ?? null,
    lockTimestamp: input.lockTimestamp ?? Date.now(),
    publishedAt: Date.now(),
    modelVersion: input.modelVersion ?? "revo-engine-v2-C1C9",
  };
}

export function getProductionPrediction(): PublishedProductionPrediction | null {
  return productionPrediction;
}

// ============================================================
// 3. READERS
// ============================================================

export function getTimedRounds(): TimedRound[] {
  load();
  return state.rounds;
}

export function getMotionFrames(): MotionFrame[] {
  return state.frames;
}

export function getDecelerationObservations(): DecelerationObservation[] {
  return state.decelObservations;
}

export function clearSignalStore(): void {
  state.rounds = [];
  state.frames = [];
  state.decelObservations = [];
  state.lastResultKey = null;
  persist();
  notify();
}

// ============================================================
// 4. DEALER GLUE
// ============================================================

/**
 * Identify the dealer from a coarse appearance descriptor captured BEFORE the
 * prediction lock. `publicName` is used only when the game UI itself shows it.
 */
export function observeDealer(input: {
  timestamp: number;
  descriptor?: number[] | null;
  publicName?: string | null;
  tableId?: string | null;
  confidence?: number;
  physics?: { direction: "LEFT" | "RIGHT" | "UNKNOWN"; speed: number; deceleration: number } | null;
}): { dealerId: string; matched: boolean; confidence: number; reason: string } {
  const identified = identifyDealer({
    timestamp: input.timestamp,
    descriptor: input.descriptor ?? null,
    publicName: input.publicName ?? null,
    tableId: input.tableId ?? null,
    identificationConfidence: input.confidence,
  });
  const observation = {
    timestamp: input.timestamp,
    confidence: input.confidence ?? identified.confidence,
    method: identified.method,
    physics: input.physics ?? null,
  };
  const recorded = recordDealerObservation({ dealerId: identified.dealerId, observation });
  return {
    dealerId: identified.dealerId,
    matched: identified.matched,
    confidence: observation.confidence,
    reason: `${identified.reason}${recorded.accepted ? "" : ` (observation rejected: ${recorded.reason})`}`,
  };
}

/** Attribute a settled round to the dealer observed at/ before the lock. */
export function attributeRoundToDealer(dealerId: string | null, round: TimedRound, attributedAt: number): { accepted: boolean; reason: string } {
  if (!dealerId) return { accepted: false, reason: "no dealer id supplied" };
  return attachRoundToDealer({ dealerId, round, attributedAt });
}

// ============================================================
// 5. LIVE BUNDLE (the integration point)
// ============================================================

export interface LiveSignalBundle {
  lockTimestamp: number;
  latestUsedTimestamp: number | null;
  flags: SignalFeatureFlags;
  timeSignal: TimeSignalResult;
  dealerSignal: DealerSignalResult;
  physicsEvidence: PhysicsEvidence;
  ensemble: EnsembleOutput;
  arms: Record<AblationArm, { top4: string[]; available: boolean; reason: string; probabilities: Record<string, number> }>;
  predictionRecord: PredictionRecord | null;
  mode: string;
  why: string[];
}

export interface BuildLiveSignalBundleInput {
  lockTimestamp: number;
  /** Production engine probabilities for this lock (from the existing engine). */
  historyProbabilities: Record<string, number> | null;
  historyTop4: string[] | null;
  /** Dealer identified before the lock (null = unknown). */
  dealerId?: string | null;
  /** Physical stop timestamp when it is already known (post-hoc evaluation). */
  physicalStopTimestamp?: number | null;
  actualResultTimestamp?: number | null;
  actualResult?: string | null;
  spinId?: string;
  flagsOverride?: SignalFeatureFlags;
  mlProbabilities?: Record<string, number> | null;
  utcOffsetMinutes?: number;
  /** When true the bundle also appends a strict prediction record to the ledger. */
  recordPrediction?: boolean;
}

/**
 * Compute every experimental signal for one lock and fuse them.
 *
 * IMPORTANT: with all flags OFF (the default) `ensemble.mode` is
 * "PRODUCTION_PASSTHROUGH" and `ensemble.top4` is the production Top-4 handed
 * in — the experiment is fully visible in the diagnostics but changes nothing.
 */
export function buildLiveSignalBundle(input: BuildLiveSignalBundleInput): LiveSignalBundle {
  load();
  const flags = input.flagsOverride ?? getSignalFlags();
  const history = getTimedRounds().filter((r) => r.settledAt <= input.lockTimestamp);

  const timeSignal = computeTimeSignal({
    rounds: history,
    lockTimestamp: input.lockTimestamp,
    options: { utcOffsetMinutes: input.utcOffsetMinutes },
  });

  const dealerSignal = computeDealerSignal({
    allRounds: history,
    lockTimestamp: input.lockTimestamp,
    dealerId: input.dealerId ?? null,
    options: { utcOffsetMinutes: input.utcOffsetMinutes },
  });

  const learnedDeceleration = learnDeceleration(
    getDecelerationObservations(),
    input.lockTimestamp,
    undefined,
  );
  const physicsEvidence = computePhysicsEvidence(
    getMotionFrames().filter((f) => f.timestamp <= input.lockTimestamp),
    { learnedDeceleration },
  );

  const ensemble = fuseSignals({
    lockTimestamp: input.lockTimestamp,
    latestUsedTimestamp: timeSignal.latestUsedTimestamp,
    physicalStopTimestamp: input.physicalStopTimestamp ?? null,
    actualResultTimestamp: input.actualResultTimestamp ?? null,
    historyProbabilities: input.historyProbabilities,
    historyTop4: input.historyTop4,
    timeSignal,
    dealerSignal,
    physicsEvidence,
    mlProbabilities: input.mlProbabilities ?? null,
    options: { flagsOverride: flags },
  });

  const arms = computeArms({
    lockTimestamp: input.lockTimestamp,
    latestUsedTimestamp: timeSignal.latestUsedTimestamp,
    historyProbabilities: input.historyProbabilities,
    historyTop4: input.historyTop4,
    timeScores: timeSignal.scores,
    timeActive: timeSignal.active,
    timeConfidence: timeSignal.confidence,
    dealerScores: dealerSignal.scores,
    dealerActive: dealerSignal.active,
    dealerConfidence: dealerSignal.confidence,
    physicsProbabilities: physicsEvidence.outcomeProbabilities,
    physicsActive: physicsEvidence.evidence,
    physicsConfidence: physicsEvidence.physicsConfidence,
    mlProbabilities: input.mlProbabilities ?? null,
  });

  let predictionRecord: PredictionRecord | null = null;
  if (input.recordPrediction) {
    const record = buildPredictionRecord({
      spinId: input.spinId ?? `spin-${input.lockTimestamp}`,
      lockTimestamp: input.lockTimestamp,
      latestUsedTimestamp: timeSignal.latestUsedTimestamp,
      physicalStopTimestamp: input.physicalStopTimestamp ?? null,
      actualResultTimestamp: input.actualResultTimestamp ?? null,
      ensembleMode: input.flagsOverride ? `SHADOW:${ensemble.mode}` : ensemble.mode,
      // A record produced with overridden flags is SHADOW data collection: it
      // is visible in the ledger but is never a production prediction.
      shadow: Boolean(input.flagsOverride),
      top4: ensemble.top4,
      all8Scores: ensemble.all8Scores,
      confidence: ensemble.confidence,
      actualResult: input.actualResult ?? null,
      signalVersions: {
        engine: "revo-engine-v2-C1C9",
        time: timeSignal.version,
        dealer: dealerSignal.version,
        physics: physicsEvidence.version,
        ensemble: ensemble.version,
      },
    });
    const appended = appendPrediction(record, true);
    predictionRecord = appended.accepted ? appended.record ?? record : null;
    upsertDossier(record.spinId, record.lockTimestamp, {
      predictionTop4: record.top4,
      all8Scores: record.all8Scores,
      predictedSector: physicsEvidence.position.predictedSector,
      predictedStopAngle: physicsEvidence.position.predictedStopAngle,
      predictedOutcome: physicsEvidence.position.predictedOutcome,
      direction: physicsEvidence.direction.direction,
      directionConfidence: physicsEvidence.direction.confidence,
      directionStability: physicsEvidence.direction.stability,
      directionChanges: physicsEvidence.direction.changes,
      peakVelocity: physicsEvidence.speed.peakSpeed,
      velocityAtLock: physicsEvidence.speed.currentVelocity,
      acceleration: physicsEvidence.speed.acceleration,
      deceleration: physicsEvidence.speed.deceleration,
      timeToStop: physicsEvidence.speed.estimatedTimeToStop,
      angularDisplacement: physicsEvidence.position.angularDisplacement,
      currentAngle: physicsEvidence.position.currentAngle,
      motionConfidence: physicsEvidence.motion.confidence,
      vibrationScore: physicsEvidence.vibration.vibrationScore,
      trackingConfidence: physicsEvidence.vibration.trackingConfidence,
      motionState: physicsEvidence.motion.state,
      physicsConfidence: physicsEvidence.physicsConfidence,
      latestUsedTimestamp: record.latestUsedTimestamp,
      signalVersions: record.signalVersions,
      notes: record.shadow ? ["SHADOW prediction (flags overridden for data collection — never influenced production)."] : [],
    });
  }

  const why = [
    ...timeSignal.why,
    ...dealerSignal.why,
    ...physicsEvidence.why,
    ...ensemble.why,
  ];

  return {
    lockTimestamp: input.lockTimestamp,
    latestUsedTimestamp: timeSignal.latestUsedTimestamp,
    flags,
    timeSignal,
    dealerSignal,
    physicsEvidence,
    ensemble,
    arms,
    predictionRecord,
    mode: ensemble.mode,
    why,
  };
}

// ============================================================
// 6. AUDITS
// ============================================================

export interface StoreAudit {
  rounds: { total: number; unique: number; duplicates: { key: string; count: number }[]; passed: boolean };
  timestamps: { passed: boolean; problems: string[] };
  dealers: { profiles: number; roundsAttributed: number; note: string };
  frames: { buffered: number; firstTimestamp: number | null; lastTimestamp: number | null };
}

export function auditSignalStore(): StoreAudit {
  load();
  const dup = duplicateAudit(state.rounds);
  const problems: string[] = [];
  for (let i = 1; i < state.rounds.length; i++) {
    if (state.rounds[i].settledAt < state.rounds[i - 1].settledAt) {
      problems.push(`round ${state.rounds[i].roundId} settled before the previous round (out of order)`);
    }
  }
  const now = Date.now();
  for (const r of state.rounds) {
    if (r.settledAt > now + 60_000) problems.push(`round ${r.roundId} has a future timestamp`);
  }
  const profiles = getDealerProfiles();
  return {
    rounds: { total: dup.total, unique: dup.unique, duplicates: dup.duplicates, passed: dup.passed },
    timestamps: { passed: problems.length === 0, problems: problems.slice(0, 20) },
    dealers: {
      profiles: profiles.length,
      roundsAttributed: profiles.reduce((s, p) => s + p.rounds.length, 0),
      note: "Dealer profiles contain only public-UI data and coarse non-reversible appearance descriptors.",
    },
    frames: {
      buffered: state.frames.length,
      firstTimestamp: state.frames.length > 0 ? state.frames[0].timestamp : null,
      lastTimestamp: state.frames.length > 0 ? state.frames[state.frames.length - 1].timestamp : null,
    },
  };
}

export { OUTCOMES_8 };
