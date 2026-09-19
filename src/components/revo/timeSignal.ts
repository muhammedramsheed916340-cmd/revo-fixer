/**
 * TIME-BASED WHEEL RESULT ANALYSIS — EXPERIMENTAL SIGNAL LAYER (ADDITIVE)
 * ======================================================================
 *
 * NEW FILE. Nothing existing is modified, replaced, or simplified. The
 * production scorer keeps running exactly as before; this module is an
 * additional, independently-measured signal that is OFF by default
 * (see `signalFlags.ts` → TIME_SIGNAL).
 *
 * WHY THIS EXISTS
 * ---------------
 * The wheel may not behave identically at all times. This layer treats
 * "the same wheel at a different time" as a SEPARATE, INDEPENDENT signal and
 * measures it — it never assumes a time effect is real.
 *
 * WHAT IT COMPUTES (all from real settled rounds only)
 * ----------------------------------------------------
 *   1. A timestamped record per settled round:
 *        exact timestamp · date · hour · minute · session/time block ·
 *        outcome · physical wheel data (when a physics dossier exists)
 *   2. Rolling windows: last 10 / 25 / 50 / 100 / 250 / full history
 *   3. Time-of-day windows: same hour · previous hour · last 2h · last 6h ·
 *        last 24h · same-time-of-day historical (±window around the current
 *        minute-of-day on earlier days) · same session-block historical
 *   4. Per window, for ALL 8 outcomes:
 *        observed frequency · theoretical frequency · deviation ·
 *        uncertainty · confidence · sample size · transition behaviour ·
 *        recent momentum · bonus frequency
 *   5. TIME REGIME CHANGE detection — recent distribution vs prior
 *        distribution, with a STRICT evidence gate (sample size + pooled
 *        chi-square homogeneity + persistence across sub-blocks + effect
 *        size). A short sample can NEVER be reported as a regime change.
 *   6. DYNAMIC BASE ESTIMATION:
 *        THEORETICAL BASE + LONG-TERM OBSERVED + RECENT OBSERVED +
 *        TIME-WINDOW OBSERVED + PHYSICAL VIDEO SIGNAL
 *      The theoretical 54-sector base is NEVER permanently modified — it is
 *      a weighted component of a per-prediction estimate, and its weight has
 *      a hard floor that only relaxes when a regime is VALIDATED.
 *
 * HARD RULES ENCODED
 * ------------------
 *   - No future rounds: every round used must satisfy settledAt <= lockTimestamp.
 *   - No post-result information: only `outcome` + timestamps of EARLIER rounds.
 *   - No hardcoded time pattern: no hour/block/outcome relationship is stored;
 *     everything is measured from the data that already exists at lock time.
 *   - No forced bonus: bonus outcomes are ordinary members of the 8; the layer
 *     never injects them.
 *   - Validation gate: `regimeAnalysis.evidenceGate.passed` must be true before
 *     a regime can adjust the base beyond the shrinkage floor, and the ensemble
 *     additionally requires TIME_SIGNAL to be flipped ON (which itself requires
 *     a passed walk-forward validation report — see signalFlags.ts).
 */

import {
  chiSquareGoodnessOfFit,
  chiSquareHomogeneity,
  chiSquareSurvival,
  makeTestResult,
  inconclusiveTest,
  posteriorStdDev,
  round as roundTo,
  safeDiv,
  smoothedRate,
  totalVariationDistance,
  zTwoSidedP,
  type ChiSquareResult,
  type TestResult,
} from "./signalStats";

export const TIME_SIGNAL_VERSION = "time-signal-v1.0";

// ============================================================
// 0. THEORETICAL 54-SECTOR WHEEL BASE (frozen reference)
// ============================================================
// Segment counts of the real Crazy Time wheel. Kept LOCAL and frozen so this
// layer can never mutate the engine's theoretical profile, and so it can be
// unit-tested against `decisionEngine.THEORETICAL` for drift.
export const WHEEL_SEGMENTS_54: Record<string, number> = {
  "1": 21,
  "2": 13,
  "5": 7,
  "10": 4,
  "COIN FLIP": 4,
  "CASH HUNT": 2,
  "PACHINKO": 2,
  "CRAZY TIME": 1,
};
export const WHEEL_TOTAL_SEGMENTS_54 = 54;

export const OUTCOMES_8: string[] = [
  "1",
  "2",
  "5",
  "10",
  "COIN FLIP",
  "PACHINKO",
  "CASH HUNT",
  "CRAZY TIME",
];

export const BONUS_OUTCOMES_8: string[] = ["COIN FLIP", "PACHINKO", "CASH HUNT", "CRAZY TIME"];

/** The long-term 54-sector theoretical profile (never mutated). */
export const THEORETICAL_BASE_54: Record<string, number> = Object.fromEntries(
  OUTCOMES_8.map((o) => [o, WHEEL_SEGMENTS_54[o] / WHEEL_TOTAL_SEGMENTS_54]),
);

export const THEORETICAL_BONUS_RATE_54 = BONUS_OUTCOMES_8.reduce(
  (s, o) => s + THEORETICAL_BASE_54[o],
  0,
);

// ============================================================
// 1. TIMESTAMPED SETTLED-ROUND RECORD
// ============================================================

export type SessionBlock =
  | "NIGHT"          // 00:00–05:59
  | "MORNING"        // 06:00–11:59
  | "AFTERNOON"      // 12:00–17:59
  | "EVENING";       // 18:00–23:59

export interface PhysicsSummary {
  direction: 1 | -1 | 0;
  directionConfidence: number;
  velocityAtLock: number;
  peakVelocity: number;
  deceleration: number;
  currentAngle: number;
  predictedStopAngle: number | null;
  predictedSector: number | null;
  predictedOutcome: string | null;
  sectorUncertaintyDeg: number;
  vibrationScore: number;
  trackingConfidence: number;
  motionConfidence: number;
  physicsState: string;
  lockTimestamp: number;
}

/**
 * One REAL settled round with its full time identity. Only real settled
 * rounds may be recorded: `recordTimedRound()` rejects anything without a
 * finite positive settledAt or a recognised outcome (no fake/mock data can
 * enter the time layer).
 */
export interface TimedRound {
  roundId: string;
  spinId: string;
  outcome: string;
  settledAt: number;               // ms epoch — real settlement time
  predictionLockedAt?: number;     // ms epoch — when the Top-4 was frozen
  verified: boolean;               // true = real settled round (never mock)
  dealerId?: string | null;        // set when the dealer layer identified one
  topSlotOutcome?: string | null;  // public game-UI data, when available
  physics?: PhysicsSummary | null; // physical wheel data, when available
  source?: string;                 // provenance tag ("live-api" | "ledger" | ...)
}

export interface TimeContext {
  timestamp: number;
  date: string;                // YYYY-MM-DD
  hour: number;                // 0..23
  minute: number;              // 0..59
  minuteOfDay: number;         // 0..1439
  dayOfWeek: number;           // 0=Sunday
  sessionBlock: SessionBlock;
  utcOffsetMinutes: number;
}

