/**
 * STRICT WALK-FORWARD VALIDATION HARNESS FOR THE NEW SIGNALS (ADDITIVE)
 * =====================================================================
 *
 * NEW FILE. It does not modify the production engine; it EVALUATES it and the
 * new signal layers side by side on REAL settled rounds.
 *
 * ARMS (as required):
 *   A = theoretical [1,2,5,10]
 *   B = existing production history engine
 *   C = time-only
 *   D = dealer-only
 *   E = physics-only
 *   F = history + time
 *   G = history + dealer
 *   H = history + physics
 *   I = time + dealer + physics
 *   J = full ensemble
 *
 * METHOD
 * ------
 *   · Strict walk-forward: for round i the lock timestamp is strictly before
 *     that round's settlement; every feature uses only rounds that had ALREADY
 *     settled at the lock, and `latestUsedTimestamp <= lockTimestamp` is
 *     asserted and reported for every single round.
 *   · Paired comparison: a comparison between two arms is computed on the
 *     INTERSECTION of the rounds where both arms produced a real prediction —
 *     arms evaluated on different subsets are never compared as if paired.
 *   · Uncertainty: Wilson intervals + percentile bootstrap CIs, per-arm sample
 *     sizes, calibration (Brier / log-loss / reliability bins).
 *   · Audits: duplicate audit (spin/round ids), timestamp audit (monotonic,
 *     no future timestamps), leakage audit (no post-lock information).
 *   · Honesty: an arm without real data is reported as UNAVAILABLE — never
 *     fabricated, never silently replaced. A hit-rate is never promoted on a
 *     small sample; the promotion gate lives in `signalFlags.ts` and requires
 *     ≥ MIN_PAIRED_ROUNDS, a positive delta, a conclusive paired test, and
 *     clean audits.
 *   · 100% accuracy is a development target, NOT a claim. `disclaimer` is
 *     embedded in every report.
 */

import {
  benjaminiHochberg,
  bootstrapRateCI,
  brierScore,
  calibrationBins,
  expectedCalibrationError,
  logLoss,
  mcnemarPaired,
  mulberry32,
  round as roundTo,
  safeDiv,
  seedFromString,
  wilsonInterval,
  type CalibrationBin,
  type Interval,
} from "./signalStats";
import {
  OUTCOMES_8,
  THEORETICAL_BASE_54,
  auditTimeSignalUsage,
  computeTimeSignal,
  duplicateAudit,
  normalizeRounds,
  toTimedRound,
  type TimedRound,
} from "./timeSignal";
import { ARM_LABELS, computeArms, type AblationArm } from "./signalEnsemble";
import type { PhysicsEvidence } from "./wheelPhysicsLayer";
import type { DealerSignalResult } from "./dealerSignal";
import { MIN_PAIRED_ROUNDS } from "./signalFlags";

export const SIGNAL_VALIDATION_VERSION = "signal-validation-v1.0";

// ============================================================
// INPUTS
// ============================================================

export interface ValidationRoundInput {
  roundId: string;
  spinId: string;
  settledAt: number;              // REAL settlement time (ms epoch)
  outcome: string;                // REAL settled outcome
  /** The prediction the production engine actually locked live (arm B). */
  productionTop4?: string[] | null;
  /** Probability vector for arm B (optional; enables Brier/log-loss for B). */
  productionProbabilities?: Record<string, number> | null;
  /** Physical evidence for this lock, when video data exists. */
  physicsEvidence?: PhysicsEvidence | null;
  /** Dealer signal for this lock, when dealer data exists. */
  dealerSignal?: DealerSignalResult | null;
  /** Explicit lock timestamp (defaults to the previous round's settlement). */
  lockTimestamp?: number;
}

export interface SignalValidationOptions {
  dataset: string;
  utcOffsetMinutes?: number;
  /** Arm B replay: produces the production engine's probabilities from the
   *  history available at the lock (used for calibration metrics). */
  productionReplay?: (history: ValidationRoundInput[]) => { top4: string[]; probabilities: Record<string, number> } | null;
  minRoundsForReporting?: number;
  bootstrapIterations?: number;
  seed?: number;
}

