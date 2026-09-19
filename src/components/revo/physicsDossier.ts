/**
 * PHYSICS DOSSIER + PREDICTION LEDGER (ADDITIVE — new file)
 * =========================================================
 *
 * Stores, for EVERY spin that the experimental layers touch:
 *   - the complete PHYSICS DOSSIER (direction, velocities, angles, sectrors,
 *     confidence, vibration, tracking, lock/latest-used timestamps, prediction,
 *     actual, HIT/MISS), and
 *   - a strict PREDICTION RECORD (predictionId, spinId, lockTimestamp,
 *     latestUsedTimestamp, physicalStopTimestamp, actualResultTimestamp,
 *     signal versions, Top-4, all 8 scores, confidence, HIT/MISS).
 *
 * The ledger ENFORCES the project's data-integrity contract:
 *
 *     latestUsedTimestamp <= lockTimestamp < physicalStopTimestamp
 *
 * A record that violates it is never silently accepted: `appendPrediction()`
 * returns a rejection with the reason, and `auditLedger()` reports every
 * violation with the offending ids.
 *
 * Nothing existing is modified; the production engine's own records are
 * untouched.
 */

import {
  mcnemarPaired,
  round as roundTo,
  wilsonInterval,
  type Interval,
} from "./signalStats";
import { OUTCOMES_8 } from "./timeSignal";
import type { MotionState, WheelDirection } from "./wheelPhysicsLayer";

export const PHYSICS_DOSSIER_VERSION = "physics-dossier-v1.0";
export const PREDICTION_RECORD_VERSION = "prediction-record-v1.0";

// ============================================================
// 1. PHYSICS DOSSIER
// ============================================================

export interface PhysicsDossier {
  spinId: string;
  version: string;

  // ---- timeline ----
  physicalStart: number | null;
  physicalStop: number | null;
  lockTimestamp: number;
  latestUsedTimestamp: number | null;
  predictionTimestamp: number;
  actualResultTimestamp: number | null;

  // ---- direction ----
  direction: WheelDirection;
  directionConfidence: number;
  directionStability: number;
  directionChanges: number;

  // ---- speed / dynamics ----
  initialVelocity: number;
  peakVelocity: number;
  velocityAtLock: number;
  acceleration: number;
  deceleration: number;
  timeToStop: number | null;
  angularDisplacement: number;

  // ---- angle / sector ----
  currentAngle: number;
  predictedStopAngle: number | null;
  stopAngleError: number | null;    // circular error vs the actual stop angle
  predictedSector: number | null;
  actualSector: number | null;
  sectorError: number | null;       // circular sector distance
  predictedOutcome: string | null;
  actualOutcome: string | null;

  // ---- quality ----
  motionConfidence: number;
  vibrationScore: number;
  trackingConfidence: number;
  motionState: MotionState;
  physicsConfidence: number;

  // ---- prediction vs actual ----
  predictionTop4: string[];
  all8Scores: Record<string, number>;
  actualResult: string | null;
  hit: boolean | null;

  // ---- provenance ----
  signalVersions: { time?: string; dealer?: string; physics?: string; ensemble?: string; engine?: string };
  leakageSafe: boolean;
  notes: string[];
}

export interface DossierUpdate {
  /** Optional: `upsertDossier()` supplies the spin id itself. */
  spinId?: string;
  physicalStart?: number | null;
  physicalStop?: number | null;
  lockTimestamp?: number;
  latestUsedTimestamp?: number | null;
  predictionTimestamp?: number;
  actualResultTimestamp?: number | null;
  direction?: WheelDirection;
  directionConfidence?: number;
  directionStability?: number;
  directionChanges?: number;
  initialVelocity?: number;
  peakVelocity?: number;
  velocityAtLock?: number;
  acceleration?: number;
  deceleration?: number;
  timeToStop?: number | null;
  angularDisplacement?: number;
  currentAngle?: number;
  predictedStopAngle?: number | null;
  predictedSector?: number | null;
  currentSector?: number | null;
  predictedOutcome?: string | null;
  motionConfidence?: number;
  vibrationScore?: number;
  trackingConfidence?: number;
  motionState?: MotionState;
  physicsConfidence?: number;
  predictionTop4?: string[];
  all8Scores?: Record<string, number>;
  actualResult?: string | null;
  actualOutcome?: string | null;
  actualSector?: number | null;
  signalVersions?: PhysicsDossier["signalVersions"];
  notes?: string[];
}

