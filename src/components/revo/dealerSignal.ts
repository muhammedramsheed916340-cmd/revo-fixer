/**
 * HUMAN WHEEL DEALER / AGENT SIGNAL — EXPERIMENTAL LAYER (ADDITIVE)
 * =================================================================
 *
 * NEW FILE. Nothing existing is modified. This layer treats "the person
 * operating the wheel" as a SEPARATE, INDEPENDENT predictive signal and keeps
 * it completely separate from history/time/physics until each has been
 * measured on its own. OFF by default (see `signalFlags.ts` → DEALER_SIGNAL).
 *
 * IDENTITY SAFETY (enforced, not just documented)
 * -----------------------------------------------
 *   - Only information legitimately visible/available from the public game
 *     interface or an authorized data source may be stored:
 *       · a dealer id we mint ourselves for the observed session
 *       · a display name ONLY if the game UI itself shows one
 *       · a coarse, non-reversible appearance descriptor (downscaled average
 *         luminance grid) — explicitly NOT facial recognition, NOT biometric
 *         identification, and never matched against any external database
 *       · table/game identifier, timestamps, round statistics, wheel physics
 *   - `assertIdentitySafety()` rejects anything that looks like private data
 *     (email/phone/address/national id/…). No sensitive personal attribute is
 *     ever inferred, and none is used as a feature.
 *
 * WHAT EACH PROFILE STORES
 * ------------------------
 *   dealerId · name (public UI only) · visual descriptor id · table id ·
 *   session start/end · exact timestamps · rounds operated · total rounds ·
 *   outcome distribution over all 8 outcomes · 1/2/5/10 frequency · bonus
 *   frequency · recent 10/25/50/100 statistics · transition statistics ·
 *   wheel-direction statistics · speed/deceleration statistics (when video
 *   data exists) — plus the A/B/C/D/E statistical comparisons:
 *     A = results while dealer X is operating
 *     B = results BEFORE dealer X started
 *     C = results AFTER dealer X left
 *     D = results while other dealers are operating
 *     E = overall wheel baseline
 *
 * The dealer signal can only influence a prediction when its own regime gate
 * passes (enough samples + significant difference + stable across sessions)
 * AND its feature flag is ON (which requires a passed out-of-sample validation
 * report). Until then it is diagnostic-only, exactly as required.
 */

import {
  chiSquareGoodnessOfFit,
  chiSquareHomogeneity,
  benjaminiHochberg,
  makeTestResult,
  round as roundTo,
  safeDiv,
  totalVariationDistance,
  wilsonInterval,
  type TestResult,
} from "./signalStats";
import { BONUS_OUTCOMES_8, OUTCOMES_8, THEORETICAL_BASE_54, type TimedRound } from "./timeSignal";
import type { WheelDirection } from "./wheelPhysicsLayer";

export const DEALER_SIGNAL_VERSION = "dealer-signal-v1.0";

// ============================================================
// 0. IDENTITY SAFETY
// ============================================================

const FORBIDDEN_IDENTITY_KEYS = [
  "email", "e-mail", "phone", "mobile", "address", "street", "postcode", "zip",
  "ssn", "socialsecurity", "nationalid", "passport", "iban", "card", "cvv",
  "birthdate", "birthday", "dob", "age", "gender", "ethnicity", "religion",
  "salary", "income", "health", "medical", "biometric", "fingerprint", "faceid",
];

export interface IdentitySafetyReport {
  passed: boolean;
  violations: string[];
  policy: string;
}

/**
 * Reject any dealer profile key that could be private personal data.
 * This runs on every profile write; a failing write is refused, not sanitised
 * silently (the caller must decide what to do — the layer never guesses).
 */
export function assertIdentitySafety(keys: string[]): IdentitySafetyReport {
  const violations: string[] = [];
  for (const key of keys) {
    const normalized = key.toLowerCase().replace(/[_\-\s]/g, "");
    for (const forbidden of FORBIDDEN_IDENTITY_KEYS) {
      if (normalized.includes(forbidden)) violations.push(`${key} (matches "${forbidden}")`);
    }
  }
  return {
    passed: violations.length === 0,
    violations,
    policy:
      "Only public-UI data (name if shown), a self-minted dealer id, a coarse non-reversible appearance descriptor, table id, timestamps and wheel statistics may be stored. No private data, no external-database identification, no sensitive attribute inference.",
  };
}

/** Public-UI name gate: accept only short printable labels; reject anything
 *  that looks like contact/private information. */
