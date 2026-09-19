/**
 * SIGNAL ENSEMBLE / FUSION LAYER (ADDITIVE — new file)
 * ====================================================
 *
 * Combines the INDEPENDENT channels after each has been measured on its own:
 *
 *     THEORETICAL BASE + HISTORY + TIME + DEALER + PHYSICS + ML/FUSION
 *
 * PROPERTIES GUARANTEED BY CONSTRUCTION
 * -------------------------------------
 *   · All 8 outcomes stay eligible. Selection is by FUSED SCORE only — there
 *     is no hardcoded composition, no fixed outcome, no forced bonus, no
 *     rotation, no random selection, and no last-result chasing.
 *   · Exactly 4 outcomes are selected, ranked by fused probability with a
 *     fully deterministic tie-break (prior, then name) so a replay is
 *     bit-identical.
 *   · When no experimental signal is enabled the layer returns the production
 *     prediction VERBATIM (mode "PRODUCTION_PASSTHROUGH") — the existing
 *     scorer stays in charge, unchanged.
 *   · A channel that is not enabled, has no data, or has low confidence gets
 *     weight 0 (its share is redistributed to the validated channels) — no
 *     signal can influence the result "for free".
 *   · Every output lists the per-channel weights, confidences and reasons, so
 *     the UI can explain exactly WHY a signal did or did not change the Top-4.
 */

import {
  clamp01,
  round as roundTo,
  safeDiv,
} from "./signalStats";
import {
  OUTCOMES_8,
  THEORETICAL_BASE_54,
  type TimeSignalResult,
} from "./timeSignal";
import type { DealerSignalResult } from "./dealerSignal";
import type { PhysicsEvidence } from "./wheelPhysicsLayer";
import {
  SIGNAL_FLAG_LABELS,
  getSignalFlags,
  type SignalFeatureFlags,
} from "./signalFlags";

export const ENSEMBLE_VERSION = "signal-ensemble-v1.0";

export type ChannelKey = "theoretical" | "history" | "time" | "dealer" | "physics" | "ml";

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  theoretical: "Theoretical 54-sector base",
  history: "History / production engine",
  time: "Time signal",
  dealer: "Dealer signal",
  physics: "Physics signal",
  ml: "ML / fusion model",
};

export interface ChannelWeights {
  theoretical: number;
  history: number;
  time: number;
  dealer: number;
  physics: number;
  ml: number;
}

export const DEFAULT_CHANNEL_WEIGHTS: ChannelWeights = {
  theoretical: 0.30,
  history: 0.40,
  time: 0.12,
  dealer: 0.06,
  physics: 0.12,
  ml: 0,
};

export interface EnsembleChannel {
  key: ChannelKey;
  label: string;
  flag: keyof SignalFeatureFlags | null; // which feature flag governs it (null = always-on base)
  enabled: boolean;
  available: boolean;
  /** "READY" when the channel produced real evidence for this lock,
   *  "INSUFFICIENT" when it has none — in which case `reason` says exactly why
   *  and its weight is forced to 0 (never treated as zero-quality evidence). */
  status: "READY" | "INSUFFICIENT";
  confidence: number;
  baseWeight: number;
  effectiveWeight: number;
  probabilities: Record<string, number> | null;
  reason: string;
}

export interface EnsembleInput {
  lockTimestamp: number;
  latestUsedTimestamp: number | null;
  physicalStopTimestamp?: number | null;
  actualResultTimestamp?: number | null;

  /** Channel data. `null` = the channel produced nothing for this lock. */
  historyProbabilities: Record<string, number> | null;
  historyTop4?: string[] | null;
  timeSignal?: TimeSignalResult | null;
  dealerSignal?: DealerSignalResult | null;
  physicsEvidence?: PhysicsEvidence | null;
  mlProbabilities?: Record<string, number> | null;