export function createDossier(input: { spinId: string; lockTimestamp: number; predictionTimestamp?: number }): PhysicsDossier {
  return {
    spinId: input.spinId,
    version: PHYSICS_DOSSIER_VERSION,
    physicalStart: null,
    physicalStop: null,
    lockTimestamp: input.lockTimestamp,
    latestUsedTimestamp: null,
    predictionTimestamp: input.predictionTimestamp ?? Date.now(),
    actualResultTimestamp: null,
    direction: "UNKNOWN",
    directionConfidence: 0,
    directionStability: 0,
    directionChanges: 0,
    initialVelocity: 0,
    peakVelocity: 0,
    velocityAtLock: 0,
    acceleration: 0,
    deceleration: 0,
    timeToStop: null,
    angularDisplacement: 0,
    currentAngle: 0,
    predictedStopAngle: null,
    stopAngleError: null,
    predictedSector: null,
    actualSector: null,
    sectorError: null,
    predictedOutcome: null,
    actualOutcome: null,
    motionConfidence: 0,
    vibrationScore: 0,
    trackingConfidence: 0,
    motionState: "IDLE",
    physicsConfidence: 0,
    predictionTop4: [],
    all8Scores: {},
    actualResult: null,
    hit: null,
    signalVersions: {},
    leakageSafe: true,
    notes: [],
  };
}

/** Circular difference in degrees (shortest path, −180..180). */
export function circularDiffDeg(a: number, b: number): number {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  if (!Number.isFinite(d)) d = 0;
  return d;
}

export function applyDossierUpdate(dossier: PhysicsDossier, update: DossierUpdate): PhysicsDossier {
  const merged: PhysicsDossier = {
    ...dossier,
    ...Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)),
    signalVersions: { ...dossier.signalVersions, ...(update.signalVersions ?? {}) },
    notes: update.notes ? [...dossier.notes, ...update.notes] : dossier.notes,
  } as PhysicsDossier;

  // Recompute derived angles when both parts are known.
  if (merged.predictedStopAngle !== null && merged.actualSector !== null && merged.actualSector !== undefined) {
    // actual sector → its centre angle (6.667° wide sectors)
    const centre = (merged.actualSector as number) * (360 / 54) + 360 / 108;
    merged.stopAngleError = roundTo(circularDiffDeg(merged.predictedStopAngle, centre), 4);
  }
  if (merged.predictedSector !== null && merged.actualSector !== null && merged.actualSector !== undefined) {
    let d = Math.abs((merged.predictedSector as number) - (merged.actualSector as number)) % 54;
    if (d > 27) d = 54 - d;
    merged.sectorError = d;
  }
  if (merged.actualResult !== null && merged.actualResult !== undefined && merged.predictionTop4.length > 0) {
    merged.hit = merged.predictionTop4.includes(merged.actualResult);
  }
  merged.leakageSafe =
    (merged.latestUsedTimestamp === null || merged.latestUsedTimestamp <= merged.lockTimestamp) &&
    (merged.physicalStop === null || merged.lockTimestamp < merged.physicalStop);
  if (!merged.leakageSafe) {
    merged.notes = [...merged.notes, `LEAKAGE VIOLATION: latestUsed=${merged.latestUsedTimestamp}, lock=${merged.lockTimestamp}, physicalStop=${merged.physicalStop}`];
  }
  return merged;
}