export function sanitizePublicName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return null;
  if (/[@<>]|https?:|\d{6,}/.test(trimmed)) return null;
  if (!/^[\p{L}\p{N} .'\-_]+$/u.test(trimmed)) return null;
  return trimmed;
}

// ============================================================
// 1. APPEARANCE DESCRIPTOR (coarse, non-reversible, non-biometric)
// ============================================================

export const APPEARANCE_DESCRIPTOR_BINS = 8;

export interface AppearanceDescriptor {
  /** Downscaled average-luminance grid (values 0..1). Coarse by design. */
  bins: number[];
  /** Quantized stable id derived from the coarse bins (no identity content). */
  visualId: number;
  capturedAt: number;
  samples: number;
}

/**
 * Build a coarse appearance descriptor from a downscaled luminance grid.
 * This is a LOW-RESOLUTION average-brightness signature (8 bins): it is
 * deliberately too coarse to be a face template, cannot be reversed to an
 * image, and is never compared against external data.
 */
export function describeAppearance(coarseLuma: number[], capturedAt: number, samples = 1): AppearanceDescriptor {
  const bins = coarseLuma.slice(0, APPEARANCE_DESCRIPTOR_BINS).map((v) => {
    const x = Number.isFinite(v) ? v : 0;
    return roundTo(Math.max(0, Math.min(1, x)), 4);
  });
  while (bins.length < APPEARANCE_DESCRIPTOR_BINS) bins.push(0);
  // Quantize each bin into 4 levels → at most 4^8 coarse classes.
  let visualId = 0;
  for (let i = 0; i < bins.length; i++) {
    const level = Math.min(3, Math.floor(bins[i] * 4));
    visualId = visualId * 4 + level;
  }
  return { bins, visualId, capturedAt, samples };
}

/** L1 distance between two coarse descriptors (0..bins). */
export function appearanceDistance(a: AppearanceDescriptor, b: AppearanceDescriptor): number {
  let s = 0;
  for (let i = 0; i < APPEARANCE_DESCRIPTOR_BINS; i++) s += Math.abs((a.bins[i] ?? 0) - (b.bins[i] ?? 0));
  return s;
}

export const APPEARANCE_MATCH_THRESHOLD = 0.9; // L1 sum over 8 bins (≈0.11 per bin)

// ============================================================
// 1b. DEALER POSITION (video geometry — measured, never hardcoded)
// ============================================================
// The dealer position is derived from WHERE the frame-to-frame image change is
// concentrated: the live frame is reduced to a coarse column-luminance grid and
// the temporal change is summed per screen third (left third / middle / right
// third). This is a MOVEMENT-LOCALISATION estimate (the person operating the
// table is the dominant moving subject in the frame), NOT a face detector and
// NOT a biometric measure.
//
// It only answers when the evidence is concentrated enough (share of the total
// change energy in the winning third, plus a minimum absolute energy). Below
// that it returns UNKNOWN with the exact reason — the position is never guessed
// and never hardcoded.

export type DealerPosition = "LEFT" | "CENTER" | "RIGHT" | "UNKNOWN";

export const DEALER_POSITION_COLUMNS = 12;
export const DEALER_POSITION_MIN_SHARE = 0.5;   // winning third must own ≥50% of the change energy
export const DEALER_POSITION_MIN_ENERGY = 0.02; // minimum mean |Δluma| for the frame to carry any signal

export interface DealerPositionEstimate {
  position: DealerPosition;
  confidence: number;                 // 0..1
  method: "frame-change-localization";
  share: number;                      // share of the change energy in the winning third
  energy: number;                     // total change energy of the sample
  thirds: { left: number; center: number; right: number };
  reason: string;
  timestamp: number;
}

function thirdsOf(columns: number[]): { left: number; center: number; right: number; bounds: [number, number][] } {
  const n = columns.length;
  const third = Math.max(1, Math.round(n / 3));
  const ranges: [number, number][] = [
    [0, third],
    [third, Math.min(n, third * 2)],
    [Math.min(n, third * 2), n],
  ];
  const sums = ranges.map(([a, b]) => columns.slice(a, b).reduce((acc, v) => acc + Math.abs(Number.isFinite(v) ? v : 0), 0));
  return { left: sums[0], center: sums[1], right: sums[2], bounds: ranges };
}

/**
 * Estimate the dealer position from two consecutive coarse column-luminance
 * samples of the live frame. `previousColumns` is required — a single frame
 * carries no movement information, and the estimator says so instead of
 * inventing a position.
 */
export function estimateDealerPosition(input: {
  columns: number[] | null | undefined;
  previousColumns: number[] | null | undefined;
  timestamp: number;
}): DealerPositionEstimate {
  const empty: DealerPositionEstimate = {
    position: "UNKNOWN",
    confidence: 0,
    method: "frame-change-localization",
    share: 0,
    energy: 0,
    thirds: { left: 0, center: 0, right: 0 },
    reason: "no frame data",
    timestamp: input.timestamp,
  };
  const cols = input.columns;
  const prev = input.previousColumns;
  if (!Array.isArray(cols) || cols.length < 6) {
    return { ...empty, reason: `frame grid too small (${Array.isArray(cols) ? cols.length : 0} columns)` };
  }
  if (!Array.isArray(prev) || prev.length !== cols.length) {
    return { ...empty, reason: "waiting for a second frame (position needs frame-to-frame change)" };
  }
  const delta = cols.map((c, i) => Math.abs((Number.isFinite(c) ? c : 0) - (Number.isFinite(prev[i]) ? prev[i] : 0)));
  const energy = delta.reduce((a, b) => a + b, 0) / delta.length;
  const thirds = thirdsOf(delta);
  const total = thirds.left + thirds.center + thirds.right;
  if (total <= 0 || energy < DEALER_POSITION_MIN_ENERGY) {
    return {
      ...empty,
      energy: roundTo(energy, 5),
      reason: `frame change too small (energy ${energy.toFixed(4)} < ${DEALER_POSITION_MIN_ENERGY}) — person/table not localisable in this sample`,
    };
  }
  const ranked = ([
    { key: "LEFT", value: thirds.left },
    { key: "CENTER", value: thirds.center },
    { key: "RIGHT", value: thirds.right },
  ] as { key: DealerPosition; value: number }[]).sort((a, b) => b.value - a.value);
  const share = ranked[0].value / total;
  if (share < DEALER_POSITION_MIN_SHARE) {
    return {
      position: "UNKNOWN",
      confidence: roundTo(share, 4),
      method: "frame-change-localization",
      share: roundTo(share, 4),
      energy: roundTo(energy, 5),
      thirds: { left: roundTo(thirds.left, 5), center: roundTo(thirds.center, 5), right: roundTo(thirds.right, 5) },
      reason: `change is spread across the frame (best third holds only ${(share * 100).toFixed(0)}% < ${(DEALER_POSITION_MIN_SHARE * 100).toFixed(0)}%) — position UNKNOWN rather than guessed`,
      timestamp: input.timestamp,
    };
  }
  return {
    position: ranked[0].key,
    confidence: roundTo(Math.min(1, share * (0.6 + 0.4 * Math.min(1, energy / 0.1))), 4),
    method: "frame-change-localization",
    share: roundTo(share, 4),
    energy: roundTo(energy, 5),
    thirds: { left: roundTo(thirds.left, 5), center: roundTo(thirds.center, 5), right: roundTo(thirds.right, 5) },
    reason: `change concentrated in the ${ranked[0].key.toLowerCase()} third (${(share * 100).toFixed(0)}% of frame change)`,
    timestamp: input.timestamp,
  };
}

// ============================================================
// 2. DEALER PROFILE MODEL
// ============================================================

export interface DealerWheelStats {
  roundsWithPhysics: number;
  directionCounts: { LEFT: number; RIGHT: number; UNKNOWN: number };
  avgSpeedDegPerSec: number | null;
  medianSpeedDegPerSec: number | null;
  avgDecelerationDegPerSec2: number | null;
  speedSamples: number;
}

export interface DealerObservation {
  timestamp: number;             // ms epoch of the observation (before the round settles)
  roundId?: string | null;
  spinId?: string | null;
  confidence: number;            // identification confidence 0..1 (never assumed 1)
  method: "appearance" | "public-name" | "manual" | "combined";
  /** MEASURED screen position of the dominant moving subject (video thirds). */
  position?: DealerPosition;
  positionConfidence?: number;
  positionReason?: string;
  physics?: {
    direction: WheelDirection;
    speed: number;
    deceleration: number;
  } | null;
}

export interface DealerSession {
  sessionId: string;
  startTimestamp: number;
  endTimestamp: number | null;
  rounds: number;
  observationCount: number;
}

export interface DealerProfile {
  dealerId: string;
  version: string;
  /** Public-UI name only (null when the game UI does not show one). */
  name: string | null;
  tableId: string | null;
  descriptor: AppearanceDescriptor | null;
  firstSeen: number;
  lastSeen: number;
  sessions: DealerSession[];
  observations: DealerObservation[];
  /** Outcomes of rounds confirmed under this dealer (roundId → outcome). */
  rounds: { roundId: string; spinId: string; outcome: string; settledAt: number }[];
  wheel: DealerWheelStats;
  /** MEASURED position: latest confident estimate + how often each was seen. */
  position: {
    current: DealerPosition;
    confidence: number;
    counts: { LEFT: number; CENTER: number; RIGHT: number; UNKNOWN: number };
    lastReason: string;
  };
  /** Identification quality across observations. */
  identification: { meanConfidence: number; observations: number; appearances: number; names: number };
}

let profiles: DealerProfile[] = [];
const dealerListeners = new Set<() => void>();
let profileVersion = 0;
function notifyDealer(): void {
  profileVersion++;
  dealerListeners.forEach((l) => l());
}
export function subscribeDealers(cb: () => void): () => void {
  dealerListeners.add(cb);
  return () => dealerListeners.delete(cb);
}
export function getDealerVersion(): number {
  return profileVersion;
}
export function getDealerProfiles(): DealerProfile[] {
  return profiles;
}
export function resetDealerProfiles(): void {
  profiles = [];
  notifyDealer();
}
export function getDealerProfile(dealerId: string): DealerProfile | null {
  return profiles.find((p) => p.dealerId === dealerId) ?? null;
}

const SESSION_GAP_MS = 10 * 60 * 1000; // 10 minutes without observation ends a session

function emptyWheelStats(): DealerWheelStats {
  return {
    roundsWithPhysics: 0,
    directionCounts: { LEFT: 0, RIGHT: 0, UNKNOWN: 0 },
    avgSpeedDegPerSec: null,
    medianSpeedDegPerSec: null,
    avgDecelerationDegPerSec2: null,
    speedSamples: 0,
  };
}

function newProfile(dealerId: string, timestamp: number, name: string | null, tableId: string | null, descriptor: AppearanceDescriptor | null): DealerProfile {
  return {
    dealerId,
    version: DEALER_SIGNAL_VERSION,
    name,
    tableId,
    descriptor,
    firstSeen: timestamp,
    lastSeen: timestamp,
    sessions: [{ sessionId: `${dealerId}-s1`, startTimestamp: timestamp, endTimestamp: null, rounds: 0, observationCount: 0 }],
    observations: [],
    rounds: [],
    wheel: emptyWheelStats(),
    identification: { meanConfidence: 0, observations: 0, appearances: descriptor ? 1 : 0, names: name ? 1 : 0 },
    position: {
      current: "UNKNOWN",
      confidence: 0,
      counts: { LEFT: 0, CENTER: 0, RIGHT: 0, UNKNOWN: 0 },
      lastReason: "no position observation yet",
    },
  };
}

let dealerIdCounter = 0;
function mintDealerId(timestamp: number, visualId: number | null): string {
  dealerIdCounter++;
  return `dealer-${timestamp.toString(36)}-${(visualId ?? 0).toString(36)}-${dealerIdCounter}`;
}

/**
 * Identify (or create) the dealer currently on screen.
 *
 * Matching is done on the COARSE appearance descriptor when the caller can
 * provide one; when a public-UI name is available and matches an existing
 * profile it takes precedence. When nothing matches with sufficient
 * confidence, a NEW profile is created — the layer never forces an identity.
 */
export function identifyDealer(input: {
  timestamp: number;
  descriptor?: number[] | null;
  publicName?: string | null;
  tableId?: string | null;
  identificationConfidence?: number;
  method?: DealerObservation["method"];
}): { dealerId: string; profile: DealerProfile; matched: boolean; confidence: number; method: DealerObservation["method"]; reason: string } {
  const name = sanitizePublicName(input.publicName);
  const tableId = input.tableId ?? null;
  const descriptor = input.descriptor ? describeAppearance(input.descriptor, input.timestamp) : null;

  // 1) public-UI name match (only when the UI itself exposes the name)
  if (name) {
    const named = profiles.find((p) => p.name === name && (!tableId || !p.tableId || p.tableId === tableId));
    if (named) {
      named.lastSeen = input.timestamp;
      if (descriptor) named.descriptor = descriptor;
      touchSession(named, input.timestamp);
      notifyDealer();
      return { dealerId: named.dealerId, profile: named, matched: true, confidence: 0.9, method: "public-name", reason: `Matched public-UI name "${name}".` };
    }
  }

  // 2) coarse appearance match
  if (descriptor) {
    let best: { profile: DealerProfile; distance: number } | null = null;
    for (const p of profiles) {
      if (!p.descriptor) continue;
      if (tableId && p.tableId && p.tableId !== tableId) continue;
      const d = appearanceDistance(descriptor, p.descriptor);
      if (!best || d < best.distance) best = { profile: p, distance: d };
    }
    if (best && best.distance <= APPEARANCE_MATCH_THRESHOLD) {
      const conf = roundTo(Math.max(0.3, 1 - best.distance / (APPEARANCE_DESCRIPTOR_BINS)), 4);
      best.profile.lastSeen = input.timestamp;
      best.profile.descriptor = descriptor;
      touchSession(best.profile, input.timestamp);
      notifyDealer();
      return {
        dealerId: best.profile.dealerId,
        profile: best.profile,
        matched: true,
        confidence: conf,
        method: "appearance",
        reason: `Coarse appearance distance ${best.distance.toFixed(2)} ≤ threshold ${APPEARANCE_MATCH_THRESHOLD}.`,
      };
    }
  }

  // 3) no match → create a new profile (never force an identity)
  const dealerId = mintDealerId(input.timestamp, descriptor?.visualId ?? null);
  const profile = newProfile(dealerId, input.timestamp, name, tableId, descriptor);
  profiles = [...profiles, profile];
  notifyDealer();
  return {
    dealerId,
    profile,
    matched: false,
    confidence: 0.3,
    method: name ? "public-name" : "appearance",
    reason: name ? `New dealer profile created for public-UI name "${name}".` : "No confident match — a NEW dealer profile was created (identity is never forced).",
  };
}

function touchSession(profile: DealerProfile, timestamp: number): void {
  const last = profile.sessions[profile.sessions.length - 1];
  if (!last || timestamp - last.endTimestamp! > SESSION_GAP_MS || (last.endTimestamp !== null && timestamp - last.endTimestamp > SESSION_GAP_MS)) {
    profile.sessions.push({ sessionId: `${profile.dealerId}-s${profile.sessions.length + 1}`, startTimestamp: timestamp, endTimestamp: null, rounds: 0, observationCount: 0 });
    return;
  }
  if (last.endTimestamp !== null && timestamp - last.endTimestamp <= SESSION_GAP_MS) last.endTimestamp = timestamp;
}

/** Record one identification observation (called before a prediction lock). */
export function recordDealerObservation(input: {
  dealerId: string;
  observation: DealerObservation;
}): { accepted: boolean; reason: string } {
  const profile = getDealerProfile(input.dealerId);
  if (!profile) return { accepted: false, reason: `unknown dealerId ${input.dealerId}` };
  const safety = assertIdentitySafety(Object.keys(input.observation as unknown as Record<string, unknown>));
  if (!safety.passed) return { accepted: false, reason: `identity safety violation: ${safety.violations.join(", ")}` };

  profile.observations = [...profile.observations, input.observation];
  profile.lastSeen = Math.max(profile.lastSeen, input.observation.timestamp);

  // MEASURED screen position (video thirds). Only a confident estimate updates
  // the "current" value; UNKNOWN observations are still counted and keep their
  // reason so the UI can explain why the position is unknown.
  const observedPosition: DealerPosition = input.observation.position ?? "UNKNOWN";
  profile.position.counts[observedPosition]++;
  if (observedPosition !== "UNKNOWN") {
    profile.position.current = observedPosition;
    profile.position.confidence = roundTo(input.observation.positionConfidence ?? 0, 4);
    profile.position.lastReason = input.observation.positionReason ?? "measured from frame-change localization";
  } else {
    profile.position.lastReason = input.observation.positionReason ?? "no confident position estimate for this sample";
  }
  touchSession(profile, input.observation.timestamp);
  const last = profile.sessions[profile.sessions.length - 1];
  last.observationCount++;
  last.endTimestamp = input.observation.timestamp;

  if (input.observation.physics) {
    const w = profile.wheel;
    w.roundsWithPhysics++;
    w.directionCounts[input.observation.physics.direction]++;
    w.speedSamples++;
    const prev = w.avgSpeedDegPerSec ?? 0;
    w.avgSpeedDegPerSec = roundTo(prev + (input.observation.physics.speed - prev) / w.speedSamples, 3);
    const prevDecel = w.avgDecelerationDegPerSec2 ?? 0;
    w.avgDecelerationDegPerSec2 = roundTo(prevDecel + (input.observation.physics.deceleration - prevDecel) / w.speedSamples, 3);
    const speeds = profile.observations.map((o) => o.physics?.speed).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
    w.medianSpeedDegPerSec = speeds.length > 0 ? roundTo(speeds[Math.floor(speeds.length / 2)], 3) : null;
  }

  const withConfidence = profile.observations.reduce((s, o) => s + o.confidence, 0);
  profile.identification = {
    meanConfidence: roundTo(safeDiv(withConfidence, profile.observations.length), 4),
    observations: profile.observations.length,
    appearances: profile.observations.filter((o) => o.method === "appearance" || o.method === "combined").length,
    names: profile.observations.filter((o) => o.method === "public-name" || o.method === "combined").length,
  };
  notifyDealer();
  return { accepted: true, reason: "ok" };
}

/**
 * Attach a settled round to the dealer who operated it.
 * STRICT: the observation that attributed the round must precede the round's
 * settlement (no post-result attribution), and the round must be unique.
 */
export function attachRoundToDealer(input: {
  dealerId: string;
  round: TimedRound;
  attributedAt: number;
}): { accepted: boolean; reason: string } {
  const profile = getDealerProfile(input.dealerId);
  if (!profile) return { accepted: false, reason: `unknown dealerId ${input.dealerId}` };
  if (input.attributedAt > input.round.settledAt) {
    return { accepted: false, reason: "attribution happened after settlement — rejected (no post-result dealer assignment)" };
  }
  if (profile.rounds.some((r) => r.roundId === input.round.roundId)) {
    return { accepted: false, reason: "duplicate round for this dealer" };
  }
  profile.rounds = [...profile.rounds, { roundId: input.round.roundId, spinId: input.round.spinId, outcome: input.round.outcome, settledAt: input.round.settledAt }];
  const last = profile.sessions[profile.sessions.length - 1];
  if (last) last.rounds++;
  notifyDealer();
  return { accepted: true, reason: "ok" };
}

// ============================================================
// 3. DEALER STATISTICS
// ============================================================

export interface DealerOutcomeStat {
  outcome: string;
  count: number;
  observed: number;
  theoretical: number;
  deviation: number;
  relativeDeviation: number;
  zScore: number;
  pValue: number;
  significantAfterFDR: boolean;
}

export interface DealerWindowStats {
  label: string;
  sampleSize: number;
  counts: Record<string, number>;
  outcomes: DealerOutcomeStat[];
  bonusFrequency: { count: number; rate: number; theoretical: number };
  numberFrequency: Record<string, number>;
  transition: { pairCount: number; dominantFollow: string | null; note: string };
  chiSquare: TestResult;
}

function countsFrom(outcomes: string[]): Record<string, number> {
  const c: Record<string, number> = Object.fromEntries(OUTCOMES_8.map((o) => [o, 0]));
  for (const o of outcomes) if (c[o] !== undefined) c[o]++;
  return c;
}

export function dealerWindowStats(label: string, outcomes: string[], theoretical: Record<string, number> = THEORETICAL_BASE_54): DealerWindowStats {
  const n = outcomes.length;
  const counts = countsFrom(outcomes);
  const rawStats = OUTCOMES_8.map((o) => {
    const theo = theoretical[o] ?? 0;
    const observed = safeDiv(counts[o], n);
    const se = Math.sqrt(Math.max(1e-12, (theo * (1 - theo)) / Math.max(1, n)));
    const z = se > 0 ? (observed - theo) / se : 0;
    return {
      outcome: o,
      count: counts[o],
      observed,
      theoretical: theo,
      deviation: observed - theo,
      relativeDeviation: theo > 0 ? (observed - theo) / theo : 0,
      zScore: z,
      pValue: 2 * (1 - normalCdfLocal(Math.abs(z))),
      significantAfterFDR: false,
    };
  });
  const fdr = benjaminiHochberg(rawStats.map((s) => s.pValue), 0.05);
  rawStats.forEach((s, i) => (s.significantAfterFDR = fdr[i]));

  const bonusCount = BONUS_OUTCOMES_8.reduce((s, o) => s + counts[o], 0);
  const chi = chiSquareGoodnessOfFit(
    OUTCOMES_8.map((o) => counts[o]),
    OUTCOMES_8.map((o) => theoretical[o] ?? 0),
    { minSample: 40, name: `${label}: dealer distribution vs 54-sector theoretical` },
  );

  // transition (descriptive only)
  let dominantFollow: string | null = null;
  const followCounts = countsFrom([]);
  for (let i = 1; i < outcomes.length; i++) if (followCounts[outcomes[i]] !== undefined) followCounts[outcomes[i]]++;
  let best = -1;
  for (const o of OUTCOMES_8) if (followCounts[o] > best) { best = followCounts[o]; dominantFollow = o; }

  return {
    label,
    sampleSize: n,
    counts,
    outcomes: rawStats.map((s) => ({
      ...s,
      observed: roundTo(s.observed, 6),
      deviation: roundTo(s.deviation, 6),
      relativeDeviation: roundTo(s.relativeDeviation, 6),
      zScore: roundTo(s.zScore, 4),
      pValue: roundTo(s.pValue, 4),
    })),
    bonusFrequency: { count: bonusCount, rate: roundTo(safeDiv(bonusCount, n), 6), theoretical: BONUS_OUTCOMES_8.reduce((s, o) => s + (theoretical[o] ?? 0), 0) },
    numberFrequency: { "1": counts["1"], "2": counts["2"], "5": counts["5"], "10": counts["10"] },
    transition: { pairCount: Math.max(0, n - 1), dominantFollow, note: "Descriptive only — not used to predict without walk-forward validation." },
    chiSquare: chi.test,
  };
}

function normalCdfLocal(z: number): number {
  // erf approximation (same constants as signalStats.normalCdf)
  const sign = z < 0 ? -1 : 1;
  const ax = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export interface DealerFullStats {
  dealerId: string;
  name: string | null;
  totalRounds: number;
  all: DealerWindowStats;
  recent10: DealerWindowStats;
  recent25: DealerWindowStats;
  recent50: DealerWindowStats;
  recent100: DealerWindowStats;
  sessions: { sessionId: string; start: number; end: number | null; rounds: number; durationMs: number | null }[];
  wheel: DealerWheelStats;
  identification: DealerProfile["identification"];
}

export function dealerFullStats(dealerId: string): DealerFullStats | null {
  const profile = getDealerProfile(dealerId);
  if (!profile) return null;
  const outcomes = profile.rounds.map((r) => r.outcome);
  const tail = (k: number) => outcomes.slice(-k);
  return {
    dealerId: profile.dealerId,
    name: profile.name,
    totalRounds: outcomes.length,
    all: dealerWindowStats("all rounds with this dealer", outcomes),
    recent10: dealerWindowStats("last 10", tail(10)),
    recent25: dealerWindowStats("last 25", tail(25)),
    recent50: dealerWindowStats("last 50", tail(50)),
    recent100: dealerWindowStats("last 100", tail(100)),
    sessions: profile.sessions.map((s) => ({
      sessionId: s.sessionId,
      start: s.startTimestamp,
      end: s.endTimestamp,
      rounds: s.rounds,
      durationMs: s.endTimestamp !== null ? s.endTimestamp - s.startTimestamp : null,
    })),
    wheel: { ...profile.wheel, directionCounts: { ...profile.wheel.directionCounts } },
    identification: { ...profile.identification },
  };
}

// ============================================================
// 4. A/B/C/D/E COMPARISONS
// ============================================================

export interface DealerComparison {
  key: "A" | "B" | "C" | "D" | "E";
  label: string;
  sampleSize: number;
  counts: Record<string, number>;
  rates: Record<string, number>;
  testVsA: TestResult;
  tvdVsA: number;
}

export interface DealerComparisonReport {
  dealerId: string;
  descriptions: Record<"A" | "B" | "C" | "D" | "E", string>;
  comparisons: DealerComparison[];
  notes: string[];
}

/**
 * A = results while dealer X is operating
 * B = results before dealer X started (the rounds immediately preceding the
 *     dealer's first round in the current observation set)
 * C = results after dealer X left (rounds immediately following the dealer's
 *     last observed round)
 * D = results while other dealers are operating
 * E = overall wheel baseline (all rounds)
 *
 * Only rounds that were ALREADY settled at `asOfTimestamp` are used.
 */
export function compareDealerToBaseline(profile: DealerProfile, allRounds: TimedRound[], asOfTimestamp: number): DealerComparisonReport {
  const available = allRounds.filter((r) => r.settledAt <= asOfTimestamp);
  const dealerRoundIds = new Set(profile.rounds.map((r) => r.roundId));
  const dealerFirst = profile.rounds.length > 0 ? Math.min(...profile.rounds.map((r) => r.settledAt)) : null;
  const dealerLast = profile.rounds.length > 0 ? Math.max(...profile.rounds.map((r) => r.settledAt)) : null;
  const beforeCut = profile.firstSeen;

  const setA = available.filter((r) => dealerRoundIds.has(r.roundId));
  const setB = beforeCut !== null ? available.filter((r) => r.settledAt < beforeCut && (dealerFirst === null || r.settledAt < dealerFirst)) : [];
  const setC = dealerLast !== null ? available.filter((r) => r.settledAt > dealerLast) : [];
  const setD = available.filter((r) => !dealerRoundIds.has(r.roundId));
  const setE = available;

  const toCounts = (rounds: TimedRound[]) => countsFrom(rounds.map((r) => r.outcome));
  const toRates = (counts: Record<string, number>, n: number) => Object.fromEntries(OUTCOMES_8.map((o) => [o, roundTo(safeDiv(counts[o], n), 6)]));

  const countsA = toCounts(setA);
  const entries: { key: DealerComparison["key"]; label: string; rounds: TimedRound[]; counts: Record<string, number> }[] = [
    { key: "B", label: "Results BEFORE this dealer started", rounds: setB, counts: toCounts(setB) },
    { key: "C", label: "Results AFTER this dealer left", rounds: setC, counts: toCounts(setC) },
    { key: "D", label: "Results while OTHER dealers operate", rounds: setD, counts: toCounts(setD) },
    { key: "E", label: "Overall wheel baseline", rounds: setE, counts: toCounts(setE) },
  ];

  const comparisons: DealerComparison[] = [
    {
      key: "A",
      label: "Results while this dealer operates",
      sampleSize: setA.length,
      counts: countsA,
      rates: toRates(countsA, setA.length),
      testVsA: makeTestResult({
        name: "A vs A (reference)",
        statistic: 0,
        df: null,
        pValue: 1,
        alpha: 0.05,
        conclusive: setA.length >= 40,
        sampleSize: setA.length,
        effectSize: 0,
        note: setA.length >= 40 ? "Reference distribution." : `INCONCLUSIVE — only ${setA.length} rounds with this dealer (need ≥40 before any comparison is meaningful).`,
      }),
      tvdVsA: 0,
    },
    ...entries.map((e) => {
      const test = chiSquareHomogeneity(
        OUTCOMES_8.map((o) => countsA[o]),
        OUTCOMES_8.map((o) => e.counts[o]),
        { minSample: 40, name: `A vs ${e.key}` },
      ).test;
      const tvd = totalVariationDistance(
        OUTCOMES_8.map((o) => safeDiv(countsA[o], setA.length)),
        OUTCOMES_8.map((o) => safeDiv(e.counts[o], e.rounds.length)),
      );
      return {
        key: e.key,
        label: e.label,
        sampleSize: e.rounds.length,
        counts: e.counts,
        rates: toRates(e.counts, e.rounds.length),
        testVsA: test,
        tvdVsA: roundTo(tvd, 6),
      };
    }),
  ];

  return {
    dealerId: profile.dealerId,
    descriptions: {
      A: "Results while this dealer is operating",
      B: "Results before this dealer started",
      C: "Results after this dealer left",
      D: "Results while other dealers operate",
      E: "Overall wheel baseline",
    },
    comparisons,
    notes: [
      "Comparisons are DESCRIPTIVE until the regime gate passes AND the dealer signal has a passed out-of-sample validation.",
      "No dealer → outcome relationship is hardcoded anywhere; a difference must be statistically validated before it can influence a prediction.",
    ],
  };
}

// ============================================================
// 5. DEALER REGIME DETECTION
// ============================================================

export interface DealerRegimeGate {
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
  reasons: string[];
}

export interface DealerRegime {
  dealerId: string;
  status: "INSUFFICIENT_DATA" | "NO_REGIME" | "CANDIDATE_REGIME" | "CONFIRMED_REGIME";
  dealerSampleSize: number;
  baselineSampleSize: number;
  test: TestResult;
  tvd: number;
  persistence: { sessionsChecked: number; agreeingSessions: number; consistent: boolean; note: string };
  perOutcomeShift: { outcome: string; dealerRate: number; baselineRate: number; delta: number; zScore: number; pValue: number }[];
  gate: DealerRegimeGate;
  notes: string[];
}

export interface DealerRegimeOptions {
  minDealerRounds?: number;      // default 40
  minBaselineRounds?: number;    // default 100
  alpha?: number;                // default 0.01
  minEffectSize?: number;        // default 0.08
  minAgreeingSessions?: number;  // default 2
}

export const DEFAULT_DEALER_REGIME_OPTIONS: Required<DealerRegimeOptions> = {
  minDealerRounds: 40,
  minBaselineRounds: 100,
  alpha: 0.01,
  minEffectSize: 0.08,
  minAgreeingSessions: 2,
};

export function detectDealerRegime(
  profile: DealerProfile,
  allRounds: TimedRound[],
  asOfTimestamp: number,
  opts: DealerRegimeOptions = {},
): DealerRegime {
  const cfg = { ...DEFAULT_DEALER_REGIME_OPTIONS, ...opts };
  const available = allRounds.filter((r) => r.settledAt <= asOfTimestamp);
  const dealerRoundIds = new Set(profile.rounds.map((r) => r.roundId));
  const dealerRounds = available.filter((r) => dealerRoundIds.has(r.roundId));
  const baselineRounds = available;

  const dealerCounts = OUTCOMES_8.map((o) => dealerRounds.filter((r) => r.outcome === o).length);
  const baselineCounts = OUTCOMES_8.map((o) => baselineRounds.filter((r) => r.outcome === o).length);

  const homogeneity = chiSquareHomogeneity(dealerCounts, baselineCounts, {
    alpha: cfg.alpha,
    minSample: cfg.minDealerRounds,
    name: "dealer vs overall baseline",
  });
  const tvd = totalVariationDistance(
    dealerCounts.map((c) => safeDiv(c, dealerRounds.length)),
    baselineCounts.map((c) => safeDiv(c, baselineRounds.length)),
  );

  // Persistence: the dealer's own sessions must agree with the shift direction.
  const sessions = profile.sessions.filter((s) => s.rounds > 0);
  const dominant = OUTCOMES_8.map((o, i) => ({
    o,
    i,
    delta: safeDiv(dealerCounts[i], dealerRounds.length) - safeDiv(baselineCounts[i], baselineRounds.length),
  })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const baselineRate = safeDiv(baselineCounts[dominant.i], baselineRounds.length);
  let agreeingSessions = 0;
  for (const s of sessions) {
    const inSession = dealerRounds.filter((r) => r.settledAt >= s.startTimestamp && (s.endTimestamp === null || r.settledAt <= s.endTimestamp));
    if (inSession.length < 5) continue;
    const rate = inSession.filter((r) => r.outcome === dominant.o).length / inSession.length;
    if (Math.sign(rate - baselineRate) === Math.sign(dominant.delta) && Math.abs(rate - baselineRate) > 0) agreeingSessions++;
  }
  const consistent = sessions.length >= 2 && agreeingSessions >= cfg.minAgreeingSessions;

  const checks: DealerRegimeGate["checks"] = [
    { name: "dealer sample size", passed: dealerRounds.length >= cfg.minDealerRounds, detail: `n=${dealerRounds.length} (need ≥${cfg.minDealerRounds})` },
    { name: "baseline sample size", passed: baselineRounds.length >= cfg.minBaselineRounds, detail: `n=${baselineRounds.length} (need ≥${cfg.minBaselineRounds})` },
    { name: "test conclusive", passed: homogeneity.test.conclusive, detail: homogeneity.test.note },
    { name: "p < alpha", passed: homogeneity.test.conclusive && homogeneity.test.pValue < cfg.alpha, detail: `p=${homogeneity.test.pValue.toFixed(4)} vs α=${cfg.alpha}` },
    { name: "effect size clears bar", passed: tvd >= cfg.minEffectSize, detail: `TVD=${tvd.toFixed(3)} (need ≥${cfg.minEffectSize})` },
    { name: "stable across sessions", passed: consistent, detail: `${agreeingSessions}/${sessions.length} sessions agree (need ≥${cfg.minAgreeingSessions} across ≥2 sessions)` },
  ];
  const gate: DealerRegimeGate = {
    passed: checks.every((c) => c.passed),
    checks,
    reasons: checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`),
  };

  const perOutcomeShift = OUTCOMES_8.map((o, i) => {
    const dealerRate = safeDiv(dealerCounts[i], dealerRounds.length);
    const baseRate = safeDiv(baselineCounts[i], baselineRounds.length);
    const se = Math.sqrt(
      Math.max(1e-12, (dealerRate * (1 - dealerRate)) / Math.max(1, dealerRounds.length) + (baseRate * (1 - baseRate)) / Math.max(1, baselineRounds.length)),
    );
    const z = se > 0 ? (dealerRate - baseRate) / se : 0;
    return {
      outcome: o,
      dealerRate: roundTo(dealerRate, 6),
      baselineRate: roundTo(baseRate, 6),
      delta: roundTo(dealerRate - baseRate, 6),
      zScore: roundTo(z, 4),
      pValue: roundTo(2 * (1 - normalCdfLocal(Math.abs(z))), 4),
    };
  });

  let status: DealerRegime["status"];
  if (dealerRounds.length < cfg.minDealerRounds || baselineRounds.length < cfg.minBaselineRounds) status = "INSUFFICIENT_DATA";
  else if (gate.passed) status = "CONFIRMED_REGIME";
  else if (homogeneity.test.conclusive && homogeneity.test.pValue < cfg.alpha) status = "CANDIDATE_REGIME";
  else status = "NO_REGIME";

  return {
    dealerId: profile.dealerId,
    status,
    dealerSampleSize: dealerRounds.length,
    baselineSampleSize: baselineRounds.length,
    test: homogeneity.test,
    tvd: roundTo(tvd, 6),
    persistence: { sessionsChecked: sessions.length, agreeingSessions, consistent, note: `Dominant shifting outcome: ${dominant.o} (Δ=${(dominant.delta * 100).toFixed(2)} pp).` },
    perOutcomeShift,
    gate,
    notes: [
      status === "CONFIRMED_REGIME"
        ? `CONFIRMED dealer regime for ${profile.dealerId}: distribution differs from baseline (p=${homogeneity.test.pValue.toFixed(4)}, TVD=${tvd.toFixed(3)}) and is stable across sessions.`
        : status === "CANDIDATE_REGIME"
          ? `CANDIDATE dealer regime for ${profile.dealerId} (p=${homogeneity.test.pValue.toFixed(4)}) but the gate failed — ${gate.reasons.join("; ")}.`
          : status === "INSUFFICIENT_DATA"
            ? `INSUFFICIENT DATA for a dealer regime (dealer n=${dealerRounds.length}, baseline n=${baselineRounds.length}).`
            : `NO dealer regime: this dealer's distribution is statistically indistinguishable from the wheel baseline (p=${homogeneity.test.pValue.toFixed(4)}).`,
      "A dealer difference is NEVER attributed to the person as a cause — it is an observed statistical property of the rounds, validated out of sample before any use.",
    ],
  };
}

// ============================================================
// 6. TIME × DEALER CONTEXT
// ============================================================

export interface DealerTimeContext {
  dealerId: string;
  hour: number;
  sessionBlock: string;
  sessionDurationMs: number | null;
  roundsThisSession: number;
  recentResults: string[];
  wheelState: { direction: WheelDirection | "UNKNOWN"; avgSpeed: number | null; avgDeceleration: number | null } | null;
  dealerRoundsInThisHour: number;
  otherDealersSameHour: number;
  overallSameHour: number;
  comparisons: {
    dealerThisHourVsOtherHours: TestResult;
    dealerThisHourVsOtherDealersSameHour: TestResult;
    dealerThisHourVsOverall: TestResult;
  };
  note: string;
}

export function dealerTimeContext(
  profile: DealerProfile,
  allRounds: TimedRound[],
  asOfTimestamp: number,
  utcOffsetMinutes = 0,
): DealerTimeContext {
  const hourOf = (ts: number) => new Date(ts + utcOffsetMinutes * 60_000).getUTCHours();
  const currentHour = hourOf(asOfTimestamp);
  const available = allRounds.filter((r) => r.settledAt <= asOfTimestamp);
  const dealerRoundIds = new Set(profile.rounds.map((r) => r.roundId));
  const dealerRounds = available.filter((r) => dealerRoundIds.has(r.roundId));
  const thisHour = dealerRounds.filter((r) => hourOf(r.settledAt) === currentHour);
  const otherHours = dealerRounds.filter((r) => hourOf(r.settledAt) !== currentHour);
  const otherRoundsSameHour = available.filter((r) => hourOf(r.settledAt) === currentHour && !dealerRoundIds.has(r.roundId));

  const mk = (label: string, a: TimedRound[], b: TimedRound[]): TestResult =>
    chiSquareHomogeneity(
      OUTCOMES_8.map((o) => a.filter((r) => r.outcome === o).length),
      OUTCOMES_8.map((o) => b.filter((r) => r.outcome === o).length),
      { minSample: 40, name: label },
    ).test;

  const lastSession = profile.sessions[profile.sessions.length - 1];
  const wheel = profile.wheel.roundsWithPhysics > 0
    ? {
        direction: (profile.wheel.directionCounts.LEFT >= profile.wheel.directionCounts.RIGHT
          ? (profile.wheel.directionCounts.LEFT === 0 && profile.wheel.directionCounts.RIGHT === 0 ? "UNKNOWN" : "LEFT")
          : "RIGHT") as WheelDirection | "UNKNOWN",
        avgSpeed: profile.wheel.avgSpeedDegPerSec,
        avgDeceleration: profile.wheel.avgDecelerationDegPerSec2,
      }
    : null;

  return {
    dealerId: profile.dealerId,
    hour: currentHour,
    sessionBlock: String(hourOf(asOfTimestamp)),
    sessionDurationMs: lastSession && lastSession.endTimestamp !== null ? lastSession.endTimestamp - lastSession.startTimestamp : null,
    roundsThisSession: lastSession?.rounds ?? 0,
    recentResults: dealerRounds.slice(-10).map((r) => r.outcome),
    wheelState: wheel,
    dealerRoundsInThisHour: thisHour.length,
    otherDealersSameHour: otherRoundsSameHour.length,
    overallSameHour: thisHour.length + otherRoundsSameHour.length,
    comparisons: {
      dealerThisHourVsOtherHours: mk("dealer: this hour vs other hours", thisHour, otherHours),
      dealerThisHourVsOtherDealersSameHour: mk("dealer: this hour vs other dealers, same hour", thisHour, otherRoundsSameHour),
      dealerThisHourVsOverall: mk("dealer: this hour vs overall", thisHour, available),
    },
    note:
      "Dealer × time context is computed but only usable when BOTH the dealer signal and the time signal are independently validated — they are never merged before that.",
  };
}

// ============================================================
// 7. DEALER SIGNAL OUTPUT (ensemble channel)
// ============================================================

export interface DealerSignalDiagnostics {
  dealerId: string | null;
  dealerName: string | null;
  identificationConfidence: number;
  identificationMethod: string;
  roundsWithDealer: number;
  dealerHitRate: { hits: number; n: number; rate: number; ci95Low: number; ci95High: number } | null;
  dealerDistribution: Record<string, number>;
  baselineDistribution: Record<string, number>;
  dealerVsBaseline: { tvd: number; pValue: number; significant: boolean; conclusive: boolean; note: string };
  statisticalConfidence: number;
  status: "ACTIVE" | "INSUFFICIENT" | "NON-SIGNIFICANT";
  explanation: string[];
  dealerTimeContext: DealerTimeContext | null;
}

export interface DealerSignalResult {
  version: string;
  lockTimestamp: number;
  latestUsedTimestamp: number | null;
  leakageSafe: boolean;
  active: boolean;
  activeReason: string;
  confidence: number;
  scores: Record<string, number>;       // 8 outcomes, sums to 1 (baseline when inactive)
  multipliers: Record<string, number>;  // capped dealer/baseline ratios
  regime: DealerRegime | null;
  profile: DealerProfile | null;
  diagnostics: DealerSignalDiagnostics;
  why: string[];
}

export interface ComputeDealerSignalInput {
  allRounds: TimedRound[];
  lockTimestamp: number;
  /** The dealer identified BEFORE the lock (null = nobody identified yet). */
  dealerId: string | null;
  /** The prediction that was previously locked for the dealer's rounds, used
   *  only to report the dealer's historical hit-rate (never to build it). */
  priorPredictions?: { roundId: string; top4: string[] }[];
  options?: { utcOffsetMinutes?: number; regime?: DealerRegimeOptions; maxMultiplier?: number };
}

/**
 * Compute the dealer signal for ONE lock.
 *
 * When no dealer is identified, or the dealer's sample is too small, or the
 * regime gate does not pass, the signal is INACTIVE and returns the
 * theoretical base (multipliers = 1) — it can then contribute nothing to the
 * ensemble. This is the structural guarantee that dealer information cannot
 * influence a prediction before validation.
 */
export function computeDealerSignal(input: ComputeDealerSignalInput): DealerSignalResult {
  const lockTimestamp = input.lockTimestamp;
  const maxMultiplier = input.options?.maxMultiplier ?? 1.35;
  const available = input.allRounds.filter((r) => r.settledAt <= lockTimestamp);
  const latestUsedTimestamp = available.length > 0 ? available[available.length - 1].settledAt : null;
  const leakageSafe = latestUsedTimestamp === null || latestUsedTimestamp <= lockTimestamp;

  const neutralScores: Record<string, number> = { ...THEORETICAL_BASE_54 };
  const neutralMultipliers: Record<string, number> = Object.fromEntries(OUTCOMES_8.map((o) => [o, 1]));

  const profile = input.dealerId ? getDealerProfile(input.dealerId) : null;
  if (!profile) {
    return {
      version: DEALER_SIGNAL_VERSION,
      lockTimestamp,
      latestUsedTimestamp,
      leakageSafe,
      active: false,
      activeReason: input.dealerId ? `INSUFFICIENT — dealer ${input.dealerId} has no stored profile yet.` : "INACTIVE — no dealer identified before the lock (nothing to use).",
      confidence: 0,
      scores: neutralScores,
      multipliers: neutralMultipliers,
      regime: null,
      profile: null,
      diagnostics: {
        dealerId: input.dealerId,
        dealerName: null,
        identificationConfidence: 0,
        identificationMethod: "none",
        roundsWithDealer: 0,
        dealerHitRate: null,
        dealerDistribution: {},
        baselineDistribution: { ...THEORETICAL_BASE_54 },
        dealerVsBaseline: { tvd: 0, pValue: 1, significant: false, conclusive: false, note: "No dealer identified." },
        statisticalConfidence: 0,
        status: "INSUFFICIENT",
        explanation: ["No dealer identified before the lock → the dealer signal contributes nothing."],
        dealerTimeContext: null,
      },
      why: ["Dealer signal INACTIVE (no dealer identified before the lock). No dealer influence is possible."],
    };
  }

  const regime = detectDealerRegime(profile, input.allRounds, lockTimestamp, input.options?.regime ?? {});
  const stats = dealerFullStats(profile.dealerId);
  const dealerOutcomes = profile.rounds.map((r) => r.outcome);
  const n = dealerOutcomes.length;
  const dealerCounts = countsFrom(dealerOutcomes);
  const baselineCounts = countsFrom(available.map((r) => r.outcome));
  const baselineN = available.length;

  // Hit-rate of the DEALER's own rounds under the predictions that were
  // actually locked live for them (missing predictions simply do not count).
  let hits = 0;
  let evaluated = 0;
  if (input.priorPredictions) {
    const byRound = new Map(input.priorPredictions.map((p) => [p.roundId, p.top4]));
    for (const r of profile.rounds) {
      const top4 = byRound.get(r.roundId);
      if (!top4) continue;
      evaluated++;
      if (top4.includes(r.outcome)) hits++;
    }
  }
  const ci = wilsonInterval(hits, evaluated);

  // Multipliers: dealer distribution vs the overall baseline, shrunk toward 1
  // by sample size and capped, and only allowed to deviate when the regime
  // gate passed.
  const shrink = safeDiv(n, n + 40); // k=40 → a dealer needs many rounds to shift the base
  const multipliers: Record<string, number> = {};
  for (const o of OUTCOMES_8) {
    const dealerRate = safeDiv(dealerCounts[o], n);
    const baseRate = safeDiv(baselineCounts[o], baselineN);
    const ratio = baseRate > 0 ? dealerRate / baseRate : 1;
    const gated = regime.gate.passed ? 1 : 0; // no gate → no deviation at all
    const raw = 1 + gated * shrink * (ratio - 1);
    multipliers[o] = roundTo(Math.max(1 / maxMultiplier, Math.min(maxMultiplier, raw)), 6);
  }

  const scoreSum = OUTCOMES_8.reduce((s, o) => s + THEORETICAL_BASE_54[o] * multipliers[o], 0);
  const scores: Record<string, number> = {};
  for (const o of OUTCOMES_8) scores[o] = roundTo(safeDiv(THEORETICAL_BASE_54[o] * multipliers[o], scoreSum), 8);

  const status: DealerSignalDiagnostics["status"] =
    n < 40 ? "INSUFFICIENT" : regime.gate.passed ? "ACTIVE" : "NON-SIGNIFICANT";

  const confidence = regime.gate.passed
    ? roundTo(Math.min(1, safeDiv(n, n + 60) * 0.7 + Math.min(1, regime.tvd / 0.2) * 0.3), 4)
    : 0;

  const active = status === "ACTIVE" && leakageSafe;

  const dealerTime = dealerTimeContext(profile, input.allRounds, lockTimestamp, input.options?.utcOffsetMinutes ?? 0);

  const diagnostics: DealerSignalDiagnostics = {
    dealerId: profile.dealerId,
    dealerName: profile.name,
    identificationConfidence: profile.identification.meanConfidence,
    identificationMethod: profile.observations.length > 0 ? profile.observations[profile.observations.length - 1].method : "none",
    roundsWithDealer: n,
    dealerHitRate: evaluated > 0 ? { hits, n: evaluated, rate: roundTo(safeDiv(hits, evaluated), 4), ci95Low: roundTo(ci.low, 4), ci95High: roundTo(ci.high, 4) } : null,
    dealerDistribution: Object.fromEntries(OUTCOMES_8.map((o) => [o, roundTo(safeDiv(dealerCounts[o], n), 6)])),
    baselineDistribution: Object.fromEntries(OUTCOMES_8.map((o) => [o, roundTo(safeDiv(baselineCounts[o], baselineN), 6)])),
    dealerVsBaseline: {
      tvd: regime.tvd,
      pValue: roundTo(regime.test.pValue, 4),
      significant: regime.test.significant,
      conclusive: regime.test.conclusive,
      note: regime.test.note,
    },
    statisticalConfidence: confidence,
    status,
    explanation: [
      `Dealer ${profile.dealerId}${profile.name ? ` ("${profile.name}")` : ""}: ${n} round(s) attributed BEFORE the lock.`,
      regime.notes[0],
      active
        ? "DEALER SIGNAL ACTIVE — the regime gate passed, so the dealer distribution may influence the ensemble (still subject to the feature flag)."
        : `DEALER SIGNAL ${status} — it contributes NOTHING to the ensemble (multipliers = 1).`,
    ],
    dealerTimeContext: dealerTime,
  };

  void stats;

  return {
    version: DEALER_SIGNAL_VERSION,
    lockTimestamp,
    latestUsedTimestamp,
    leakageSafe,
    active,
    activeReason: active ? "ACTIVE — validated dealer regime gate passed." : `INACTIVE — status ${status}: ${regime.gate.reasons.join("; ") || "sample too small"}.`,
    confidence,
    scores,
    multipliers,
    regime,
    profile,
    diagnostics,
    why: diagnostics.explanation,
  };
}

/** Dealer-signal summary for the A–J validation arms (diagnostic). */
export interface DealerSignalSummary {
  dealers: number;
  totalRoundsAttributed: number;
  activeNow: number;
  note: string;
}

export function summarizeDealerSignal(): DealerSignalSummary {
  const total = profiles.reduce((s, p) => s + p.rounds.length, 0);
  return {
    dealers: profiles.length,
    totalRoundsAttributed: total,
    activeNow: profiles.filter((p) => p.rounds.length >= DEFAULT_DEALER_REGIME_OPTIONS.minDealerRounds).length,
    note: "Dealer statistics are only meaningful with real attributed rounds from the live UI; no synthetic dealer data is ever created.",
  };
}

// ============================================================
// 8. PERSISTENCE (additive — coarse, non-sensitive data only)
// ============================================================
// Only the identity-safe parts of a profile are persisted: the minted dealerId,
// the public-UI name (when the game showed one), the table id (when exposed),
// timestamps/sessions/rounds and the COARSE 8-bin appearance descriptor. No
// images and no biometric templates are ever stored.

export const DEALER_PROFILES_VERSION = "dealer-profiles-persist-v1";

export function exportDealerProfiles(): { version: string; profiles: DealerProfile[] } {
  return { version: DEALER_PROFILES_VERSION, profiles };
}

/** Restore persisted profiles. Never overwrites a profile seen in this session. */
export function importDealerProfiles(payload: unknown): { restored: number; skipped: number } {
  const data = payload as { version?: string; profiles?: DealerProfile[] } | null;
  if (!data || !Array.isArray(data.profiles)) return { restored: 0, skipped: 0 };
  let restored = 0;
  let skipped = 0;
  for (const p of data.profiles) {
    if (!p || typeof p.dealerId !== "string" || !Array.isArray(p.rounds) || !Array.isArray(p.sessions)) {
      skipped++;
      continue;
    }
    const existing = profiles.find((x) => x.dealerId === p.dealerId);
    if (existing) {
      // merge: keep the richer record, never shrink what we already have
      existing.rounds = existing.rounds.length >= p.rounds.length ? existing.rounds : p.rounds;
      existing.sessions = existing.sessions.length >= p.sessions.length ? existing.sessions : p.sessions;
      existing.lastSeen = Math.max(existing.lastSeen, p.lastSeen ?? 0);
      existing.descriptor = existing.descriptor ?? p.descriptor ?? null;
      existing.name = existing.name ?? p.name ?? null;
      if (existing.position.current === "UNKNOWN" && p.position && p.position.current !== "UNKNOWN") {
        existing.position = p.position;
      }
      restored++;
      continue;
    }
    profiles = [...profiles, {
      ...p,
      position: p.position ?? { current: "UNKNOWN", confidence: 0, counts: { LEFT: 0, CENTER: 0, RIGHT: 0, UNKNOWN: 0 }, lastReason: "restored from storage" },
    }];
    restored++;
  }
  if (restored > 0) notifyDealer();
  return { restored, skipped };
}