/** Session/time block from the minute of day. Purely a partition of the day —
 *  no block is assumed to favour any outcome anywhere in this codebase. */
export function sessionBlockOf(minuteOfDay: number): SessionBlock {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  if (m < 6 * 60) return "NIGHT";
  if (m < 12 * 60) return "MORNING";
  if (m < 18 * 60) return "AFTERNOON";
  return "EVENING";
}

export function classifyTimeContext(timestamp: number, utcOffsetMinutes = 0): TimeContext {
  const shifted = timestamp + utcOffsetMinutes * 60_000;
  const d = new Date(shifted);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const minuteOfDay = hour * 60 + minute;
  return {
    timestamp,
    date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    hour,
    minute,
    minuteOfDay,
    dayOfWeek: d.getUTCDay(),
    sessionBlock: sessionBlockOf(minuteOfDay),
    utcOffsetMinutes,
  };
}

/** Build a valid TimedRound (throws on non-real data — protects every caller). */
export function toTimedRound(input: {
  roundId?: string;
  spinId?: string;
  outcome: string;
  settledAt: number;
  predictionLockedAt?: number;
  dealerId?: string | null;
  physics?: PhysicsSummary | null;
  topSlotOutcome?: string | null;
  source?: string;
}): TimedRound {
  if (!Number.isFinite(input.settledAt) || input.settledAt <= 0) {
    throw new Error("toTimedRound: settledAt must be a real positive epoch timestamp (no fake data).");
  }
  if (!OUTCOMES_8.includes(input.outcome)) {
    throw new Error(`toTimedRound: unknown outcome "${input.outcome}" (must be one of the 8 real wheel outcomes).`);
  }
  if (input.predictionLockedAt !== undefined && input.predictionLockedAt > input.settledAt) {
    throw new Error("toTimedRound: predictionLockedAt must be <= settledAt (leakage guard).");
  }
  return {
    roundId: input.roundId ?? `r-${input.settledAt}-${input.outcome}`,
    spinId: input.spinId ?? `spin-${input.settledAt}`,
    outcome: input.outcome,
    settledAt: input.settledAt,
    predictionLockedAt: input.predictionLockedAt,
    verified: true,
    dealerId: input.dealerId ?? null,
    physics: input.physics ?? null,
    topSlotOutcome: input.topSlotOutcome ?? null,
    source: input.source ?? "live-api",
  };
}

/** Chronological sort + hard de-duplication (by spinId/roundId, then by
 *  (settledAt, outcome) signature). Duplicated rounds must never double-count
 *  in a time window. */