/** Freeze the actual sector/outcome into a dossier (called at settlement). */
export function finalizeDossier(
  dossier: PhysicsDossier,
  actual: { outcome: string; sector?: number | null; resultTimestamp: number },
): PhysicsDossier {
  return applyDossierUpdate(dossier, {
    actualResult: actual.outcome,
    actualOutcome: actual.outcome,
    actualSector: actual.sector ?? null,
    actualResultTimestamp: actual.resultTimestamp,
  });
}

// ============================================================
// 2. PREDICTION RECORD (signal-versioned, leakage-audited)
// ============================================================

export interface PredictionRecord {
  predictionId: string;
  spinId: string;
  version: string;
  lockTimestamp: number;
  latestUsedTimestamp: number | null;
  physicalStopTimestamp: number | null;
  actualResultTimestamp: number | null;
  signalVersions: { engine?: string; time?: string; dealer?: string; physics?: string; ensemble?: string; ml?: string };
  ensembleMode: string;                 // which signals were ENABLED for this record
  /** true → this record was produced with feature flags OVERRIDDEN for shadow
   *  data collection. It is never a prediction that influenced production. */
  shadow: boolean;
  top4: string[];
  all8Scores: Record<string, number>;
  confidence: number;
  actualResult: string | null;
  hit: boolean | null;
  integrity: {
    orderingOk: boolean;
    lockBeforeStop: boolean;
    noFutureInformation: boolean;
    notes: string[];
  };
}

export function buildPredictionRecord(input: {
  predictionId?: string;
  spinId: string;
  lockTimestamp: number;
  latestUsedTimestamp: number | null;
  physicalStopTimestamp: number | null;
  actualResultTimestamp?: number | null;
  signalVersions?: PredictionRecord["signalVersions"];
  ensembleMode: string;
  shadow?: boolean;
  top4: string[];
  all8Scores: Record<string, number>;
  confidence: number;
  actualResult?: string | null;
}): PredictionRecord {
  const notes: string[] = [];
  const orderingOk =
    input.latestUsedTimestamp === null || input.latestUsedTimestamp <= input.lockTimestamp;
  if (!orderingOk) notes.push(`latestUsedTimestamp(${input.latestUsedTimestamp}) > lockTimestamp(${input.lockTimestamp})`);
  const lockBeforeStop =
    input.physicalStopTimestamp === null ? false : input.lockTimestamp < input.physicalStopTimestamp;
  if (input.physicalStopTimestamp !== null && !lockBeforeStop) {
    notes.push(`lockTimestamp(${input.lockTimestamp}) >= physicalStopTimestamp(${input.physicalStopTimestamp})`);
  }
  const noFutureInformation =
    input.latestUsedTimestamp === null || input.actualResultTimestamp === null
      ? true
      : input.latestUsedTimestamp < (input.actualResultTimestamp ?? Infinity);
  if (!noFutureInformation) notes.push("latestUsedTimestamp is at/after the actual result timestamp");
  const actual = input.actualResult ?? null;
  return {
    predictionId: input.predictionId ?? `pred-${input.spinId}-${input.lockTimestamp}`,
    spinId: input.spinId,
    version: PREDICTION_RECORD_VERSION,
    lockTimestamp: input.lockTimestamp,
    latestUsedTimestamp: input.latestUsedTimestamp,
    physicalStopTimestamp: input.physicalStopTimestamp,
    actualResultTimestamp: input.actualResultTimestamp ?? null,
    signalVersions: input.signalVersions ?? {},
    ensembleMode: input.ensembleMode,
    shadow: input.shadow === true,
    top4: input.top4.slice(0, 4),
    all8Scores: { ...input.all8Scores },
    confidence: input.confidence,
    actualResult: actual,
    hit: actual === null ? null : input.top4.includes(actual),
    integrity: { orderingOk, lockBeforeStop, noFutureInformation, notes },
  };
}

// ============================================================
// 3. LEDGER (in-memory + optional persistence hook)
// ============================================================

export interface LedgerAppendResult {
  accepted: boolean;
  record?: PredictionRecord;
  rejection?: { reason: string; details: string };
}