  options?: {
    weights?: Partial<ChannelWeights>;
    /** Signals that are ON but whose validation is not passed may be run in
     *  SHADOW mode: computed and displayed, but forced to weight 0. */
    shadowMode?: boolean;
    flagsOverride?: SignalFeatureFlags;
    minConfidenceForWeight?: number;
  };
}

export interface EnsembleOutput {
  version: string;
  lockTimestamp: number;
  mode: string;                       // e.g. "PRODUCTION_PASSTHROUGH", "HISTORY+TIME+PHYSICS"
  passthrough: boolean;               // true → the production prediction was returned unchanged
  top4: string[];
  all8Scores: Record<string, number>;
  probabilities: Record<string, number>;
  confidence: number;                 // 0..1 (fused probability of the weakest selected outcome)
  channels: EnsembleChannel[];
  weights: ChannelWeights;
  why: string[];
  integrity: {
    latestUsedTimestamp: number | null;
    lockTimestamp: number;
    physicalStopTimestamp: number | null;
    orderingOk: boolean;
    lockBeforeStop: boolean | null;
    noFutureInformation: boolean;
    top4Count: number;
    uniqueTop4: boolean;
  };
}

// ============================================================
// 1. HELPERS
// ============================================================

function normalizeVector(v: Record<string, number> | null | undefined, fallback: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  let sum = 0;
  for (const o of OUTCOMES_8) {
    const raw = v?.[o];
    const value = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
    out[o] = value;
    sum += value;
  }
  if (sum <= 0) {
    const fb: Record<string, number> = {};
    let fbs = 0;
    for (const o of OUTCOMES_8) {
      fb[o] = Math.max(0, fallback[o] ?? 0);
      fbs += fb[o];
    }
    if (fbs <= 0) return { ...THEORETICAL_BASE_54 };
    for (const o of OUTCOMES_8) fb[o] /= fbs;
    return fb;
  }
  for (const o of OUTCOMES_8) out[o] /= sum;
  return out;
}

function argMaxDeterministic(probs: Record<string, number>): string {
  let best = OUTCOMES_8[0];
  for (const o of OUTCOMES_8) {
    const a = probs[o] ?? 0;
    const b = probs[best] ?? 0;
    if (a > b + 1e-12) best = o;
    else if (Math.abs(a - b) <= 1e-12) {
      // deterministic tie-break: higher theoretical prior first, then name
      const pa = THEORETICAL_BASE_54[o];
      const pb = THEORETICAL_BASE_54[best];
      if (pa > pb) best = o;
      else if (pa === pb && o < best) best = o;
    }
  }
  return best;
}