export function normalizeRounds(rounds: TimedRound[]): TimedRound[] {
  const seen = new Set<string>();
  const out: TimedRound[] = [];
  for (const r of [...rounds].sort((a, b) => a.settledAt - b.settledAt)) {
    const key = r.spinId && r.spinId.length > 0 ? `s:${r.spinId}` : `t:${r.settledAt}:${r.outcome}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function duplicateAudit(rounds: TimedRound[]): {
  total: number;
  unique: number;
  duplicates: { key: string; count: number; firstSeen: number; lastSeen: number }[];
  passed: boolean;
} {
  const map = new Map<string, { count: number; firstSeen: number; lastSeen: number }>();
  for (const r of rounds) {
    const key = r.spinId && r.spinId.length > 0 ? `s:${r.spinId}` : `t:${r.settledAt}:${r.outcome}`;
    const prev = map.get(key);
    if (prev) {
      prev.count++;
      prev.firstSeen = Math.min(prev.firstSeen, r.settledAt);
      prev.lastSeen = Math.max(prev.lastSeen, r.settledAt);
    } else {
      map.set(key, { count: 1, firstSeen: r.settledAt, lastSeen: r.settledAt });
    }
  }
  const duplicates = [...map.entries()]
    .filter(([, v]) => v.count > 1)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.count - a.count);
  return { total: rounds.length, unique: map.size, duplicates, passed: duplicates.length === 0 };
}

// ============================================================
// 2. WINDOW DEFINITIONS
// ============================================================

export const ROLLING_WINDOW_SIZES: number[] = [10, 25, 50, 100, 250, 0]; // 0 = full available history
export const CLOCK_WINDOW_KEYS = [
  "same_hour",
  "previous_hour",
  "last_2h",
  "last_6h",
  "last_24h",
  "same_time_of_day_historical",
  "same_session_block_historical",
] as const;
export type ClockWindowKey = (typeof CLOCK_WINDOW_KEYS)[number];

export const CLOCK_WINDOW_LABELS: Record<ClockWindowKey, string> = {
  same_hour: "Same clock hour (current)",
  previous_hour: "Previous clock hour",
  last_2h: "Recent 2-hour window",
  last_6h: "Recent 6-hour window",
  last_24h: "Recent 24-hour window",
  same_time_of_day_historical: "Same time-of-day (historical, ±30 min)",
  same_session_block_historical: "Same session block (historical days)",
};

export const SAME_TIME_OF_DAY_HALF_WIDTH_MIN = 30; // ±30 minutes around the current minute-of-day

export interface OutcomeWindowStat {
  outcome: string;
  count: number;
  observed: number;
  theoretical: number;
  deviation: number;
  relativeDeviation: number;
  uncertainty: number;        // half-width of the 95% posterior interval on the observed rate
  confidence: number;         // 0..1 — sample-aware trust in this window's rate
  sampleSize: number;
  momentum: number;           // rate in the newer half minus the older half of the window
  zScore: number;
  pValue: number;             // uncorrected diagnostic p-value (never used alone)
}

export interface TransitionStats {
  matrix: Record<string, Record<string, number>>;  // prev → next counts inside the window
  pairCount: number;
  observedFollowHitRate: number;   // hit-rate of a naive "most frequent follower" rule
  independenceTest: TestResult;    // is (prev,next) association real? (usually NOT)
  strongestPair: { from: string; to: string; count: number; expected: number; lift: number } | null;
  note: string;
}

export interface BonusFrequencyStat {
  bonusCount: number;
  bonusRate: number;
  theoretical: number;
  deviation: number;
  confidence: number;
  sampleSize: number;
  byOutcome: Record<string, number>;
}

export interface WindowStats {
  key: string;
  label: string;
  kind: "rolling" | "clock";
  sampleSize: number;
  fromTimestamp: number | null;
  toTimestamp: number | null;
  counts: Record<string, number>;
  outcomes: OutcomeWindowStat[];
  bonus: BonusFrequencyStat;
  chiSquare: ChiSquareResult;      // window distribution vs the 54-sector theoretical base
  transition: TransitionStats;
  momentum: Record<string, number>; // outcome → current-window recent-half momentum
}

// ============================================================
// 3. WINDOW COMPUTATION
// ============================================================

function emptyCounts(): Record<string, number> {
  return Object.fromEntries(OUTCOMES_8.map((o) => [o, 0]));
}

function countsOf(rounds: TimedRound[]): Record<string, number> {
  const c = emptyCounts();
  for (const r of rounds) if (c[r.outcome] !== undefined) c[r.outcome]++;
  return c;
}

function momentumOf(rounds: TimedRound[]): Record<string, number> {
  const out = emptyCounts();
  if (rounds.length < 4) return out;
  const mid = Math.floor(rounds.length / 2);
  const older = rounds.slice(0, mid);
  const newer = rounds.slice(mid);
  const co = countsOf(older);
  const cn = countsOf(newer);
  for (const o of OUTCOMES_8) {
    const ro = older.length > 0 ? co[o] / older.length : 0;
    const rn = newer.length > 0 ? cn[o] / newer.length : 0;
    out[o] = rn - ro;
  }
  return out;
}

function transitionStatsOf(rounds: TimedRound[]): TransitionStats {
  const matrix: Record<string, Record<string, number>> = {};
  for (const a of OUTCOMES_8) {
    matrix[a] = {};
    for (const b of OUTCOMES_8) matrix[a][b] = 0;
  }
  const pairCount = Math.max(0, rounds.length - 1);
  for (let i = 1; i < rounds.length; i++) {
    const prev = rounds[i - 1].outcome;
    const next = rounds[i].outcome;
    if (matrix[prev] && matrix[prev][next] !== undefined) matrix[prev][next]++;
  }

  // Naive "most frequent follower" rule, measured out-of-sample inside the
  // window itself is impossible (it would be hindsight) — so we measure the
  // DESCRIPTIVE stability of the dominant follower instead, and label it as
  // descriptive. Any actual prediction use must go through the walk-forward
  // validation harness.
  let strongestPair: TransitionStats["strongestPair"] = null;
  for (const a of OUTCOMES_8) {
    const rowTotal = OUTCOMES_8.reduce((s, b) => s + matrix[a][b], 0);
    if (rowTotal === 0) continue;
    for (const b of OUTCOMES_8) {
      const expected = (rowTotal * totalCountOfColumn(matrix, b)) / Math.max(1, pairCount);
      const count = matrix[a][b];
      const lift = expected > 0 ? count / expected : 0;
      if (
        !strongestPair ||
        count > strongestPair.count ||
        (count === strongestPair.count && lift > strongestPair.lift)
      ) {
        strongestPair = { from: a, to: b, count, expected, lift };
      }
    }
  }

  // Independence test (prev vs next) — normally NOT significant, which is the
  // correct, honest result for a fair wheel.
  const observed: number[] = [];
  const expected: number[] = [];
  let chi = 0;
  for (const a of OUTCOMES_8) {
    for (const b of OUTCOMES_8) {
      const o = matrix[a][b];
      const rowTotal = OUTCOMES_8.reduce((s, x) => s + matrix[a][x], 0);
      const colTotal = totalCountOfColumn(matrix, b);
      const e = pairCount > 0 ? (rowTotal * colTotal) / pairCount : 0;
      observed.push(o);
      expected.push(e);
      if (e >= 5) chi += ((o - e) ** 2) / e;
    }
  }
  const df = 49; // 8x8 table → (8-1)*(8-1)
  const conclusive = pairCount >= 200; // 64 cells need a large sample to be meaningful
  const independenceTest = conclusive
    ? makeTestResult({
        name: "transition independence (8×8)",
        statistic: chi,
        df,
        pValue: chiSquareSurvival(chi, df),
        alpha: 0.01,
        conclusive,
        sampleSize: pairCount,
        effectSize: 0,
        note: "Descriptive only — a significant result here is reported, but it is NOT used to predict unless walk-forward validation proves it out of sample.",
      })
    : inconclusiveTest("transition independence (8×8)", pairCount, `INCONCLUSIVE — only ${pairCount} transitions (need ≥200 for a 64-cell table).`);

  // Descriptive hit-rate of "always predict the dominant overall follower":
  const globalCounts = countsOf(rounds);
  let dominant = OUTCOMES_8[0];
  for (const o of OUTCOMES_8) if (globalCounts[o] > globalCounts[dominant]) dominant = o;
  const hits = rounds.filter((r) => r.outcome === dominant).length;
  const observedFollowHitRate = rounds.length > 0 ? hits / rounds.length : 0;

  return {
    matrix,
    pairCount,
    observedFollowHitRate,
    independenceTest,
    strongestPair,
    note:
      "Transition statistics are DESCRIPTIVE unless the walk-forward harness shows they beat the base rate. No transition rule influences a prediction before that.",
  };
}

function totalCountOfColumn(matrix: Record<string, Record<string, number>>, col: string): number {
  let s = 0;
  for (const a of OUTCOMES_8) s += matrix[a]?.[col] ?? 0;
  return s;
}

export function computeWindowStats(
  key: string,
  label: string,
  kind: "rolling" | "clock",
  rounds: TimedRound[],
  theoretical: Record<string, number> = THEORETICAL_BASE_54,
  opts: { confidenceK?: number; minSampleForEffect?: number } = {},
): WindowStats {
  const k = opts.confidenceK ?? 30; // shrinkage constant (matches the engine's k=30 convention)
  const n = rounds.length;
  const counts = countsOf(rounds);
  const momentum = momentumOf(rounds);

  const outcomes: OutcomeWindowStat[] = OUTCOMES_8.map((o) => {
    const count = counts[o];
    const observed = n > 0 ? count / n : theoretical[o];
    const theo = theoretical[o] ?? 0;
    const uncertainty = posteriorStdDev(count, n) * 1.96;
    const confidence = safeDiv(n, n + k * (1 / Math.max(0.02, theo * 8))); // rarer outcomes need more data
    const se = Math.sqrt(Math.max(1e-12, (theo * (1 - theo)) / Math.max(1, n)));
    const zScore = se > 0 ? (observed - theo) / se : 0;
    return {
      outcome: o,
      count,
      observed: roundTo(observed, 6),
      theoretical: theo,
      deviation: roundTo(observed - theo, 6),
      relativeDeviation: roundTo(theo > 0 ? (observed - theo) / theo : 0, 6),
      uncertainty: roundTo(uncertainty, 6),
      confidence: roundTo(Math.min(1, Math.max(0, confidence)), 4),
      sampleSize: n,
      momentum: roundTo(momentum[o], 6),
      zScore: roundTo(zScore, 4),
      pValue: roundTo(zTwoSidedLocal(zScore), 4),
    };
  });

  const bonusCount = BONUS_OUTCOMES_8.reduce((s, o) => s + counts[o], 0);
  const bonusByOutcome: Record<string, number> = {};
  for (const o of BONUS_OUTCOMES_8) bonusByOutcome[o] = counts[o];
  const bonusRate = n > 0 ? bonusCount / n : THEORETICAL_BONUS_RATE_54;
  const bonus: BonusFrequencyStat = {
    bonusCount,
    bonusRate: roundTo(bonusRate, 6),
    theoretical: THEORETICAL_BONUS_RATE_54,
    deviation: roundTo(bonusRate - THEORETICAL_BONUS_RATE_54, 6),
    confidence: roundTo(Math.min(1, safeDiv(n, n + 25)), 4),
    sampleSize: n,
    byOutcome: bonusByOutcome,
  };

  const chiSquare = chiSquareGoodnessOfFit(
    OUTCOMES_8.map((o) => counts[o]),
    OUTCOMES_8.map((o) => theoretical[o] ?? 0),
    { minExpected: 5, minSample: opts.minSampleForEffect ?? 30, name: `${label}: distribution vs 54-sector theoretical` },
  );

  return {
    key,
    label,
    kind,
    sampleSize: n,
    fromTimestamp: n > 0 ? rounds[0].settledAt : null,
    toTimestamp: n > 0 ? rounds[n - 1].settledAt : null,
    counts,
    outcomes,
    bonus,
    chiSquare,
    transition: transitionStatsOf(rounds),
    momentum,
  };
}

function zTwoSidedLocal(z: number): number {
  // 2*(1-Φ(|z|)) using the erf approximation already imported via signalStats
  return zTwoSidedP(z);
}

// ============================================================
// 4. WINDOW SELECTION (rolling + time-of-day)
// ============================================================

export interface WindowSelectionOptions {
  utcOffsetMinutes?: number;
  confidenceK?: number;
  sameTimeOfDayHalfWidthMinutes?: number;
}

/** Rounds strictly available at `lockTimestamp` (no future rounds, no leakage). */
export function roundsAvailableAt(rounds: TimedRound[], lockTimestamp: number): TimedRound[] {
  return rounds.filter((r) => r.settledAt <= lockTimestamp);
}

export function buildWindowSets(
  available: TimedRound[],
  lockTimestamp: number,
  opts: WindowSelectionOptions = {},
): { key: string; label: string; kind: "rolling" | "clock"; rounds: TimedRound[] }[] {
  const offset = opts.utcOffsetMinutes ?? 0;
  const halfWidth = opts.sameTimeOfDayHalfWidthMinutes ?? SAME_TIME_OF_DAY_HALF_WIDTH_MIN;
  const now = classifyTimeContext(lockTimestamp, offset);
  const sets: { key: string; label: string; kind: "rolling" | "clock"; rounds: TimedRound[] }[] = [];

  // --- rolling windows ---
  for (const size of ROLLING_WINDOW_SIZES) {
    const label = size === 0 ? "Full available history" : `Last ${size} rounds`;
    const slice = size === 0 ? available : available.slice(-size);
    sets.push({ key: `rolling_${size === 0 ? "all" : size}`, label, kind: "rolling", rounds: slice });
  }

  // --- time-of-day windows ---
  const hourStart = lockTimestamp - (now.minute * 60_000 + (lockTimestamp % 60_000));
  const currentHour = available.filter((r) => r.settledAt >= hourStart && r.settledAt <= lockTimestamp);
  const previousHour = available.filter(
    (r) => r.settledAt >= hourStart - 3_600_000 && r.settledAt < hourStart,
  );
  const last2h = available.filter((r) => r.settledAt >= lockTimestamp - 2 * 3_600_000);
  const last6h = available.filter((r) => r.settledAt >= lockTimestamp - 6 * 3_600_000);
  const last24h = available.filter((r) => r.settledAt >= lockTimestamp - 24 * 3_600_000);
  const sameTimeOfDay = available.filter((r) => {
    if (r.settledAt > lockTimestamp - 24 * 3_600_000) return false; // exclude the recent day (that's the 24h window)
    const ctx = classifyTimeContext(r.settledAt, offset);
    let delta = Math.abs(ctx.minuteOfDay - now.minuteOfDay);
    if (delta > 720) delta = 1440 - delta;
    return delta <= halfWidth;
  });
  const sameSessionBlock = available.filter((r) => {
    if (r.settledAt > lockTimestamp - 24 * 3_600_000) return false;
    return classifyTimeContext(r.settledAt, offset).sessionBlock === now.sessionBlock;
  });

  return [
    ...sets,
    { key: "same_hour", label: CLOCK_WINDOW_LABELS.same_hour, kind: "clock", rounds: currentHour },
    { key: "previous_hour", label: CLOCK_WINDOW_LABELS.previous_hour, kind: "clock", rounds: previousHour },
    { key: "last_2h", label: CLOCK_WINDOW_LABELS.last_2h, kind: "clock", rounds: last2h },
    { key: "last_6h", label: CLOCK_WINDOW_LABELS.last_6h, kind: "clock", rounds: last6h },
    { key: "last_24h", label: CLOCK_WINDOW_LABELS.last_24h, kind: "clock", rounds: last24h },
    { key: "same_time_of_day_historical", label: CLOCK_WINDOW_LABELS.same_time_of_day_historical, kind: "clock", rounds: sameTimeOfDay },
    { key: "same_session_block_historical", label: CLOCK_WINDOW_LABELS.same_session_block_historical, kind: "clock", rounds: sameSessionBlock },
  ];
}

// ============================================================
// 5. TIME REGIME CHANGE DETECTION
// ============================================================

export interface RegimeEvidenceGate {
  passed: boolean;
  reasons: string[];
  checks: { name: string; passed: boolean; detail: string }[];
}

export interface RegimeDetection {
  status: "INSUFFICIENT_DATA" | "NO_REGIME" | "CANDIDATE_REGIME" | "CONFIRMED_REGIME";
  recentWindow: { label: string; sampleSize: number; fromTimestamp: number | null; toTimestamp: number | null };
  priorWindow: { label: string; sampleSize: number; fromTimestamp: number | null; toTimestamp: number | null };
  homogeneity: TestResult;
  persistence: { subBlocks: number; agreeingBlocks: number; consistent: boolean; note: string };
  perOutcomeShift: {
    outcome: string;
    recentRate: number;
    priorRate: number;
    delta: number;
    zScore: number;
    pValue: number;
    significantAfterCorrection: boolean;
  }[];
  shiftMagnitude: number;                // TVD between recent and prior distributions
  evidenceGate: RegimeEvidenceGate;
  notes: string[];
  testedAt: number;
}

export interface RegimeOptions {
  utcOffsetMinutes?: number;
  recentSize?: number;                 // default 50
  priorSize?: number;                  // default 100 (the stretch before the recent window)
  minWindowSample?: number;            // default 40 (hard floor — smaller windows cannot trigger)
  alpha?: number;                      // default 0.01 (multiple windows tested → stricter)
  minEffectSize?: number;              // default 0.08 TVD
  persistenceBlocks?: number;          // default 3
  minAgreeingBlocks?: number;          // default 2
}

export const DEFAULT_REGIME_OPTIONS: Required<Omit<RegimeOptions, "utcOffsetMinutes">> & { utcOffsetMinutes: number } = {
  utcOffsetMinutes: 0,
  recentSize: 50,
  priorSize: 100,
  minWindowSample: 40,
  alpha: 0.01,
  minEffectSize: 0.08,
  persistenceBlocks: 3,
  minAgreeingBlocks: 2,
};

/**
 * Detect whether the wheel's observed distribution CHANGED between the recent
 * window and the prior window.
 *
 * A regime is only CONFIRMED when ALL of these hold:
 *   1. both windows meet the minimum sample floor,
 *   2. a pooled chi-square homogeneity test is significant at the stricter
 *      alpha (multiple windows are examined),
 *   3. the effect size (TVD) clears the minimum bar,
 *   4. the shift PERSISTS across sub-blocks (≥2 of 3 consecutive sub-blocks
 *      shift the same way for the dominant shifting outcome).
 *
 * Otherwise the result is NO_REGIME or CANDIDATE_REGIME — and neither is
 * allowed to change a prediction beyond the shrinkage floor.
 */
export function detectTimeRegime(
  available: TimedRound[],
  lockTimestamp: number,
  opts: RegimeOptions = {},
): RegimeDetection {
  const cfg = { ...DEFAULT_REGIME_OPTIONS, ...opts };
  const recent = available.slice(-cfg.recentSize);
  const prior = available.slice(Math.max(0, available.length - cfg.recentSize - cfg.priorSize), Math.max(0, available.length - cfg.recentSize));

  const recentCounts = OUTCOMES_8.map((o) => recent.filter((r) => r.outcome === o).length);
  const priorCounts = OUTCOMES_8.map((o) => prior.filter((r) => r.outcome === o).length);

  const homogeneity = chiSquareHomogeneity(recentCounts, priorCounts, {
    alpha: cfg.alpha,
    minSample: cfg.minWindowSample,
    name: "regime homogeneity (recent vs prior)",
  });

  const tvd = totalVariationDistance(
    recentCounts.map((c) => safeDiv(c, recent.length)),
    priorCounts.map((c) => safeDiv(c, prior.length)),
  );

  // Persistence: split the recent window into k blocks, measure each block's
  // shift for the dominant shifting outcome, require agreement.
  const dominant = OUTCOMES_8.map((o, i) => ({ o, i, delta: safeDiv(recentCounts[i], recent.length) - safeDiv(priorCounts[i], prior.length) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const blocks = cfg.persistenceBlocks;
  const blockSize = Math.max(1, Math.floor(recent.length / blocks));
  let agreeing = 0;
  for (let b = 0; b < blocks; b++) {
    const slice = recent.slice(b * blockSize, b === blocks - 1 ? recent.length : (b + 1) * blockSize);
    if (slice.length === 0) continue;
    const rate = slice.filter((r) => r.outcome === dominant.o).length / slice.length;
    const priorRate = safeDiv(priorCounts[dominant.i], prior.length);
    if (Math.sign(rate - priorRate) === Math.sign(dominant.delta) && Math.abs(rate - priorRate) > 0) agreeing++;
  }
  const consistent = agreeing >= cfg.minAgreeingBlocks;

  const checks: RegimeEvidenceGate["checks"] = [
    { name: "recent window sample", passed: recent.length >= cfg.minWindowSample, detail: `n=${recent.length} (need ≥${cfg.minWindowSample})` },
    { name: "prior window sample", passed: prior.length >= cfg.minWindowSample, detail: `n=${prior.length} (need ≥${cfg.minWindowSample})` },
    { name: "homogeneity test conclusive", passed: homogeneity.test.conclusive, detail: homogeneity.test.note },
    { name: "p < alpha (stricter)", passed: homogeneity.test.conclusive && homogeneity.test.pValue < cfg.alpha, detail: `p=${homogeneity.test.pValue.toFixed(4)} vs α=${cfg.alpha}` },
    { name: "effect size clears bar", passed: tvd >= cfg.minEffectSize, detail: `TVD=${tvd.toFixed(3)} (need ≥${cfg.minEffectSize})` },
    { name: "shift persists across sub-blocks", passed: consistent, detail: `${agreeing}/${blocks} sub-blocks shift the same way (need ≥${cfg.minAgreeingBlocks})` },
  ];
  const gate: RegimeEvidenceGate = {
    passed: checks.every((c) => c.passed),
    reasons: checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`),
    checks,
  };

  const perOutcomeShift = OUTCOMES_8.map((o, i) => {
    const recentRate = safeDiv(recentCounts[i], recent.length);
    const priorRate = safeDiv(priorCounts[i], prior.length);
    const se = Math.sqrt(
      Math.max(1e-12, (recentRate * (1 - recentRate)) / Math.max(1, recent.length) + (priorRate * (1 - priorRate)) / Math.max(1, prior.length)),
    );
    const z = se > 0 ? (recentRate - priorRate) / se : 0;
    return {
      outcome: o,
      recentRate: roundTo(recentRate, 6),
      priorRate: roundTo(priorRate, 6),
      delta: roundTo(recentRate - priorRate, 6),
      zScore: roundTo(z, 4),
      pValue: roundTo(zTwoSidedP(z), 4),
      significantAfterCorrection: false, // filled below
    };
  });
  // Bonferroni over the 8 outcomes (family-wise control).
  const alphaOutcome = 0.05 / OUTCOMES_8.length;
  for (const s of perOutcomeShift) s.significantAfterCorrection = gate.passed && s.pValue < alphaOutcome;

  let status: RegimeDetection["status"];
  if (recent.length < cfg.minWindowSample || prior.length < cfg.minWindowSample) status = "INSUFFICIENT_DATA";
  else if (gate.passed) status = "CONFIRMED_REGIME";
  else if (homogeneity.test.conclusive && homogeneity.test.pValue < cfg.alpha) status = "CANDIDATE_REGIME";
  else status = "NO_REGIME";

  const notes: string[] = [];
  notes.push(
    status === "CONFIRMED_REGIME"
      ? `CONFIRMED time regime: the ${cfg.recentSize}-round window differs from the previous ${cfg.priorSize} rounds (χ²=${homogeneity.test.statistic.toFixed(2)}, p=${homogeneity.test.pValue.toFixed(4)}, TVD=${tvd.toFixed(3)}), and the shift persists (${agreeing}/${blocks} sub-blocks).`
      : status === "CANDIDATE_REGIME"
        ? `CANDIDATE regime (NOT confirmed): homogeneity is significant (p=${homogeneity.test.pValue.toFixed(4)}) but the evidence gate failed — ${gate.reasons.join("; ")}.`
        : status === "INSUFFICIENT_DATA"
          ? `INSUFFICIENT DATA: recent n=${recent.length}, prior n=${prior.length} (need ≥${cfg.minWindowSample} each). No regime can be claimed.`
          : `NO regime detected: recent and prior distributions are statistically indistinguishable (p=${homogeneity.test.pValue.toFixed(4)}, TVD=${tvd.toFixed(3)}).`,
  );
  notes.push("A detected change is NOT assumed real: it must clear the evidence gate before it can influence the prediction beyond the shrinkage floor.");

  return {
    status,
    recentWindow: {
      label: `last ${cfg.recentSize} rounds`,
      sampleSize: recent.length,
      fromTimestamp: recent.length > 0 ? recent[0].settledAt : null,
      toTimestamp: recent.length > 0 ? recent[recent.length - 1].settledAt : null,
    },
    priorWindow: {
      label: `previous ${cfg.priorSize} rounds`,
      sampleSize: prior.length,
      fromTimestamp: prior.length > 0 ? prior[0].settledAt : null,
      toTimestamp: prior.length > 0 ? prior[prior.length - 1].settledAt : null,
    },
    homogeneity: homogeneity.test,
    persistence: {
      subBlocks: blocks,
      agreeingBlocks: agreeing,
      consistent,
      note: `Dominant shifting outcome: ${dominant.o} (Δ=${dominant.delta >= 0 ? "+" : ""}${(dominant.delta * 100).toFixed(2)} pp).`,
    },
    perOutcomeShift,
    shiftMagnitude: roundTo(tvd, 6),
    evidenceGate: gate,
    notes,
    testedAt: lockTimestamp,
  };
}