let dossierLedger: PhysicsDossier[] = [];
let predictionLedger: PredictionRecord[] = [];
const listeners = new Set<() => void>();
let ledgerVersion = 0;

function notify(): void {
  ledgerVersion++;
  listeners.forEach((l) => l());
}

export function subscribeLedger(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getLedgerVersion(): number {
  return ledgerVersion;
}

export function appendDossier(dossier: PhysicsDossier): void {
  const idx = dossierLedger.findIndex((d) => d.spinId === dossier.spinId);
  if (idx >= 0) dossierLedger[idx] = dossier;
  else dossierLedger = [...dossierLedger, dossier];
  notify();
}

export function upsertDossier(spinId: string, lockTimestamp: number, update: DossierUpdate): PhysicsDossier {
  const existing = dossierLedger.find((d) => d.spinId === spinId);
  const base = existing ?? createDossier({ spinId, lockTimestamp });
  const merged = applyDossierUpdate(base, update);
  appendDossier(merged);
  return merged;
}

/**
 * Append a prediction record. Records that violate the timestamp contract are
 * REJECTED by default (`strict=true`), so an invalid prediction can never be
 * counted in a hit-rate.
 */
export function appendPrediction(record: PredictionRecord, strict = true): LedgerAppendResult {
  const problems: string[] = [];
  if (!record.integrity.orderingOk) problems.push("latestUsedTimestamp > lockTimestamp");
  if (record.physicalStopTimestamp !== null && !record.integrity.lockBeforeStop) {
    problems.push("lockTimestamp >= physicalStopTimestamp");
  }
  if (record.top4.length !== 4) problems.push(`top4 must contain exactly 4 outcomes (got ${record.top4.length})`);
  if (problems.length > 0) {
    if (strict) {
      return { accepted: false, rejection: { reason: problems.join("; "), details: `spin ${record.spinId} @ ${record.lockTimestamp}` } };
    }
    record.integrity.notes.push(...problems);
  }
  predictionLedger = [...predictionLedger, record];
  notify();
  return { accepted: true, record };
}

export function getDossiers(): PhysicsDossier[] {
  return dossierLedger;
}
export function getPredictions(): PredictionRecord[] {
  return predictionLedger;
}

export function clearLedger(): void {
  dossierLedger = [];
  predictionLedger = [];
  notify();
}

// ============================================================
// 4. AUDITS
// ============================================================

export interface LedgerAudit {
  totalShadowRecords?: number;
  totalDossiers: number;
  totalPredictions: number;
  duplicates: { spinId: string; count: number }[];
  duplicatePassed: boolean;
  timestampViolations: { predictionId: string; reason: string }[];
  timestampPassed: boolean;
  leakageViolations: { spinId: string; detail: string }[];
  leakagePassed: boolean;
  incompleteDossiers: { spinId: string; missing: string[] }[];
  completenessPassed: boolean;
  settledPredictions: number;
  unsettledPredictions: number;
  notes: string[];
}

const REQUIRED_DOSSIER_FIELDS: (keyof PhysicsDossier)[] = [
  "spinId",
  "lockTimestamp",
  "predictionTimestamp",
  "predictionTop4",
  "direction",
  "physicsConfidence",
  "motionConfidence",
  "trackingConfidence",
];

export function auditLedger(): LedgerAudit {
  // duplicate audit (spin ids must be unique in each ledger)
  const counts = new Map<string, number>();
  for (const d of dossierLedger) counts.set(d.spinId, (counts.get(d.spinId) ?? 0) + 1);
  const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([spinId, count]) => ({ spinId, count }));

  const timestampViolations: { predictionId: string; reason: string }[] = [];
  const leakageViolations: { spinId: string; detail: string }[] = [];
  for (const p of predictionLedger) {
    if (p.latestUsedTimestamp !== null && p.latestUsedTimestamp > p.lockTimestamp) {
      timestampViolations.push({ predictionId: p.predictionId, reason: `latestUsed ${p.latestUsedTimestamp} > lock ${p.lockTimestamp}` });
    }
    if (p.physicalStopTimestamp !== null && p.lockTimestamp >= p.physicalStopTimestamp) {
      timestampViolations.push({ predictionId: p.predictionId, reason: `lock ${p.lockTimestamp} >= physicalStop ${p.physicalStopTimestamp}` });
    }
  }
  for (const d of dossierLedger) {
    if (!d.leakageSafe) leakageViolations.push({ spinId: d.spinId, detail: d.notes.filter((n) => n.startsWith("LEAKAGE")).join(" | ") || "leakageSafe=false" });
  }

  const incompleteDossiers: { spinId: string; missing: string[] }[] = [];
  for (const d of dossierLedger) {
    const missing = REQUIRED_DOSSIER_FIELDS.filter((f) => d[f] === undefined || d[f] === null);
    if (missing.length > 0) incompleteDossiers.push({ spinId: d.spinId, missing: missing as string[] });
  }

  const settled = predictionLedger.filter((p) => p.hit !== null).length;
  const shadowRecords = predictionLedger.filter((p) => p.shadow).length;
  return {
    totalDossiers: dossierLedger.length,
    totalPredictions: predictionLedger.length,
    totalShadowRecords: shadowRecords,
    duplicates,
    duplicatePassed: duplicates.length === 0,
    timestampViolations,
    timestampPassed: timestampViolations.length === 0,
    leakageViolations,
    leakagePassed: leakageViolations.length === 0,
    incompleteDossiers,
    completenessPassed: incompleteDossiers.length === 0,
    settledPredictions: settled,
    unsettledPredictions: predictionLedger.length - settled,
    notes: [
      "Timestamp contract enforced: latestUsedTimestamp <= lockTimestamp < physicalStopTimestamp.",
      "Duplicate audit: spin ids are unique per ledger entry (duplicates rejected by upsert semantics).",
      "Only real settled rounds may contribute a HIT/MISS (actualResult must come from the live result bus).",
    ],
  };
}