/** Deterministic Top-4 selection: fused probability, then prior, then name. */
export function selectTop4Dynamic(probs: Record<string, number>, count = 4): string[] {
  const ordered = [...OUTCOMES_8].sort((a, b) => {
    const pa = probs[a] ?? 0;
    const pb = probs[b] ?? 0;
    if (Math.abs(pa - pb) > 1e-12) return pb - pa;
    const ta = THEORETICAL_BASE_54[a];
    const tb = THEORETICAL_BASE_54[b];
    if (Math.abs(ta - tb) > 1e-12) return tb - ta;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return ordered.slice(0, count);
}

// ============================================================
// 2. CHANNEL CONSTRUCTION
// ============================================================

function isEnabled(key: ChannelKey, flags: SignalFeatureFlags): boolean {
  switch (key) {
    case "theoretical":
    case "history":
      return true; // always-on base channels (the existing engine's own path)
    case "time":
      return flags.TIME_SIGNAL;
    case "dealer":
      return flags.DEALER_SIGNAL;
    case "physics":
      return flags.PHYSICS_SIGNAL;
    case "ml":
      return flags.FUSION; // ML participates only through the validated fusion flag
  }
}

export function buildChannels(input: EnsembleInput): EnsembleChannel[] {
  const flags = input.options?.flagsOverride ?? getSignalFlags();
  const minConfidence = input.options?.minConfidenceForWeight ?? 0.05;

  const channels: EnsembleChannel[] = [];

  // --- theoretical ---
  channels.push({
    key: "theoretical",
    label: CHANNEL_LABELS.theoretical,
    flag: null,
    enabled: true,
    available: true,
    status: "READY",
    confidence: 1,
    baseWeight: DEFAULT_CHANNEL_WEIGHTS.theoretical,
    effectiveWeight: 0,
    probabilities: { ...THEORETICAL_BASE_54 },
    reason: "Frozen 54-sector reference. Never replaced by an observed base.",
  });

  // --- history (production engine) ---
  const historyAvailable = !!input.historyProbabilities && Object.keys(input.historyProbabilities).length > 0;
  channels.push({
    key: "history",
    label: CHANNEL_LABELS.history,
    flag: null,
    enabled: true,
    available: historyAvailable,
    status: historyAvailable ? "READY" : "INSUFFICIENT",
    confidence: 0.9,
    baseWeight: DEFAULT_CHANNEL_WEIGHTS.history,
    effectiveWeight: 0,
    probabilities: historyAvailable ? normalizeVector(input.historyProbabilities, THEORETICAL_BASE_54) : null,
    reason: historyAvailable
      ? "Production engine's own 8-outcome evidence for this lock (unchanged scorer)."
      : "No production-engine probabilities supplied for this lock.",
  });

  // --- time ---
  const time = input.timeSignal ?? null;
  const timeEnabled = isEnabled("time", flags);
  const timeAvailable = !!time && time.active;
  channels.push({
    key: "time",
    label: CHANNEL_LABELS.time,
    flag: "TIME_SIGNAL",
    enabled: timeEnabled,
    available: timeAvailable,
    status: timeAvailable ? "READY" : "INSUFFICIENT",
    confidence: time?.confidence ?? 0,
    baseWeight: DEFAULT_CHANNEL_WEIGHTS.time,
    effectiveWeight: 0,
    probabilities: timeAvailable ? normalizeVector(time!.scores, THEORETICAL_BASE_54) : null,
    reason: !timeEnabled
      ? `Flag ${SIGNAL_FLAG_LABELS.TIME_SIGNAL} is OFF (time layer collects diagnostics only).`
      : timeAvailable
        ? `Time signal active: ${time!.activeReason}`
        : `Time signal inactive: ${time?.activeReason ?? "no time analysis for this lock"}`,
  });

  // --- dealer ---
  const dealer = input.dealerSignal ?? null;
  const dealerEnabled = isEnabled("dealer", flags);
  const dealerAvailable = !!dealer && dealer.active;
  channels.push({
    key: "dealer",
    label: CHANNEL_LABELS.dealer,
    flag: "DEALER_SIGNAL",
    enabled: dealerEnabled,
    available: dealerAvailable,
    status: dealerAvailable ? "READY" : "INSUFFICIENT",
    confidence: dealer?.confidence ?? 0,
    baseWeight: DEFAULT_CHANNEL_WEIGHTS.dealer,
    effectiveWeight: 0,
    probabilities: dealerAvailable ? normalizeVector(dealer!.scores, THEORETICAL_BASE_54) : null,
    reason: !dealerEnabled
      ? `Flag ${SIGNAL_FLAG_LABELS.DEALER_SIGNAL} is OFF (dealer layer collects diagnostics only).`
      : dealerAvailable
        ? `Dealer signal active for ${dealer!.diagnostics.dealerId}.`
        : `Dealer signal inactive: ${dealer?.activeReason ?? "no dealer identified before the lock"}`,
  });

  // --- physics ---
  const physics = input.physicsEvidence ?? null;
  const physicsEnabled = isEnabled("physics", flags);
  const physicsAvailable = !!physics && physics.evidence;
  channels.push({
    key: "physics",
    label: CHANNEL_LABELS.physics,
    flag: "PHYSICS_SIGNAL",
    enabled: physicsEnabled,
    available: physicsAvailable,
    status: physicsAvailable ? "READY" : "INSUFFICIENT",
    confidence: physics?.physicsConfidence ?? 0,
    baseWeight: DEFAULT_CHANNEL_WEIGHTS.physics,
    effectiveWeight: 0,
    probabilities: physicsAvailable ? normalizeVector(physics!.outcomeProbabilities, THEORETICAL_BASE_54) : null,
    reason: !physicsEnabled
      ? `Flag ${SIGNAL_FLAG_LABELS.PHYSICS_SIGNAL} is OFF (physics layer collects diagnostics only).`
      : physicsAvailable
        ? `Physics evidence available (${physics!.diagnostics.predictedSector}→${physics!.diagnostics.predictedOutcome}, confidence ${(physics!.physicsConfidence * 100).toFixed(0)}%).`
        : `Physics evidence unavailable: ${physics?.reason ?? "no video telemetry for this lock"}`,
  });

  // --- ml ---
  const mlAvailable = !!input.mlProbabilities && Object.keys(input.mlProbabilities).length > 0;
  channels.push({
    key: "ml",
    label: CHANNEL_LABELS.ml,
    flag: "FUSION",
    enabled: isEnabled("ml", flags),
    available: mlAvailable,
    status: mlAvailable ? "READY" : "INSUFFICIENT",
    confidence: mlAvailable ? 0.5 : 0,
    baseWeight: DEFAULT_CHANNEL_WEIGHTS.ml,
    effectiveWeight: 0,
    probabilities: mlAvailable ? normalizeVector(input.mlProbabilities, THEORETICAL_BASE_54) : null,
    reason: mlAvailable ? "ML channel supplied probabilities for this lock." : "No ML probabilities supplied for this lock.",
  });

  // Weights are applied only to channels that are enabled AND available AND
  // confident enough. Shadow mode keeps a channel's diagnostics but zeroes its
  // weight (used to display a signal without letting it influence anything).
  const weightOverrides = input.options?.weights ?? {};
  for (const ch of channels) {
    const base = { ...DEFAULT_CHANNEL_WEIGHTS, ...weightOverrides }[ch.key];
    ch.baseWeight = base;
    const usable =
      ch.enabled &&
      ch.available &&
      base > 0 &&
      ch.confidence >= minConfidence &&
      !(input.options?.shadowMode === true && ch.key !== "theoretical" && ch.key !== "history");
    ch.effectiveWeight = usable ? base * (0.25 + 0.75 * clamp01(ch.confidence)) : 0;
  }
  return channels;
}

// ============================================================
// 3. FUSION
// ============================================================

export function fuseSignals(input: EnsembleInput): EnsembleOutput {
  const channels = buildChannels(input);
  const usable = channels.filter((c) => c.effectiveWeight > 0 && c.probabilities);
  const experimentalUsable = usable.filter((c) => c.key !== "theoretical" && c.key !== "history");

  const totalWeight = usable.reduce((s, c) => s + c.effectiveWeight, 0);
  const weights: ChannelWeights = { theoretical: 0, history: 0, time: 0, dealer: 0, physics: 0, ml: 0 };
  for (const c of usable) weights[c.key] = roundTo(safeDiv(c.effectiveWeight, totalWeight), 6);

  const probabilities: Record<string, number> = {};
  for (const o of OUTCOMES_8) {
    let p = 0;
    for (const c of usable) p += (c.probabilities![o] ?? 0) * safeDiv(c.effectiveWeight, totalWeight);
    probabilities[o] = roundTo(clamp01(p), 8);
  }
  // renormalize (guards rounding drift)
  const pSum = OUTCOMES_8.reduce((s, o) => s + probabilities[o], 0);
  for (const o of OUTCOMES_8) probabilities[o] = roundTo(safeDiv(probabilities[o], pSum), 8);

  const passthrough = experimentalUsable.length === 0;
  const top4 = passthrough && input.historyTop4 && input.historyTop4.length === 4
    ? [...input.historyTop4]
    : selectTop4Dynamic(probabilities, 4);

  const mode = passthrough
    ? "PRODUCTION_PASSTHROUGH"
    : experimentalUsable.map((c) => c.key.toUpperCase()).sort().join("+");

  const confidence = top4.length > 0 ? Math.min(...top4.map((o) => probabilities[o] ?? 0)) : 0;

  const orderingOk = input.latestUsedTimestamp === null || input.latestUsedTimestamp <= input.lockTimestamp;
  const lockBeforeStop =
    input.physicalStopTimestamp === null || input.physicalStopTimestamp === undefined
      ? null
      : input.lockTimestamp < input.physicalStopTimestamp;
  const noFutureInformation =
    input.latestUsedTimestamp === null ||
    input.actualResultTimestamp === null ||
    input.actualResultTimestamp === undefined
      ? true
      : input.latestUsedTimestamp < input.actualResultTimestamp;

  const why: string[] = [];
  if (passthrough) {
    why.push("No experimental signal is enabled → the production engine's Top-4 is returned unchanged (production scorer untouched).");
  } else {
    why.push(`Fusion mode ${mode}: ${experimentalUsable.map((c) => `${c.key}@${(weights[c.key] * 100).toFixed(0)}%`).join(", ")} (theoretical/history carry the remaining weight).`);
  }
  for (const c of channels) {
    why.push(`· ${c.label}: weight ${(weights[c.key] * 100).toFixed(1)}% — ${c.reason}`);
  }
  if (!orderingOk) why.push("INTEGRITY: latestUsedTimestamp is after the lock timestamp — this record must be rejected.");
  if (lockBeforeStop === false) why.push("INTEGRITY: lock happened at/after the physical stop — a physics prediction from this lock is NOT valid.");

  return {
    version: ENSEMBLE_VERSION,
    lockTimestamp: input.lockTimestamp,
    mode,
    passthrough,
    top4,
    all8Scores: { ...probabilities },
    probabilities,
    confidence: roundTo(confidence, 6),
    channels,
    weights,
    why,
    integrity: {
      latestUsedTimestamp: input.latestUsedTimestamp,
      lockTimestamp: input.lockTimestamp,
      physicalStopTimestamp: input.physicalStopTimestamp ?? null,
      orderingOk,
      lockBeforeStop,
      noFutureInformation,
      top4Count: top4.length,
      uniqueTop4: new Set(top4).size === top4.length,
    },
  };
}

// ============================================================
// 4. ABLATION (used by the A–J validation harness)
// ============================================================

export type AblationArm =
  | "A_theoretical"
  | "B_history"
  | "C_time"
  | "D_dealer"
  | "E_physics"
  | "F_history_time"
  | "G_history_dealer"
  | "H_history_physics"
  | "I_time_dealer_physics"
  | "J_full";

export const ARM_LABELS: Record<AblationArm, string> = {
  A_theoretical: "A · theoretical [1,2,5,10]",
  B_history: "B · existing production history engine",
  C_time: "C · time-only",
  D_dealer: "D · dealer-only",
  E_physics: "E · physics-only",
  F_history_time: "F · history + time",
  G_history_dealer: "G · history + dealer",
  H_history_physics: "H · history + physics",
  I_time_dealer_physics: "I · time + dealer + physics",
  J_full: "J · full ensemble",
};

/**
 * Compute every arm from ONE lock's channel data.
 * Arms whose required channel has no real data are marked `available:false`
 * with a reason — they are never fabricated or silently replaced.
 */
export function computeArms(input: {
  lockTimestamp: number;
  latestUsedTimestamp: number | null;
  historyProbabilities: Record<string, number> | null;
  historyTop4?: string[] | null;
  timeScores?: Record<string, number> | null;
  timeActive?: boolean;
  timeConfidence?: number;
  dealerScores?: Record<string, number> | null;
  dealerActive?: boolean;
  dealerConfidence?: number;
  physicsProbabilities?: Record<string, number> | null;
  physicsActive?: boolean;
  physicsConfidence?: number;
  mlProbabilities?: Record<string, number> | null;
}): Record<AblationArm, { top4: string[]; available: boolean; reason: string; probabilities: Record<string, number> }> {
  const theoretical = { ...THEORETICAL_BASE_54 };
  const history = input.historyProbabilities ? normalizeVector(input.historyProbabilities, theoretical) : null;
  const time = input.timeActive && input.timeScores ? normalizeVector(input.timeScores, theoretical) : null;
  const dealer = input.dealerActive && input.dealerScores ? normalizeVector(input.dealerScores, theoretical) : null;
  const physics = input.physicsActive && input.physicsProbabilities ? normalizeVector(input.physicsProbabilities, theoretical) : null;

  const pool = (channels: { key: string; probs: Record<string, number> | null; weight: number }[]) => {
    const usable = channels.filter((c) => c.probs && c.weight > 0);
    const sum = usable.reduce((s, c) => s + c.weight, 0);
    const probs: Record<string, number> = {};
    for (const o of OUTCOMES_8) {
      let p = 0;
      for (const c of usable) p += (c.probs![o] ?? 0) * safeDiv(c.weight, sum);
      probs[o] = roundTo(clamp01(p), 8);
    }
    const s2 = OUTCOMES_8.reduce((s, o) => s + probs[o], 0);
    for (const o of OUTCOMES_8) probs[o] = roundTo(safeDiv(probs[o], s2), 8);
    return probs;
  };

  const makeArm = (
    channels: { key: string; probs: Record<string, number> | null; weight: number }[],
    required: ("history" | "time" | "dealer" | "physics")[],
  ) => {
    const missing = required.filter((r) => {
      if (r === "history") return !history;
      if (r === "time") return !time;
      if (r === "dealer") return !dealer;
      return !physics;
    });
    if (missing.length > 0) {
      return {
        top4: [],
        available: false,
        reason: `NO REAL DATA for ${missing.join(", ")} channel(s) — arm not evaluated (never fabricated).`,
        probabilities: {},
      };
    }
    const probs = pool(channels);
    return { top4: selectTop4Dynamic(probs, 4), available: true, reason: "ok", probabilities: probs };
  };

  return {
    A_theoretical: { top4: ["1", "2", "5", "10"], available: true, reason: "fixed theoretical set [1,2,5,10] (benchmark only — not a bet signal)", probabilities: theoretical },
    B_history: makeArm([{ key: "history", probs: history, weight: 1 }], ["history"]),
    C_time: makeArm([{ key: "time", probs: time, weight: 1 }], ["time"]),
    D_dealer: makeArm([{ key: "dealer", probs: dealer, weight: 1 }], ["dealer"]),
    E_physics: makeArm([{ key: "physics", probs: physics, weight: 1 }], ["physics"]),
    F_history_time: makeArm(
      [
        { key: "history", probs: history, weight: 0.7 },
        { key: "time", probs: time, weight: 0.3 },
      ],
      ["history", "time"],
    ),
    G_history_dealer: makeArm(
      [
        { key: "history", probs: history, weight: 0.8 },
        { key: "dealer", probs: dealer, weight: 0.2 },
      ],
      ["history", "dealer"],
    ),
    H_history_physics: makeArm(
      [
        { key: "history", probs: history, weight: 0.6 },
        { key: "physics", probs: physics, weight: 0.4 },
      ],
      ["history", "physics"],
    ),
    I_time_dealer_physics: makeArm(
      [
        { key: "time", probs: time, weight: 0.4 },
        { key: "dealer", probs: dealer, weight: 0.2 },
        { key: "physics", probs: physics, weight: 0.4 },
      ],
      ["time", "dealer", "physics"],
    ),
    J_full: makeArm(
      [
        { key: "history", probs: history, weight: 0.4 },
        { key: "time", probs: time, weight: 0.12 },
        { key: "dealer", probs: dealer, weight: 0.06 },
        { key: "physics", probs: physics, weight: 0.12 },
      ],
      ["history"],
    ),
  };
}