// ============================================================
// 6. DYNAMIC BASE ESTIMATION
// ============================================================
//
//   THEORETICAL BASE
//   + LONG-TERM OBSERVED BASE
//   + RECENT OBSERVED BASE
//   + TIME-WINDOW BASE
//   + PHYSICAL VIDEO SIGNAL
//
// The theoretical component NEVER loses more than `1 - theoryFloor` weight,
// and the floor only drops when a regime is CONFIRMED by the evidence gate.

export interface DynamicBaseWeightPolicy {
  defaultWeights: { theoretical: number; longTerm: number; recent: number; timeWindow: number; physics: number };
  regimeWeights: { theoretical: number; longTerm: number; recent: number; timeWindow: number; physics: number };
  theoryFloor: number;            // minimum theoretical weight without a confirmed regime
  theoryFloorWithRegime: number;  // minimum theoretical weight with a confirmed regime
  shrinkageK: number;             // Laplace/shrinkage constant for observed rates
  maxMultiplier: number;          // cap on base/theoretical ratio fed to the ensemble
}

export const DEFAULT_BASE_WEIGHT_POLICY: DynamicBaseWeightPolicy = {
  defaultWeights: { theoretical: 0.70, longTerm: 0.20, recent: 0.06, timeWindow: 0.04, physics: 0 },
  regimeWeights: { theoretical: 0.35, longTerm: 0.15, recent: 0.25, timeWindow: 0.25, physics: 0 },
  theoryFloor: 0.60,
  theoryFloorWithRegime: 0.30,
  shrinkageK: 30,
  maxMultiplier: 1.6,
};