// ============================================================
// OUTPUTS
// ============================================================

export interface ArmResult {
  key: AblationArm;
  label: string;
  available: boolean;
  unavailableReason: string | null;
  rounds: number;
  hits: number;
  hitRate: number;
  wilson: Interval;
  bootstrapCI: Interval;
  brier: number | null;
  logLoss: number | null;
  calibration: CalibrationBin[];
  expectedCalibrationError: number | null;
  perOutcome: { outcome: string; actuals: number; covered: number; inclusionRate: number; coverageRate: number }[];
  bonusInclusionRate: number | null;
}

export interface PairedComparison {
  label: string;
  armA: AblationArm;
  armB: AblationArm;
  pairedRounds: number;
  onlyA: number;
  onlyB: number;
  rateA: number;
  rateB: number;
  deltaPp: number;
  mcnemarP: number;
  mcnemarConclusive: boolean;
  significant: boolean;
  ciLowDeltaPp: number;
  ciHighDeltaPp: number;
  note: string;
}

export interface ValidationAudit {
  duplicate: { passed: boolean; duplicates: { key: string; count: number }[] };
  timestamp: { passed: boolean; problems: string[]; firstSettledAt: number | null; lastSettledAt: number | null; monotonic: boolean };
  leakage: { passed: boolean; violations: { roundId: string; detail: string }[]; checkedRounds: number };
  integrity: { passed: boolean; problems: string[] };
}

export interface SignalValidationReport {
  version: string;
  dataset: string;
  generatedAt: number;
  roundsEvaluated: number;
  roundsAvailable: number;
  roundRange: { from: number | null; to: number | null };
  arms: Record<AblationArm, ArmResult>;
  comparisons: PairedComparison[];
  audits: ValidationAudit;
  timeSignalDiagnostics: {
    regimeStatusCounts: Record<string, number>;
    activeRounds: number;
    meanConfidence: number;
    meanPrimarySample: number;
    windowUsage: Record<string, number>;
  };
  recommendation: {
    promotable: { signal: string; allowed: boolean; reasons: string[] }[];
    summary: string;
  };
  disclaimer: string;
}

const ARM_ORDER: AblationArm[] = [
  "A_theoretical",
  "B_history",
  "C_time",
  "D_dealer",
  "E_physics",
  "F_history_time",
  "G_history_dealer",
  "H_history_physics",
  "I_time_dealer_physics",
  "J_full",
];

interface ArmRoundRecord {
  index: number;
  roundId: string;
  actual: string;
  top4: string[];
  hit: boolean;
  probs: Record<string, number> | null;
}

// ============================================================
// CORE HARNESS
// ============================================================