/** Physics-prediction accuracy summary (diagnostic only — requires real rounds). */
export interface PhysicsHitSummary {
  n: number;
  hits: number;
  hitRate: number;
  ci95: Interval;
  physicsOnlyN: number;
  physicsOnlyHitRate: number;
  meanSectorError: number | null;
  meanStopAngleErrorDeg: number | null;
  directionAccuracy: number | null;
  note: string;
}

export function summarizeDossiers(dossiers: PhysicsDossier[] = dossierLedger): PhysicsHitSummary {
  const settled = dossiers.filter((d) => d.hit !== null);
  const hits = settled.filter((d) => d.hit).length;
  const sectorErrors = settled.map((d) => d.sectorError).filter((v): v is number => typeof v === "number");
  const angleErrors = settled.map((d) => d.stopAngleError).filter((v): v is number => typeof v === "number");
  const withDirection = settled.filter((d) => d.direction !== "UNKNOWN");
  return {
    n: settled.length,
    hits,
    hitRate: settled.length > 0 ? hits / settled.length : 0,
    ci95: wilsonInterval(hits, settled.length),
    physicsOnlyN: withDirection.length,
    physicsOnlyHitRate: withDirection.length > 0 ? withDirection.filter((d) => d.hit).length / withDirection.length : 0,
    meanSectorError: sectorErrors.length > 0 ? roundTo(sectorErrors.reduce((s, v) => s + v, 0) / sectorErrors.length, 3) : null,
    meanStopAngleErrorDeg: angleErrors.length > 0 ? roundTo(angleErrors.reduce((s, v) => s + Math.abs(v), 0) / angleErrors.length, 3) : null,
    directionAccuracy: null, // requires ground-truth direction labels; never fabricated
    note:
      settled.length === 0
        ? "NO settled physics dossiers yet — no accuracy claim can be made."
        : `Diagnostic only (n=${settled.length}). Not a validation claim; see the walk-forward harness for paired comparison.`,
  };
}

export { mcnemarPaired, OUTCOMES_8 };