export interface DynamicBaseRow {
  outcome: string;
  theoretical: number;
  longTermObserved: number;
  recentObserved: number;
  timeWindowObserved: number;
  physicsPrior: number | null;
  base: number;
  multiplier: number;              // base / theoretical (capped)
  componentWeights: Record<string, number>;
}

export interface DynamicBaseEstimate {
  rows: DynamicBaseRow[];
  weights: Record<string, number>;
  regimeAdjusted: boolean;
  theoryFloorApplied: boolean;
  sampleSizes: { longTerm: number; recent: number; timeWindow: number; physicsRounds: number };
  notes: string[];
}

export function estimateDynamicBase(input: {
  theoretical?: Record<string, number>;
  longTermWindow: WindowStats;
  recentWindow: WindowStats;
  timeWindow: WindowStats | null;
  regime: RegimeDetection;
  physicsPrior?: Record<string, number> | null;
  physicsConfidence?: number;
  policy?: Partial<DynamicBaseWeightPolicy>;
}): DynamicBaseEstimate {
  const policy: DynamicBaseWeightPolicy = {
    ...DEFAULT_BASE_WEIGHT_POLICY,
    ...input.policy,
    defaultWeights: { ...DEFAULT_BASE_WEIGHT_POLICY.defaultWeights, ...(input.policy?.defaultWeights ?? {}) },
    regimeWeights: { ...DEFAULT_BASE_WEIGHT_POLICY.regimeWeights, ...(input.policy?.regimeWeights ?? {}) },
  };
  const theoretical = input.theoretical ?? THEORETICAL_BASE_54;
  const regimeConfirmed = input.regime.status === "CONFIRMED_REGIME";
  const baseWeights = regimeConfirmed ? { ...policy.regimeWeights } : { ...policy.defaultWeights };

  // Physics participates only when it exists AND carries confidence.
  const physicsAvailable = !!input.physicsPrior && (input.physicsConfidence ?? 0) > 0.05;
  if (!physicsAvailable) baseWeights.physics = 0;

  // Normalize after removing unavailable components.
  const sum = Object.values(baseWeights).reduce((s, v) => s + v, 0);
  const weights = Object.fromEntries(Object.entries(baseWeights).map(([k, v]) => [k, safeDiv(v, sum)])) as Record<string, number>;

  // Theoretical floor — a hard guarantee that a short sample can never
  // permanently rewrite the 54-sector base.
  const floor = regimeConfirmed ? policy.theoryFloorWithRegime : policy.theoryFloor;
  let theoryWeightApplied = weights.theoretical;
  let theoryFloorApplied = false;
  if (theoryWeightApplied < floor) {
    theoryFloorApplied = true;
    const deficit = floor - theoryWeightApplied;
    theoryWeightApplied = floor;
    // take the deficit proportionally from the observed components
    const observedKeys = ["longTerm", "recent", "timeWindow", "physics"] as const;
    const observedSum = observedKeys.reduce((s, k) => s + (weights[k] ?? 0), 0);
    for (const k of observedKeys) {
      if (observedSum > 0) weights[k] = Math.max(0, (weights[k] ?? 0) - deficit * ((weights[k] ?? 0) / observedSum));
    }
    weights.theoretical = theoryWeightApplied;
    const renorm = Object.values(weights).reduce((s, v) => s + v, 0);
    for (const k of Object.keys(weights)) weights[k] = safeDiv(weights[k], renorm);
  }

  const k = policy.shrinkageK;
  const rows: DynamicBaseRow[] = OUTCOMES_8.map((o) => {
    const theo = theoretical[o] ?? 0;
    const longTerm = smoothedRate(input.longTermWindow.counts[o] ?? 0, input.longTermWindow.sampleSize, theo, k);
    const recent = smoothedRate(input.recentWindow.counts[o] ?? 0, input.recentWindow.sampleSize, theo, k);
    const timeWindow = input.timeWindow
      ? smoothedRate(input.timeWindow.counts[o] ?? 0, input.timeWindow.sampleSize, theo, k)
      : theo;
    const physicsPrior = physicsAvailable ? clamp(input.physicsPrior![o] ?? 0, 0, 1) : null;

    const base =
      theo * weights.theoretical +
      longTerm * weights.longTerm +
      recent * weights.recent +
      timeWindow * weights.timeWindow +
      (physicsPrior ?? 0) * weights.physics;

    const multiplier = theo > 0 ? clamp(base / theo, 1 / policy.maxMultiplier, policy.maxMultiplier) : 1;
    return {
      outcome: o,
      theoretical: roundTo(theo, 6),
      longTermObserved: roundTo(longTerm, 6),
      recentObserved: roundTo(recent, 6),
      timeWindowObserved: roundTo(timeWindow, 6),
      physicsPrior: physicsPrior === null ? null : roundTo(physicsPrior, 6),
      base: roundTo(base, 6),
      multiplier: roundTo(multiplier, 6),
      componentWeights: { ...weights },
    };
  });

  const notes: string[] = [
    regimeConfirmed
      ? "Weights: regime policy (theoretical 0.35 base weight) — a CONFIRMED regime was required to relax the theoretical floor."
      : "Weights: default policy (theoretical ≥0.60 of the base) — no confirmed regime, so the 54-sector theoretical profile dominates and short samples cannot rewrite it.",
    `Shrinkage k=${k}: every observed component is smoothed toward the 54-sector theoretical before weighting.`,
    physicsAvailable
      ? "Physical video signal included as its own component (weight taken from the available components)."
      : "Physical video signal NOT available for this lock (no physics evidence → weight 0, never faked).",
  ];
  if (theoryFloorApplied) notes.push("Theoretical floor was enforced (observed components had to give up weight).");

  return {
    rows,
    weights,
    regimeAdjusted: regimeConfirmed,
    theoryFloorApplied,
    sampleSizes: {
      longTerm: input.longTermWindow.sampleSize,
      recent: input.recentWindow.sampleSize,
      timeWindow: input.timeWindow?.sampleSize ?? 0,
      physicsRounds: physicsAvailable ? 1 : 0,
    },
    notes,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

// ============================================================
// 7. THE TIME SIGNAL (per-lock output consumed by the ensemble)
// ============================================================

export interface TimeSignalDiagnostics {
  currentTimeWindow: {
    key: string;
    label: string;
    hour: number;
    minute: number;
    sessionBlock: SessionBlock;
    date: string;
  };
  sampleSize: number;
  observedBase: Record<string, number>;
  theoreticalBase: Record<string, number>;
  baseRateShift: Record<string, number>;      // observed − theoretical (pp)
  baseRateShiftMagnitude: number;             // TVD(observed, theoretical)
  regimeStatus: RegimeDetection["status"];
  timeSignalConfidence: number;
  windows: { key: string; label: string; kind: "rolling" | "clock"; sampleSize: number; shiftMagnitude: number }[];
  explanation: string[];
}

export interface TimeSignalResult {
  version: string;
  lockTimestamp: number;
  latestUsedTimestamp: number | null;
  leakageSafe: boolean;
  active: boolean;                       // false → must NOT influence the prediction
  activeReason: string;
  confidence: number;                    // 0..1
  scores: Record<string, number>;        // 8 outcomes, sums to 1
  multipliers: Record<string, number>;   // capped base/theoretical ratios (ensemble input)
  dynamicBase: DynamicBaseEstimate;
  regime: RegimeDetection;
  windows: WindowStats[];
  primaryWindow: WindowStats;
  diagnostics: TimeSignalDiagnostics;
  why: string[];
}

export interface ComputeTimeSignalInput {
  rounds: TimedRound[];
  lockTimestamp: number;
  physicsPrior?: Record<string, number> | null;
  physicsConfidence?: number;
  options?: {
    utcOffsetMinutes?: number;
    primaryWindowKey?: string;            // default "last_50" (falls back to the largest non-empty rolling window)
    regime?: RegimeOptions;
    basePolicy?: Partial<DynamicBaseWeightPolicy>;
    minSampleForActivation?: number;      // default 30
    confidenceFloorForActivation?: number;// default 0.35
  };
}

/** Pick the primary time window: caller-specified key, else the largest rolling
 *  window with enough sample, else "rolling_all". */
function pickPrimary(windows: WindowStats[], preferredKey: string | undefined, minSample: number): WindowStats {
  if (preferredKey) {
    const exact = windows.find((w) => w.key === preferredKey);
    if (exact) return exact;
  }
  const candidates = ["rolling_50", "rolling_100", "rolling_25", "rolling_10", "rolling_all"];
  for (const key of candidates) {
    const w = windows.find((x) => x.key === key);
    if (w && w.sampleSize >= minSample) return w;
  }
  const largest = [...windows].sort((a, b) => b.sampleSize - a.sampleSize)[0];
  return largest;
}

/**
 * Compute the complete time signal for one prediction lock.
 *
 * STRICT: `rounds` may only contain real settled rounds; only those with
 * `settledAt <= lockTimestamp` are used, and `latestUsedTimestamp` is reported
 * so the caller can assert `latestUsedTimestamp <= lockTimestamp`.
 */
export function computeTimeSignal(input: ComputeTimeSignalInput): TimeSignalResult {
  const lockTimestamp = input.lockTimestamp;
  const all = normalizeRounds(input.rounds);
  const available = roundsAvailableAt(all, lockTimestamp);
  const latestUsedTimestamp = available.length > 0 ? available[available.length - 1].settledAt : null;
  const leakageSafe = latestUsedTimestamp === null || latestUsedTimestamp <= lockTimestamp;

  const minSample = input.options?.minSampleForActivation ?? 30;
  const sets = buildWindowSets(available, lockTimestamp, {
    utcOffsetMinutes: input.options?.utcOffsetMinutes,
  });
  // exclude the empty clock windows from the rolling statistics list to avoid
  // reporting a 0-sample "same hour" window as if it were evidence
  const windows = sets
    .filter((s) => s.kind === "rolling" || s.rounds.length > 0)
    .map((s) => computeWindowStats(s.key, s.label, s.kind, s.rounds));

  const primaryWindow = pickPrimary(windows, input.options?.primaryWindowKey, minSample);
  const longTermWindow =
    windows.find((w) => w.key === "rolling_all") ?? primaryWindow;
  const recentWindow =
    windows.find((w) => w.key === "rolling_25") ?? windows.find((w) => w.key === "rolling_50") ?? primaryWindow;
  const timeWindow = windows.find((w) => w.key === "same_time_of_day_historical") ??
    windows.find((w) => w.key === "last_6h") ??
    null;

  const regime = detectTimeRegime(available, lockTimestamp, input.options?.regime ?? {});
  const dynamicBase = estimateDynamicBase({
    longTermWindow,
    recentWindow,
    timeWindow,
    regime,
    physicsPrior: input.physicsPrior ?? null,
    physicsConfidence: input.physicsConfidence,
    policy: input.options?.basePolicy,
  });

  // Raw score = base estimate (already a probability-like vector). Normalize.
  const rawSum = dynamicBase.rows.reduce((s, r) => s + r.base, 0);
  const scores: Record<string, number> = {};
  for (const r of dynamicBase.rows) scores[r.outcome] = roundTo(safeDiv(r.base, rawSum), 8);

  const multipliers: Record<string, number> = {};
  for (const r of dynamicBase.rows) multipliers[r.outcome] = r.multiplier;

  // Confidence: driven by sample size of the primary window, the strength of
  // the (validated) regime evidence, and how much data the time windows hold.
  const primaryN = primaryWindow.sampleSize;
  const sampleConfidence = safeDiv(primaryN, primaryN + 60);
  const regimeBoost = regime.status === "CONFIRMED_REGIME" ? 0.15 : regime.status === "CANDIDATE_REGIME" ? 0.05 : 0;
  const dataBonus = Math.min(0.1, safeDiv(primaryN, 1000) * 0.1);
  const confidence = clamp(sampleConfidence + regimeBoost + dataBonus, 0, 1);

  const confidenceFloor = input.options?.confidenceFloorForActivation ?? 0.35;
  const active = primaryN >= minSample && confidence >= confidenceFloor && leakageSafe;
  const activeReason = !leakageSafe
    ? "BLOCKED — leakage guard failed (a used round settled after the lock timestamp)."
    : primaryN < minSample
      ? `INACTIVE — primary window has n=${primaryN} (need ≥${minSample}).`
      : confidence < confidenceFloor
        ? `INACTIVE — time-signal confidence ${(confidence * 100).toFixed(0)}% below floor ${(confidenceFloor * 100).toFixed(0)}%.`
        : `ACTIVE — n=${primaryN}, confidence ${(confidence * 100).toFixed(0)}%, regime=${regime.status}.`;

  const shiftMagnitude = totalVariationDistance(
    OUTCOMES_8.map((o) => primaryWindow.counts[o] / Math.max(1, primaryN)),
    OUTCOMES_8.map((o) => THEORETICAL_BASE_54[o]),
  );

  const diagnostics: TimeSignalDiagnostics = {
    currentTimeWindow: {
      key: primaryWindow.key,
      label: primaryWindow.label,
      hour: classifyTimeContext(lockTimestamp, input.options?.utcOffsetMinutes ?? 0).hour,
      minute: classifyTimeContext(lockTimestamp, input.options?.utcOffsetMinutes ?? 0).minute,
      sessionBlock: classifyTimeContext(lockTimestamp, input.options?.utcOffsetMinutes ?? 0).sessionBlock,
      date: classifyTimeContext(lockTimestamp, input.options?.utcOffsetMinutes ?? 0).date,
    },
    sampleSize: primaryN,
    observedBase: Object.fromEntries(OUTCOMES_8.map((o) => [o, roundTo(safeDiv(primaryWindow.counts[o], primaryN), 6)])),
    theoreticalBase: { ...THEORETICAL_BASE_54 },
    baseRateShift: Object.fromEntries(OUTCOMES_8.map((o) => [o, roundTo(safeDiv(primaryWindow.counts[o], primaryN) - THEORETICAL_BASE_54[o], 6)])),
    baseRateShiftMagnitude: roundTo(shiftMagnitude, 6),
    regimeStatus: regime.status,
    timeSignalConfidence: roundTo(confidence, 4),
    windows: windows.map((w) => ({
      key: w.key,
      label: w.label,
      kind: w.kind,
      sampleSize: w.sampleSize,
      shiftMagnitude: roundTo(
        totalVariationDistance(
          OUTCOMES_8.map((o) => w.counts[o] / Math.max(1, w.sampleSize)),
          OUTCOMES_8.map((o) => THEORETICAL_BASE_54[o]),
        ),
        6,
      ),
    })),
    explanation: [],
  };

  const why: string[] = [];
  why.push(`${primaryWindow.label}: n=${primaryN}, TVD vs theoretical = ${shiftMagnitude.toFixed(3)}.`);
  why.push(regime.notes[0]);
  why.push(dynamicBase.notes[0]);
  why.push(
    active
      ? "The time signal IS allowed to influence the ensemble (its own feature flag and validation status are checked by the ensemble)."
      : `The time signal does NOT change the prediction: ${activeReason}`,
  );
  if (regime.status !== "CONFIRMED_REGIME") {
    why.push("No confirmed time regime → the theoretical 54-sector profile keeps the dominant weight (short samples cannot rewrite it).");
  }
  diagnostics.explanation = why;

  return {
    version: TIME_SIGNAL_VERSION,
    lockTimestamp,
    latestUsedTimestamp,
    leakageSafe,
    active,
    activeReason,
    confidence: roundTo(confidence, 4),
    scores,
    multipliers,
    dynamicBase,
    regime,
    windows,
    primaryWindow,
    diagnostics,
    why,
  };
}

// ============================================================
// 8. WALK-FORWARD SAFETY HELPER
// ============================================================

/**
 * Assert the walk-forward contract for one time-signal evaluation:
 *   latestUsedTimestamp <= lockTimestamp < settledAtOfThePredictedRound
 * Returns a machine-readable audit entry (never throws in production paths —
 * the caller decides whether to reject the round).
 */
export function auditTimeSignalUsage(
  result: TimeSignalResult,
  currentRoundSettledAt: number,
): {
  passed: boolean;
  latestUsedTimestamp: number | null;
  lockTimestamp: number;
  currentRoundSettledAt: number;
  reason: string;
} {
  const latest = result.latestUsedTimestamp;
  if (latest !== null && latest > result.lockTimestamp) {
    return { passed: false, latestUsedTimestamp: latest, lockTimestamp: result.lockTimestamp, currentRoundSettledAt, reason: "latestUsedTimestamp > lockTimestamp" };
  }
  if (!(result.lockTimestamp < currentRoundSettledAt)) {
    return { passed: false, latestUsedTimestamp: latest, lockTimestamp: result.lockTimestamp, currentRoundSettledAt, reason: "lockTimestamp is not strictly before the predicted round's settlement (would allow leakage)" };
  }
  return { passed: true, latestUsedTimestamp: latest, lockTimestamp: result.lockTimestamp, currentRoundSettledAt, reason: "ok" };
}

/** Consistency check that this module's frozen theoretical base matches the
 *  engine's 54-sector profile (drift detector used by tests). */
export function theoreticalBaseMatches(expected: Record<string, number>, tolerance = 1e-4): { passed: boolean; diffs: string[] } {
  const diffs: string[] = [];
  for (const o of OUTCOMES_8) {
    const a = THEORETICAL_BASE_54[o];
    const b = expected[o];
    if (b === undefined) {
      diffs.push(`${o}: missing in expected`);
      continue;
    }
    if (Math.abs(a - b) > tolerance) diffs.push(`${o}: local=${a.toFixed(4)} expected=${b.toFixed(4)}`);
  }
  return { passed: diffs.length === 0, diffs };
}