export function runSignalValidation(
  inputs: ValidationRoundInput[],
  options: SignalValidationOptions,
): SignalValidationReport {
  const minRoundsForReporting = options.minRoundsForReporting ?? 1;
  const bootstrapIterations = options.bootstrapIterations ?? 2000;
  const seed = options.seed ?? 20260919;

  // ---- data integrity: only real settled rounds, chronologically, deduped ----
  const timedRounds: TimedRound[] = [];
  for (const r of inputs) {
    try {
      timedRounds.push(
        toTimedRound({
          roundId: r.roundId,
          spinId: r.spinId,
          outcome: r.outcome,
          settledAt: r.settledAt,
          source: "validation-input",
        }),
      );
    } catch {
      // invalid rows are dropped (they can never be "real settled rounds")
    }
  }
  const duplicateReport = duplicateAudit(timedRounds);
  const ordered = normalizeRounds(timedRounds);

  const armRounds: Record<AblationArm, ArmRoundRecord[]> = Object.fromEntries(
    ARM_ORDER.map((k) => [k, [] as ArmRoundRecord[]]),
  ) as Record<AblationArm, ArmRoundRecord[]>;
  const armUnavailable: Record<AblationArm, string | null> = Object.fromEntries(
    ARM_ORDER.map((k) => [k, null]),
  ) as Record<AblationArm, string | null>;

  const leakageViolations: { roundId: string; detail: string }[] = [];
  const timestampProblems: string[] = [];
  let monotonic = true;

  const regimeCounts: Record<string, number> = {};
  let timeActiveRounds = 0;
  let timeConfidenceSum = 0;
  let timeSampleSum = 0;
  const windowUsage: Record<string, number> = {};

  const inputById = new Map(inputs.map((r) => [r.roundId, r]));
  const inputBySpin = new Map(inputs.map((r) => [r.spinId, r]));

  for (let i = 0; i < ordered.length; i++) {
    const round = ordered[i];
    const input = inputById.get(round.roundId) ?? inputBySpin.get(round.spinId);
    if (!input) continue;

    const history = ordered.slice(0, i); // only rounds that settled EARLIER
    const lockTimestamp = input.lockTimestamp ?? (history.length > 0 ? history[history.length - 1].settledAt : round.settledAt - 1);
    if (!(lockTimestamp < round.settledAt)) {
      timestampProblems.push(`round ${round.roundId}: lockTimestamp ${lockTimestamp} is not strictly before settledAt ${round.settledAt}`);
    }
    if (history.length > 0 && history[history.length - 1].settledAt >= round.settledAt) {
      monotonic = false;
      timestampProblems.push(`round ${round.roundId}: history contains a round settled at/after this round`);
    }

    // --- TIME signal (walk-forward: computed from history only) ---
    const timeSignal = computeTimeSignal({
      rounds: history,
      lockTimestamp,
      options: { utcOffsetMinutes: options.utcOffsetMinutes },
    });
    const timeAudit = auditTimeSignalUsage(timeSignal, round.settledAt);
    if (!timeAudit.passed) {
      leakageViolations.push({ roundId: round.roundId, detail: `${timeAudit.reason} (latestUsed=${timeAudit.latestUsedTimestamp}, lock=${timeAudit.lockTimestamp}, settledAt=${round.settledAt})` });
    }
    regimeCounts[timeSignal.regime.status] = (regimeCounts[timeSignal.regime.status] ?? 0) + 1;
    if (timeSignal.active) timeActiveRounds++;
    timeConfidenceSum += timeSignal.confidence;
    timeSampleSum += timeSignal.primaryWindow.sampleSize;
    windowUsage[timeSignal.primaryWindow.key] = (windowUsage[timeSignal.primaryWindow.key] ?? 0) + 1;

    const physics = input.physicsEvidence ?? null;
    const dealer = input.dealerSignal ?? null;

    // --- PRODUCTION arm B ---
    let historyTop4: string[] | null = input.productionTop4 ?? null;
    let historyProbs: Record<string, number> | null = input.productionProbabilities ?? null;
    if (options.productionReplay && (!historyTop4 || !historyProbs)) {
      const replay = options.productionReplay(
        history.map((h) => inputById.get(h.roundId) ?? inputBySpin.get(h.spinId) ?? { roundId: h.roundId, spinId: h.spinId, settledAt: h.settledAt, outcome: h.outcome }),
      );
      if (replay) {
        historyTop4 = historyTop4 ?? replay.top4;
        historyProbs = historyProbs ?? replay.probabilities;
      }
    }

    const arms = computeArms({
      lockTimestamp,
      latestUsedTimestamp: timeSignal.latestUsedTimestamp,
      historyProbabilities: historyProbs,
      historyTop4,
      timeScores: timeSignal.scores,
      timeActive: timeSignal.active,
      timeConfidence: timeSignal.confidence,
      dealerScores: dealer?.scores ?? null,
      dealerActive: dealer?.active ?? false,
      dealerConfidence: dealer?.confidence ?? 0,
      physicsProbabilities: physics?.outcomeProbabilities ?? null,
      physicsActive: physics?.evidence ?? false,
      physicsConfidence: physics?.physicsConfidence ?? 0,
    });

    for (const key of ARM_ORDER) {
      const arm = arms[key];
      if (!arm.available) {
        armUnavailable[key] = armUnavailable[key] ?? arm.reason;
        continue;
      }
      armRounds[key].push({
        index: i,
        roundId: round.roundId,
        actual: round.outcome,
        top4: arm.top4,
        hit: arm.top4.includes(round.outcome),
        probs: arm.probabilities && Object.keys(arm.probabilities).length > 0 ? arm.probabilities : null,
      });
    }
  }

  // ---- per-arm results ----
  const armsResult = Object.fromEntries(
    ARM_ORDER.map((key) => {
      const records = armRounds[key];
      const n = records.length;
      const hits = records.filter((r) => r.hit).length;
      const perOutcome = OUTCOMES_8.map((o) => {
        const actuals = records.filter((r) => r.actual === o);
        const covered = actuals.filter((r) => r.hit).length;
        const inclusions = records.filter((r) => r.top4.includes(o)).length;
        return {
          outcome: o,
          actuals: actuals.length,
          covered,
          inclusionRate: roundTo(safeDiv(inclusions, n), 4),
          coverageRate: roundTo(safeDiv(covered, actuals.length), 4),
        };
      });
      const bonusInclusions = records.reduce((s, r) => s + r.top4.filter((x) => ["COIN FLIP", "PACHINKO", "CASH HUNT", "CRAZY TIME"].includes(x)).length, 0);
      const probSamples = records
        .map((r) => (r.probs ? { probs: r.probs, actual: r.actual } : null))
        .filter((x): x is { probs: Record<string, number>; actual: string } => x !== null);
      const bins = probSamples.length > 0 ? calibrationBins(probSamples, 5) : [];
      return [
        key,
        {
          key,
          label: ARM_LABELS[key],
          available: n > 0,
          unavailableReason: n === 0 ? armUnavailable[key] ?? "no rounds evaluated" : null,
          rounds: n,
          hits,
          hitRate: roundTo(safeDiv(hits, n), 6),
          wilson: wilsonInterval(hits, n),
          bootstrapCI: bootstrapRateCI(records.map((r) => r.hit), { iterations: bootstrapIterations, seed, level: 0.95 }),
          brier: probSamples.length > 0 ? roundTo(probSamples.reduce((s, x) => s + brierScore(x.probs, x.actual), 0) / probSamples.length, 6) : null,
          logLoss: probSamples.length > 0 ? roundTo(probSamples.reduce((s, x) => s + logLoss(x.probs, x.actual), 0) / probSamples.length, 6) : null,
          calibration: bins,
          expectedCalibrationError: bins.length > 0 ? roundTo(expectedCalibrationError(bins), 6) : null,
          perOutcome,
          bonusInclusionRate: n > 0 ? roundTo(safeDiv(bonusInclusions, n), 6) : null,
        } satisfies ArmResult,
      ] as const;
    }),
  ) as Record<AblationArm, ArmResult>;

  // ---- paired comparisons on the INTERSECTION of evaluated rounds ----
  const comparisons: PairedComparison[] = [];
  const byIndex = (key: AblationArm): Map<number, ArmRoundRecord> => new Map(armRounds[key].map((r) => [r.index, r]));

  const compare = (label: string, armA: AblationArm, armB: AblationArm): PairedComparison => {
    const a = byIndex(armA);
    const b = byIndex(armB);
    if (a.size === 0 || b.size === 0) {
      return {
        label,
        armA,
        armB,
        pairedRounds: 0,
        onlyA: 0,
        onlyB: 0,
        rateA: 0,
        rateB: 0,
        deltaPp: 0,
        mcnemarP: 1,
        mcnemarConclusive: false,
        significant: false,
        ciLowDeltaPp: 0,
        ciHighDeltaPp: 0,
        note: `NOT EVALUATED — arm ${a.size === 0 ? armA : armB} has no real data on this dataset.`,
      };
    }
    const shared = [...a.keys()].filter((idx) => b.has(idx)).sort((x, y) => x - y);
    if (shared.length === 0) {
      return {
        label,
        armA,
        armB,
        pairedRounds: 0,
        onlyA: 0,
        onlyB: 0,
        rateA: 0,
        rateB: 0,
        deltaPp: 0,
        mcnemarP: 1,
        mcnemarConclusive: false,
        significant: false,
        ciLowDeltaPp: 0,
        ciHighDeltaPp: 0,
        note: "NOT EVALUATED — the two arms were never active on the same round.",
      };
    }
    const hitsA = shared.map((idx) => a.get(idx)!.hit);
    const hitsB = shared.map((idx) => b.get(idx)!.hit);
    const mc = mcnemarPaired(hitsA, hitsB);
    // Paired percentile bootstrap on the hit-rate difference (same resample for both arms).
    const rnd = mulberry32(seed ^ seedFromString(label));
    const diffs: number[] = [];
    for (let it = 0; it < bootstrapIterations; it++) {
      let ha = 0;
      let hb = 0;
      for (let k = 0; k < shared.length; k++) {
        const idx = (rnd() * shared.length) | 0;
        if (hitsA[idx]) ha++;
        if (hitsB[idx]) hb++;
      }
      diffs.push((ha - hb) / shared.length);
    }
    diffs.sort((x, y) => x - y);
    const lo = diffs[Math.floor(0.025 * diffs.length)] ?? 0;
    const hi = diffs[Math.floor(0.975 * diffs.length)] ?? 0;
    const rateA = hitsA.filter(Boolean).length / shared.length;
    const rateB = hitsB.filter(Boolean).length / shared.length;
    return {
      label,
      armA,
      armB,
      pairedRounds: shared.length,
      onlyA: mc.r,
      onlyB: mc.s,
      rateA: roundTo(rateA, 6),
      rateB: roundTo(rateB, 6),
      deltaPp: roundTo((rateA - rateB) * 100, 3),
      mcnemarP: roundTo(mc.pValue, 6),
      mcnemarConclusive: mc.conclusive,
      significant: mc.significant,
      ciLowDeltaPp: roundTo(lo * 100, 3),
      ciHighDeltaPp: roundTo(hi * 100, 3),
      note: mc.note,
    };
  };

  const comparisonSpecs: { armA: AblationArm; armB: AblationArm; label: string }[] = [
    { armA: "C_time", armB: "B_history", label: "C (time-only) vs B (production)" },
    { armA: "F_history_time", armB: "B_history", label: "F (history+time) vs B (production)" },
    { armA: "D_dealer", armB: "B_history", label: "D (dealer-only) vs B (production)" },
    { armA: "G_history_dealer", armB: "B_history", label: "G (history+dealer) vs B (production)" },
    { armA: "E_physics", armB: "B_history", label: "E (physics-only) vs B (production)" },
    { armA: "H_history_physics", armB: "B_history", label: "H (history+physics) vs B (production)" },
    { armA: "I_time_dealer_physics", armB: "B_history", label: "I (time+dealer+physics) vs B (production)" },
    { armA: "J_full", armB: "B_history", label: "J (full ensemble) vs B (production)" },
    { armA: "J_full", armB: "F_history_time", label: "J (full ensemble) vs F (history+time)" },
    { armA: "C_time", armB: "A_theoretical", label: "C (time-only) vs A (theoretical)" },
    { armA: "F_history_time", armB: "A_theoretical", label: "F (history+time) vs A (theoretical)" },
    { armA: "D_dealer", armB: "A_theoretical", label: "D (dealer-only) vs A (theoretical)" },
    { armA: "G_history_dealer", armB: "A_theoretical", label: "G (history+dealer) vs A (theoretical)" },
    { armA: "E_physics", armB: "A_theoretical", label: "E (physics-only) vs A (theoretical)" },
    { armA: "H_history_physics", armB: "A_theoretical", label: "H (history+physics) vs A (theoretical)" },
    { armA: "I_time_dealer_physics", armB: "A_theoretical", label: "I (time+dealer+physics) vs A (theoretical)" },
    { armA: "B_history", armB: "A_theoretical", label: "B (production) vs A (theoretical)" },
    { armA: "J_full", armB: "A_theoretical", label: "J (full ensemble) vs A (theoretical)" },
  ];
  for (const spec of comparisonSpecs) comparisons.push(compare(spec.label, spec.armA, spec.armB));

  // Multiple-comparison control across the whole family of paired tests.
  const evaluatedPairs = comparisons.filter((c) => c.pairedRounds > 0);
  const fdrFlags = benjaminiHochberg(evaluatedPairs.map((c) => c.mcnemarP), 0.05);
  evaluatedPairs.forEach((c, idx) => {
    if (fdrFlags[idx]) c.note += " [survives BH-FDR 5% across the comparison family]";
  });

  // ---- audits ----
  const integrityProblems: string[] = [];
  if (!duplicateReport.passed) integrityProblems.push(`${duplicateReport.duplicates.length} duplicate round id(s)`);
  if (leakageViolations.length > 0) integrityProblems.push(`${leakageViolations.length} leakage violation(s)`);
  if (timestampProblems.length > 0) integrityProblems.push(`${timestampProblems.length} timestamp problem(s)`);
  const audits: ValidationAudit = {
    duplicate: {
      passed: duplicateReport.passed,
      duplicates: duplicateReport.duplicates.map((d) => ({ key: d.key, count: d.count })),
    },
    timestamp: {
      passed: timestampProblems.length === 0,
      problems: timestampProblems.slice(0, 50),
      firstSettledAt: ordered.length > 0 ? ordered[0].settledAt : null,
      lastSettledAt: ordered.length > 0 ? ordered[ordered.length - 1].settledAt : null,
      monotonic,
    },
    leakage: { passed: leakageViolations.length === 0, violations: leakageViolations.slice(0, 50), checkedRounds: ordered.length },
    integrity: { passed: integrityProblems.length === 0, problems: integrityProblems },
  };

  // ---- promotion gate ----
  const promotable: SignalValidationReport["recommendation"]["promotable"] = [];
  // A signal is only promotable when it BEATS the production engine AND adds
  // measurable value over the trivial theoretical [1,2,5,10] set. A layer whose
  // only "edge" is that it reproduces the theoretical distribution must never
  // be promoted as a predictive signal.
  const evaluatePromotion = (signal: string, armKey: AblationArm, baselineKey: AblationArm) => {
    const arm = armsResult[armKey];
    const comparison = comparisons.find((c) => c.armA === armKey && c.armB === baselineKey);
    const theoryComparison = comparisons.find((c) => c.armA === armKey && c.armB === "A_theoretical");
    const reasons: string[] = [];
    if (!arm.available) reasons.push("arm has no real data on this dataset");
    if (arm.rounds < MIN_PAIRED_ROUNDS) reasons.push(`only ${arm.rounds} rounds (need ≥${MIN_PAIRED_ROUNDS})`);
    if (!comparison || comparison.pairedRounds === 0) {
      reasons.push(`no paired comparison available vs ${baselineKey}`);
    } else {
      if (comparison.pairedRounds < MIN_PAIRED_ROUNDS) reasons.push(`only ${comparison.pairedRounds} paired rounds vs ${baselineKey} (need ≥${MIN_PAIRED_ROUNDS})`);
      if (!(comparison.deltaPp > 0)) reasons.push(`out-of-sample delta vs ${baselineKey} ${comparison.deltaPp.toFixed(2)} pp is not positive`);
      if (!(comparison.ciLowDeltaPp > 0)) reasons.push(`bootstrap CI lower bound vs ${baselineKey} ${comparison.ciLowDeltaPp.toFixed(2)} pp is not > 0`);
      if (!(comparison.mcnemarConclusive && comparison.mcnemarP < 0.05)) reasons.push(`paired McNemar vs ${baselineKey} not conclusive/significant (p=${comparison.mcnemarP})`);
    }
    if (!theoryComparison || theoryComparison.pairedRounds === 0) {
      reasons.push("no paired comparison available vs the theoretical [1,2,5,10] baseline");
    } else {
      if (!(theoryComparison.deltaPp > 0)) reasons.push(`does NOT beat the theoretical [1,2,5,10] baseline (Δ=${theoryComparison.deltaPp.toFixed(2)} pp over ${theoryComparison.pairedRounds} paired rounds)`);
      else if (!(theoryComparison.ciLowDeltaPp > 0)) reasons.push(`cannot conclude any advantage over the theoretical baseline (CI low ${theoryComparison.ciLowDeltaPp.toFixed(2)} pp)`);
    }
    if (!audits.leakage.passed) reasons.push("leakage audit failed");
    if (!audits.duplicate.passed) reasons.push("duplicate audit failed");
    if (!audits.timestamp.passed) reasons.push("timestamp audit failed");
    promotable.push({ signal, allowed: reasons.length === 0, reasons });
  };
  evaluatePromotion("TIME_SIGNAL", "C_time", "B_history");
  evaluatePromotion("DEALER_SIGNAL", "D_dealer", "B_history");
  evaluatePromotion("PHYSICS_SIGNAL", "E_physics", "B_history");
  evaluatePromotion("FUSION", "J_full", "B_history");

  const evaluated = ordered.length;
  const summary = evaluated < minRoundsForReporting
    ? `INSUFFICIENT DATA: only ${evaluated} real settled rounds evaluated. No promotion decision is possible.`
    : `Evaluated ${evaluated} real settled rounds. Promotion requires ≥${MIN_PAIRED_ROUNDS} paired rounds with a positive, CI-supported out-of-sample delta and clean audits.`;

  return {
    version: SIGNAL_VALIDATION_VERSION,
    dataset: options.dataset,
    generatedAt: Date.now(),
    roundsEvaluated: evaluated,
    roundsAvailable: ordered.length,
    roundRange: {
      from: ordered.length > 0 ? ordered[0].settledAt : null,
      to: ordered.length > 0 ? ordered[ordered.length - 1].settledAt : null,
    },
    arms: armsResult,
    comparisons,
    audits,
    timeSignalDiagnostics: {
      regimeStatusCounts: regimeCounts,
      activeRounds: timeActiveRounds,
      meanConfidence: evaluated > 0 ? roundTo(timeConfidenceSum / evaluated, 4) : 0,
      meanPrimarySample: evaluated > 0 ? roundTo(timeSampleSum / evaluated, 2) : 0,
      windowUsage,
    },
    recommendation: { promotable, summary },
    disclaimer:
      "100% accuracy is a DEVELOPMENT TARGET, never a guarantee. Walk-forward results are out-of-sample for the model but come from a historical dataset; a genuine promotion additionally requires fresh live paired rounds. No signal is promoted on a small sample, and the production scorer is untouched until a promotion gate passes.",
  };
}

/** Convenience: build ValidationRoundInput rows from a raw settled-round list. */
export function roundsToValidationInputs(
  rows: { roundId: string; spinId: string; settledAt: number; outcome: string; productionTop4?: string[] | null }[],
): ValidationRoundInput[] {
  return rows.map((r) => ({
    roundId: r.roundId,
    spinId: r.spinId,
    settledAt: r.settledAt,
    outcome: r.outcome,
    productionTop4: r.productionTop4 ?? null,
  }));
}

export { THEORETICAL_BASE_54 };
