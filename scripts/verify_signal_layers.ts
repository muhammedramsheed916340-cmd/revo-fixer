/**
 * SIGNAL LAYER MECHANISM VERIFICATION (ADDITIVE tooling)
 * =====================================================
 * Runs plain-Node assertions over the new layers. This checks MECHANISMS
 * (statistics, gating, leakage guards, determinism, integrity) — it makes no
 * accuracy claim. Accuracy is evaluated separately by
 * `scripts/validate_signal_layers.ts` on real settled rounds.
 *
 * Run:
 *   node --import ./scripts/ts-resolve-register.mjs scripts/verify_signal_layers.ts
 */

import {
  bootstrapRateCI,
  chiSquareHomogeneity,
  chiSquareSurvival,
  mcnemarPaired,
  mulberry32,
  wilsonInterval,
} from "../src/components/revo/signalStats";
import {
  OUTCOMES_8,
  THEORETICAL_BASE_54,
  auditTimeSignalUsage,
  computeTimeSignal,
  duplicateAudit,
  toTimedRound,
  type TimedRound,
} from "../src/components/revo/timeSignal";
import {
  rotationReadout,
  ROTATION_DIRECTION_MIN_DEG_PER_SEC,
  analyzeDirection,
  analyzeSpeed,
  analyzeVibration,
  buildSyntheticSpinFrames,
  classifyMotionState,
  computePhysicsEvidence,
  learnDeceleration,
  lockPhysicsPrediction,
} from "../src/components/revo/wheelPhysicsLayer";
import {
  appendDossier,
  appendPrediction,
  applyDossierUpdate,
  getDossiers as getDossiersForTest,
  getPredictions as getPredictionsForTest,
  auditLedger,
  buildPredictionRecord,
  clearLedger,
  createDossier,
  finalizeDossier,
  summarizeDossiers,
  upsertDossier,
} from "../src/components/revo/physicsDossier";
import {
  estimateDealerPosition,
  exportDealerProfiles,
  getDealerProfiles,
  importDealerProfiles,
  assertIdentitySafety,
  attachRoundToDealer,
  compareDealerToBaseline,
  computeDealerSignal,
  detectDealerRegime,
  identifyDealer,
  recordDealerObservation,
  resetDealerProfiles,
  sanitizePublicName,
} from "../src/components/revo/dealerSignal";
import { computeArms, fuseSignals, selectTop4Dynamic } from "../src/components/revo/signalEnsemble";
import { SIGNAL_FLAGS_OFF, __setFlagsForTest, canPromote, setSignalFlag, getSignalFlags } from "../src/components/revo/signalFlags";
import { runSignalValidation } from "../src/components/revo/signalValidation";
import {
  auditSignalStore,
  getMotionFrames,
  observeDealer,
  ingestLivePhysicsBuffer,
  syncLiveFrames,
  buildLiveSignalBundle,
  clearSignalStore,
  getProductionPrediction,
  getTimedRounds,
  publishProductionPrediction,
  recordMotionFrame,
  recordSettledRound,
} from "../src/components/revo/signalDataStore";

// ---------------------------------------------------------------------------
// tiny assertion harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(name: string): void {
  console.log(`\n== ${name}`);
}

// ---------------------------------------------------------------------------
// 1. statistics kernel
// ---------------------------------------------------------------------------
section("statistics kernel");
check("chi-square SF: χ²=0 → p=1", Math.abs(chiSquareSurvival(0, 1) - 1) < 1e-9);
check("chi-square SF: χ²=3.841, df=1 → p≈0.05", Math.abs(chiSquareSurvival(3.841, 1) - 0.05) < 0.002, `p=${chiSquareSurvival(3.841, 1).toFixed(4)}`);
check("chi-square SF decreases with χ²", chiSquareSurvival(10, 1) < chiSquareSurvival(5, 1));
const wi = wilsonInterval(5, 10);
check("Wilson interval brackets p", wi.low < 0.5 && wi.high > 0.5, JSON.stringify(wi));
const homogeneous = chiSquareHomogeneity([50, 30, 20], [50, 30, 20], { minSample: 30 });
check("identical distributions → not significant", !homogeneous.test.significant, homogeneous.test.note);
const shifted = chiSquareHomogeneity([90, 5, 5], [20, 40, 40], { minSample: 30 });
check("very different distributions → significant", shifted.test.significant, shifted.test.note);
const mcInconclusive = mcnemarPaired([true, false, true, false], [true, true, false, false]);
check("McNemar refuses to conclude on a tiny sample", !mcInconclusive.significant && !mcInconclusive.conclusive, mcInconclusive.note);
const ci1 = bootstrapRateCI([true, true, false, true, false]);
const ci2 = bootstrapRateCI([true, true, false, true, false]);
check("bootstrap CI is deterministic", JSON.stringify(ci1) === JSON.stringify(ci2));
check("seeded PRNG is reproducible", mulberry32(42)() === mulberry32(42)());

// ---------------------------------------------------------------------------
// 2. time signal
// ---------------------------------------------------------------------------
section("time signal");
let threw = false;
try {
  toTimedRound({ outcome: "1", settledAt: 0 });
} catch {
  threw = true;
}
check("toTimedRound rejects a fake timestamp", threw);
threw = false;
try {
  toTimedRound({ outcome: "NOT_A_SECTOR", settledAt: Date.now() });
} catch {
  threw = true;
}
check("toTimedRound rejects an unknown outcome", threw);

const t0 = Date.parse("2026-09-13T20:00:00Z");
const cycleRounds: TimedRound[] = Array.from({ length: 300 }, (_, i) =>
  toTimedRound({ outcome: OUTCOMES_8[i % 8], settledAt: t0 + i * 60_000, spinId: `s-${i}` }),
);
const lock = t0 + 300 * 60_000;
const sig = computeTimeSignal({ rounds: cycleRounds, lockTimestamp: lock });
check("time signal computes all 8 scores summing to 1", Math.abs(OUTCOMES_8.reduce((s, o) => s + sig.scores[o], 0) - 1) < 1e-6);
check("no regime claimed on benign data", sig.regime.status === "NO_REGIME", sig.regime.status);
check("theoretical floor holds without a confirmed regime", sig.dynamicBase.weights.theoretical >= 0.59, JSON.stringify(sig.dynamicBase.weights));
check("dynamic base is finite and positive", OUTCOMES_8.every((o) => Number.isFinite(sig.scores[o]) && sig.scores[o] > 0));
const audit = auditTimeSignalUsage(sig, lock + 60_000);
check("leakage audit passes on a valid lock", audit.passed, audit.reason);

// future rounds must be excluded
const futureRounds = cycleRounds.map((r, i) => (i >= 250 ? { ...r, outcome: "CRAZY TIME" } : r));
const sig2 = computeTimeSignal({ rounds: futureRounds, lockTimestamp: lock });
check("rounds settled after the lock are never used", sig2.latestUsedTimestamp !== null && sig2.latestUsedTimestamp <= lock);

// extreme recent shift → the gate must decide, not the code path.
// 250 balanced rounds, then 60 rounds all "1" so the 50-round recent window
// sits entirely inside the shifted stretch while the 100-round prior window
// still contains the balanced history.
const shiftedRounds: TimedRound[] = [
  ...Array.from({ length: 250 }, (_, i) => toTimedRound({ outcome: OUTCOMES_8[i % 8], settledAt: t0 + i * 60_000, spinId: `a-${i}` })),
  ...Array.from({ length: 60 }, (_, i) => toTimedRound({ outcome: "1", settledAt: t0 + (250 + i) * 60_000, spinId: `b-${i}` })),
];
const lockShift = t0 + 310 * 60_000;
const sigShift = computeTimeSignal({ rounds: shiftedRounds, lockTimestamp: lockShift });
check(
  "extreme recent shift is evaluated by the statistical gate (not auto-accepted)",
  sigShift.regime.status === "CONFIRMED_REGIME" || sigShift.regime.status === "CANDIDATE_REGIME",
  sigShift.regime.status,
);
check(
  "a confirmed regime is the only path that relaxes the theoretical floor",
  sigShift.regime.status !== "CONFIRMED_REGIME" ? sigShift.dynamicBase.weights.theoretical >= 0.59 : sigShift.dynamicBase.weights.theoretical < 0.59,
  JSON.stringify(sigShift.dynamicBase.weights),
);
const tiny = computeTimeSignal({ rounds: cycleRounds.slice(0, 12), lockTimestamp: t0 + 12 * 60_000 });
check("tiny history → INSUFFICIENT_DATA and inactive", tiny.regime.status === "INSUFFICIENT_DATA" && !tiny.active);
check("duplicate audit passes on unique rounds", duplicateAudit(cycleRounds).passed);
const dupes = duplicateAudit([...cycleRounds, cycleRounds[0]]);
check("duplicate audit catches a duplicated spin", !dupes.passed && dupes.duplicates.length === 1);
check("theoretical base matches the engine profile shape", Math.abs(OUTCOMES_8.reduce((s, o) => s + THEORETICAL_BASE_54[o], 0) - 1) < 1e-9);

// ---------------------------------------------------------------------------
// 3. wheel physics layer
// ---------------------------------------------------------------------------
section("wheel physics layer");
const spinRight = buildSyntheticSpinFrames({ spinId: "sp-r", startTimestamp: t0, durationMs: 8000, peakVelocity: 900, deceleration: 220, noise: 0.4, seed: 7 });
const dirRight = analyzeDirection(spinRight);
check("direction measured as RIGHT for positive rotation", dirRight.direction === "RIGHT", dirRight.note);
check("direction confidence is populated", dirRight.confidence > 0.5, String(dirRight.confidence));
const spinLeft = buildSyntheticSpinFrames({ spinId: "sp-l", startTimestamp: t0, durationMs: 8000, peakVelocity: -900, deceleration: 220, noise: 0.4, seed: 8 });
check("direction measured as LEFT for negative rotation", analyzeDirection(spinLeft).direction === "LEFT");
const speed = analyzeSpeed(spinRight);
check("peak speed measured", speed.peakSpeed > 500, String(speed.peakSpeed));
check("deceleration measured from the decel phase", speed.deceleration > 50, String(speed.deceleration));
const motion = classifyMotionState(spinRight, speed);
check("state machine reports a moving/deceleration state, not IDLE", motion.state !== "IDLE", motion.state);
const stoppedFrames = buildSyntheticSpinFrames({ spinId: "sp-done", startTimestamp: t0, durationMs: 8000, peakVelocity: 300, deceleration: 200, noise: 0.2, seed: 9 });
const stoppedTail = stoppedFrames.slice(-6).map((f) => ({ ...f, isTracking: false, velocity: 0, velocityRaw: 0, acceleration: 0 }));
check("stopped tail classifies as STOPPED/NEAR_STOP", ["STOPPED", "NEAR_STOP"].includes(classifyMotionState(stoppedTail, analyzeSpeed(stoppedTail)).state));
const vib = analyzeVibration(spinRight);
check("vibration score is bounded 0..1", vib.vibrationScore >= 0 && vib.vibrationScore <= 1);
check("radial/centre metrics reported as UNAVAILABLE (null), never invented", vib.radialMovement === null && vib.centerDisplacement === null);
// Evidence must be computed from the frames available BEFORE the lock, never
// from the stopped tail of the spin.
const framesBeforeLock = spinRight.filter((f) => f.timestamp <= t0 + 6000);
const ev = computePhysicsEvidence(framesBeforeLock, { windowMs: 3000 });
check("physics evidence computed from pre-lock frames", ev.evidence && OUTCOMES_8.some((o) => (ev.outcomeProbabilities[o] ?? 0) > 0), ev.reason);
check("evidence window never includes post-lock frames", ev.latestUsedTimestamp === null || ev.latestUsedTimestamp <= t0 + 6000, String(ev.latestUsedTimestamp));
check("physics probabilities sum to ~1 when available", Math.abs(OUTCOMES_8.reduce((s, o) => s + (ev.outcomeProbabilities[o] ?? 0), 0) - 1) < 1e-6);
const evEmpty = computePhysicsEvidence([]);
check("no frames → evidence false and ALL-ZERO probabilities (never theoretical)", !evEmpty.evidence && OUTCOMES_8.every((o) => evEmpty.outcomeProbabilities[o] === 0));
const locked = lockPhysicsPrediction({
  spinId: "sp-r",
  evidenceFrames: spinRight,
  physicalStopTimestamp: t0 + 8000,
  lockTimestamp: t0 + 6000,
  top4: ["1", "2", "5", "10"],
  scores: sig.scores,
});
check("physics lock accepted before the physical stop", locked !== null && locked.frozenBeforePhysicalStop);
const lateLock = lockPhysicsPrediction({
  spinId: "sp-r",
  evidenceFrames: spinRight,
  physicalStopTimestamp: t0 + 6000,
  lockTimestamp: t0 + 6000,
  top4: ["1", "2", "5", "10"],
  scores: sig.scores,
});
check("physics lock REFUSED at/after the physical stop (no post-stop leakage)", lateLock === null);
const learned = learnDeceleration(
  [
    { spinId: "a", deceleration: 100, endedAt: t0 - 3000, direction: "RIGHT" },
    { spinId: "b", deceleration: 200, endedAt: t0 - 2000, direction: "RIGHT" },
    { spinId: "c", deceleration: 300, endedAt: t0 - 1000, direction: "RIGHT" },
    { spinId: "future", deceleration: 9999, endedAt: t0 + 1000, direction: "RIGHT" },
  ],
  t0,
);
check("learned deceleration uses only completed spins (future excluded)", learned === 200, String(learned));

// ---------------------------------------------------------------------------
// 4. physics dossier + prediction ledger
// ---------------------------------------------------------------------------
section("physics dossier + prediction ledger");
clearLedger();
let dossier = createDossier({ spinId: "sp-1", lockTimestamp: t0 + 6000, predictionTimestamp: t0 + 6000 });
dossier = applyDossierUpdate(dossier, {
  physicalStart: t0,
  physicalStop: t0 + 8000,
  latestUsedTimestamp: t0 + 5900,
  predictedStopAngle: 100,
  predictedSector: 15,
  predictedOutcome: "COIN FLIP",
  predictionTop4: ["1", "2", "5", "10"],
  all8Scores: sig.scores,
  actualSector: 15,
  direction: "RIGHT",
  physicsConfidence: 0.6,
  motionConfidence: 0.7,
  trackingConfidence: 0.8,
});
dossier = finalizeDossier(dossier, { outcome: "1", sector: 15, resultTimestamp: t0 + 9000 });
check("sector error computed (0 for the correctly predicted sector)", dossier.sectorError === 0, String(dossier.sectorError));
check("angle error computed and small for the correct sector", dossier.stopAngleError !== null && Math.abs(dossier.stopAngleError) <= 3.4, String(dossier.stopAngleError));
check("HIT derived from the Top-4 and the actual", dossier.hit === true);
check("dossier marked leakage-safe", dossier.leakageSafe);
appendDossier(dossier); // the FINALIZED dossier is what the ledger counts
upsertDossier("sp-2", t0 + 6000, { predictionTop4: ["1", "2", "5", "10"], all8Scores: sig.scores, physicsConfidence: 0.6, direction: "RIGHT", motionConfidence: 0.7, trackingConfidence: 0.8 });
const goodRecord = buildPredictionRecord({
  spinId: "sp-1",
  lockTimestamp: t0 + 6000,
  latestUsedTimestamp: t0 + 5900,
  physicalStopTimestamp: t0 + 8000,
  actualResultTimestamp: t0 + 9000,
  ensembleMode: "TEST",
  top4: ["1", "2", "5", "10"],
  all8Scores: sig.scores,
  confidence: 0.5,
  actualResult: "1",
});
const okAppend = appendPrediction(goodRecord, true);
check("valid prediction record accepted", okAppend.accepted);
const leakyRecord = buildPredictionRecord({
  spinId: "sp-leaky",
  lockTimestamp: t0 + 6000,
  latestUsedTimestamp: t0 + 7000, // AFTER the lock → must be rejected
  physicalStopTimestamp: t0 + 8000,
  ensembleMode: "TEST",
  top4: ["1", "2", "5", "10"],
  all8Scores: sig.scores,
  confidence: 0.5,
});
const leakyAppend = appendPrediction(leakyRecord, true);
check("prediction record with latestUsed > lock is REJECTED", !leakyAppend.accepted, leakyAppend.rejection?.reason);
const shortTop4 = buildPredictionRecord({
  spinId: "sp-short",
  lockTimestamp: t0 + 6000,
  latestUsedTimestamp: t0 + 5000,
  physicalStopTimestamp: t0 + 8000,
  ensembleMode: "TEST",
  top4: ["1", "2", "5"],
  all8Scores: sig.scores,
  confidence: 0.5,
});
check("prediction record with a non-4 Top-4 is REJECTED", !appendPrediction(shortTop4, true).accepted);
const ledgerAudit = auditLedger();
check("ledger duplicate audit passes", ledgerAudit.duplicatePassed);
check("ledger timestamp audit passes", ledgerAudit.timestampPassed);
check("ledger leakage audit passes", ledgerAudit.leakagePassed);
const dossierSummary = summarizeDossiers();
check("dossier summary reports a real settled sample", dossierSummary.n === 1 && dossierSummary.hits === 1, JSON.stringify({ n: dossierSummary.n, hits: dossierSummary.hits }));

// ---------------------------------------------------------------------------
// 5. dealer layer
// ---------------------------------------------------------------------------
section("dealer layer");
resetDealerProfiles();
check("identity safety rejects private-data keys", !assertIdentitySafety(["email", "name"]).passed);
check("identity safety accepts safe keys", assertIdentitySafety(["dealerId", "tableId", "timestamp"]).passed);
check("public name gate rejects an email-shaped label", sanitizePublicName("dealer@example.com") === null);
check("public name gate accepts a normal display label", sanitizePublicName("Ana R.") === "Ana R.");
const id1 = identifyDealer({ timestamp: t0, descriptor: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] });
check("first observation creates a new profile (identity never forced)", !id1.matched);
const sameProfile = identifyDealer({ timestamp: t0 + 60_000, descriptor: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] });
check("same coarse descriptor matches the same profile", sameProfile.matched && sameProfile.dealerId === id1.dealerId, sameProfile.reason);
const otherProfile = identifyDealer({ timestamp: t0 + 60_000, descriptor: [1, 1, 1, 1, 1, 1, 1, 1] });
check("a very different descriptor creates a different profile", otherProfile.dealerId !== id1.dealerId);
recordDealerObservation({ dealerId: id1.dealerId, observation: { timestamp: t0 + 120_000, confidence: 0.8, method: "combined", physics: { direction: "RIGHT", speed: 800, deceleration: 200 } } });
const round1 = toTimedRound({ outcome: "1", settledAt: t0 + 180_000, spinId: "d-1" });
check("round attribution accepted before settlement time", attachRoundToDealer({ dealerId: id1.dealerId, round: round1, attributedAt: t0 + 120_000 }).accepted);
check("duplicate round attribution rejected", !attachRoundToDealer({ dealerId: id1.dealerId, round: round1, attributedAt: t0 + 120_000 }).accepted);
const round2 = toTimedRound({ outcome: "2", settledAt: t0 + 240_000, spinId: "d-2" });
check("post-settlement attribution rejected", !attachRoundToDealer({ dealerId: id1.dealerId, round: round2, attributedAt: t0 + 300_000 }).accepted);
const smallDealerSignal = computeDealerSignal({ allRounds: [round1], lockTimestamp: t0 + 250_000, dealerId: id1.dealerId });
check("dealer signal INACTIVE with a small sample", !smallDealerSignal.active && smallDealerSignal.diagnostics.status === "INSUFFICIENT", smallDealerSignal.activeReason);
check("inactive dealer signal returns neutral multipliers (no influence)", OUTCOMES_8.every((o) => smallDealerSignal.multipliers[o] === 1));
const noDealerSignal = computeDealerSignal({ allRounds: [round1], lockTimestamp: t0 + 250_000, dealerId: null });
check("no dealer → inactive neutral signal", !noDealerSignal.active && OUTCOMES_8.every((o) => noDealerSignal.multipliers[o] === 1));
const profileNow = computeDealerSignal({ allRounds: [round1], lockTimestamp: t0 + 250_000, dealerId: id1.dealerId }).profile!;
const regimeSmall = detectDealerRegime(profileNow, [round1], t0 + 250_000);
check("dealer regime gate refuses on a small sample", regimeSmall.status === "INSUFFICIENT_DATA" && !regimeSmall.gate.passed);
const cmp = compareDealerToBaseline(profileNow, [round1], t0 + 250_000);
check("A/B/C/D/E comparison returns all five sets", cmp.comparisons.length === 5);

// ---------------------------------------------------------------------------
// 6. ensemble
// ---------------------------------------------------------------------------
section("ensemble");
__setFlagsForTest({ ...SIGNAL_FLAGS_OFF });
const productionTop4 = ["2", "1", "10", "5"];
const pass = fuseSignals({
  lockTimestamp: lock,
  latestUsedTimestamp: sig.latestUsedTimestamp,
  historyProbabilities: { "1": 0.4, "2": 0.3, "5": 0.15, "10": 0.05, "COIN FLIP": 0.05, PACHINKO: 0.02, "CASH HUNT": 0.02, "CRAZY TIME": 0.01 },
  historyTop4: productionTop4,
  timeSignal: sig,
  dealerSignal: null,
  physicsEvidence: null,
});
check("all flags OFF → PRODUCTION_PASSTHROUGH", pass.passthrough && pass.mode === "PRODUCTION_PASSTHROUGH", pass.mode);
check("passthrough returns the production Top-4 verbatim", JSON.stringify(pass.top4) === JSON.stringify(productionTop4), pass.top4.join(","));
check("passthrough integrity: exactly 4 unique outcomes", pass.integrity.top4Count === 4 && pass.integrity.uniqueTop4);
__setFlagsForTest({ ...SIGNAL_FLAGS_OFF, TIME_SIGNAL: true });
const fused = fuseSignals({
  lockTimestamp: lock,
  latestUsedTimestamp: sig.latestUsedTimestamp,
  historyProbabilities: { "1": 0.4, "2": 0.3, "5": 0.15, "10": 0.05, "COIN FLIP": 0.05, PACHINKO: 0.02, "CASH HUNT": 0.02, "CRAZY TIME": 0.01 },
  historyTop4: productionTop4,
  timeSignal: sig,
  dealerSignal: null,
  physicsEvidence: null,
});
check("time flag ON → fused mode includes TIME", !fused.passthrough && fused.mode.includes("TIME"), fused.mode);
check("fused Top-4 is exactly 4 unique outcomes", fused.top4.length === 4 && new Set(fused.top4).size === 4, fused.top4.join(","));
check("fused probabilities sum to 1", Math.abs(OUTCOMES_8.reduce((s, o) => s + fused.all8Scores[o], 0) - 1) < 1e-6);
check("selection is deterministic across runs", JSON.stringify(selectTop4Dynamic(fused.all8Scores, 4)) === JSON.stringify(fused.top4));
const arms = computeArms({
  lockTimestamp: lock,
  latestUsedTimestamp: sig.latestUsedTimestamp,
  historyProbabilities: { "1": 0.4, "2": 0.3, "5": 0.15, "10": 0.05, "COIN FLIP": 0.05, PACHINKO: 0.02, "CASH HUNT": 0.02, "CRAZY TIME": 0.01 },
  historyTop4: productionTop4,
  timeScores: sig.scores,
  timeActive: true,
  timeConfidence: sig.confidence,
});
check("arm A is the theoretical [1,2,5,10]", JSON.stringify(arms.A_theoretical.top4) === JSON.stringify(["1", "2", "5", "10"]));
check("arm D reports NO REAL DATA instead of a fabricated prediction", !arms.D_dealer.available);
check("arm E reports NO REAL DATA instead of a fabricated prediction", !arms.E_physics.available);
check("arm J (full ensemble) is evaluated with the available channels", arms.J_full.available);
check("arm C (time-only) evaluated when the time signal is active", arms.C_time.available);
__setFlagsForTest({ ...SIGNAL_FLAGS_OFF });

// ---------------------------------------------------------------------------
// 7. feature-flag gate
// ---------------------------------------------------------------------------
section("feature-flag gate");
__setFlagsForTest({ ...SIGNAL_FLAGS_OFF });
check("flags default OFF", Object.values(getSignalFlags()).every((v) => v === false));
check("enabling without a validation outcome is REFUSED", !setSignalFlag("TIME_SIGNAL", true).ok);
check("gate explains the refusal", canPromote("TIME_SIGNAL").reasons.length > 0);
__setFlagsForTest({ ...SIGNAL_FLAGS_OFF, TIME_SIGNAL: true }); // forced-equivalent state for the checks below
check("test override sets the flag for mechanism checks", getSignalFlags().TIME_SIGNAL === true);
__setFlagsForTest({ ...SIGNAL_FLAGS_OFF });

// ---------------------------------------------------------------------------
// 8. validation harness mechanics
// ---------------------------------------------------------------------------
section("validation harness mechanics");
const rows = [
  { roundId: "v1", spinId: "vs1", settledAt: t0, outcome: "1", productionTop4: ["1", "2", "5", "10"] },
  { roundId: "v2", spinId: "vs2", settledAt: t0 + 60_000, outcome: "COIN FLIP", productionTop4: ["1", "2", "5", "10"] },
  { roundId: "v3", spinId: "vs3", settledAt: t0 + 120_000, outcome: "2", productionTop4: ["1", "2", "5", "10"] },
  { roundId: "v4", spinId: "vs4", settledAt: t0 + 180_000, outcome: "CRAZY TIME", productionTop4: ["1", "2", "5", "10"] },
];
const report = runSignalValidation(rows, { dataset: "mechanism-test" });
check("validation harness evaluates every round", report.roundsEvaluated === 4, String(report.roundsEvaluated));
check("validation audits pass on clean input", report.audits.integrity.passed, JSON.stringify(report.audits.integrity.problems));
check("validation refuses promotion on a tiny sample", report.recommendation.promotable.every((p) => !p.allowed));
check("validation report carries the honesty disclaimer", report.disclaimer.includes("DEVELOPMENT TARGET"));
const dupReport = runSignalValidation([rows[0], rows[0], rows[1], rows[2]], { dataset: "duplicate-test" });
check("duplicate rounds are detected by the harness", !dupReport.audits.duplicate.passed, JSON.stringify(dupReport.audits.duplicate.duplicates));

// ---------------------------------------------------------------------------
// 9. live data store + bundle integration (the path the panels use)
// ---------------------------------------------------------------------------
section("live data store + bundle integration");
clearSignalStore();
const r1 = recordSettledRound({ sector: "CoinFlip", settledAt: t0 + 60_000, resultKey: "CoinFlip-1" });
const r2 = recordSettledRound({ sector: "CrazyTime", settledAt: t0 + 120_000, resultKey: "CrazyTime-1" });
const r3 = recordSettledRound({ sector: "CrazyBonus", settledAt: t0 + 180_000, resultKey: "CrazyBonus-1" });
check("real rounds accepted", r1.accepted && r2.accepted && r3.accepted, [r1.reason, r2.reason, r3.reason].join(" | "));
check("duplicate settlement rejected", !recordSettledRound({ sector: "CoinFlip", settledAt: t0 + 60_000, resultKey: "CoinFlip-1" }).accepted);
check("unknown sector rejected (never invented)", !recordSettledRound({ sector: "Nope", settledAt: t0 + 240_000, resultKey: "x" }).accepted);
check("non-epoch timestamp rejected", !recordSettledRound({ sector: "Pachinko", settledAt: 0, resultKey: "y" }).accepted);
check("bonus sector maps to CRAZY TIME", r3.round?.outcome === "CRAZY TIME", String(r3.round?.outcome));
check("CrazyBonus round and CrazyTime round share an outcome (2 CRAZY TIME rounds stored)", getTimedRounds().filter((r) => r.outcome === "CRAZY TIME").length === 2);

// Add enough real-timestamp rounds for the TIME channel to become active (the
// activation floor is a sample-size gate, not a tuning knob).
const SECTORS = ["1", "2", "5", "10", "CoinFlip", "Pachinko", "CashHunt", "CrazyTime"];
for (let i = 0; i < 80; i++) {
  recordSettledRound({
    sector: SECTORS[i % SECTORS.length],
    settledAt: t0 + 60_000 * (i + 4),
    resultKey: `mech-${i}`,
  });
}
check("85 real rounds stored for the activation check", getTimedRounds().length === 83, String(getTimedRounds().length));

const storeLock = t0 + 5_400_000; // after the mechanism rounds above settle
publishProductionPrediction({ top4: ["1", "2", "5", "10"], probabilities: { ...sig.scores }, lockTimestamp: storeLock });
check("production prediction published for the ensemble", getProductionPrediction()?.top4.join(",") === "1,2,5,10");
check("incomplete production prediction rejected", (() => { publishProductionPrediction({ top4: ["1", "2"], probabilities: null }); return getProductionPrediction()?.top4.join(",") === "1,2,5,10"; })());

__setFlagsForTest({ ...SIGNAL_FLAGS_OFF });
const live = buildLiveSignalBundle({
  lockTimestamp: storeLock,
  historyProbabilities: getProductionPrediction()!.probabilities,
  historyTop4: getProductionPrediction()!.top4,
  spinId: "store-spin-1",
  recordPrediction: true,
});
check("flags OFF → live bundle is PRODUCTION_PASSTHROUGH", live.ensemble.passthrough, live.mode);
check("passthrough returns the production Top-4 verbatim", live.ensemble.top4.join(",") === "1,2,5,10");
check("live bundle integrity: ordering ok", live.ensemble.integrity.orderingOk);
check("live bundle latestUsed never exceeds the lock", live.timeSignal.latestUsedTimestamp === null || live.timeSignal.latestUsedTimestamp <= storeLock);
const liveRecord = getPredictionsForTest().filter((p) => p.spinId === "store-spin-1");
check("live prediction record appended and NOT marked shadow", liveRecord.length === 1 && liveRecord[0].shadow === false, JSON.stringify(liveRecord.map((p) => ({ spin: p.spinId, shadow: p.shadow }))));
check("live dossier upserted", getDossiersForTest().some((d) => d.spinId === "store-spin-1"));

const shadow = buildLiveSignalBundle({
  lockTimestamp: storeLock,
  historyProbabilities: getProductionPrediction()!.probabilities,
  historyTop4: getProductionPrediction()!.top4,
  spinId: "store-spin-1-shadow",
  flagsOverride: { ...SIGNAL_FLAGS_OFF, TIME_SIGNAL: true, DEALER_SIGNAL: true, PHYSICS_SIGNAL: true, FUSION: true },
  recordPrediction: true,
});
check("shadow bundle fuses the TIME channel now that the sample supports it", !shadow.ensemble.passthrough && shadow.ensemble.mode.includes("TIME"), shadow.mode);
check("shadow prediction record is explicitly marked SHADOW", getPredictionsForTest().some((p) => p.spinId === "store-spin-1-shadow" && p.shadow === true));
check("shadow mode never flips the real flags", getSignalFlags().TIME_SIGNAL === false && getSignalFlags().FUSION === false);

recordMotionFrame({ spinId: "f1", timestamp: storeLock - 1_000, angle: 10, angleWrapped: 10, velocity: 600, velocityRaw: 610, acceleration: -200, confidence: 0.8, direction: 1, isTracking: true, calibrationStable: true, profDiff: 60 });
const live2 = buildLiveSignalBundle({ lockTimestamp: storeLock, historyProbabilities: getProductionPrediction()!.probabilities, historyTop4: getProductionPrediction()!.top4 });
check("a single real frame is not enough for a physics prediction (refuses rather than invents)", !live2.physicsEvidence.evidence, live2.physicsEvidence.reason);
check("store audit passes on real data", auditSignalStore().rounds.passed && auditSignalStore().timestamps.passed);
__setFlagsForTest({ ...SIGNAL_FLAGS_OFF });


// ---------------------------------------------------------------------------
// 10. LIVE PIPELINE WIRING (direction/speed readout, position, ingest)
// ---------------------------------------------------------------------------
section("live pipeline wiring");

// --- direction readout: measured, never guessed ---------------------------
clearSignalStore();
__setFlagsForTest({ ...SIGNAL_FLAGS_OFF });
const noFrames = rotationReadout([], null);
check("no frames + no sensor → direction UNKNOWN with reason", noFrames.direction === "UNKNOWN" && noFrames.reason.includes("not started"), noFrames.reason);

const idleFrames = Array.from({ length: 12 }, (_, i) => ({
  timestamp: t0 + i * 100,
  angle: 42,
  velocity: 0.4,
  velocityRaw: 0.6,
  acceleration: 0,
  confidence: 0.8,
  direction: 1 as const,
  isTracking: true,
}));
const idle = rotationReadout(idleFrames, null);
check("idle wheel → direction UNKNOWN (no guessed LEFT/RIGHT)", idle.direction === "UNKNOWN" && idle.reason.includes("below the direction threshold"), idle.reason);

const cwFrames = Array.from({ length: 25 }, (_, i) => ({
  timestamp: t0 + i * 100,
  angle: i * 12,             // +120°/s
  velocity: 120,
  velocityRaw: 118,
  acceleration: -5,
  confidence: 0.9,
  direction: 1 as const,
  isTracking: true,
}));
const cw = rotationReadout(cwFrames, null);
check("positive angular motion → RIGHT", cw.direction === "RIGHT", `${cw.direction} ${cw.reason}`);
check("speed readout reflects the measured motion", Math.abs(cw.filteredSpeedDegPerSec - 120) < 1, String(cw.filteredSpeedDegPerSec));
check("direction confidence scales with measured samples", cw.confidence > 0.3, String(cw.confidence));
check("sign convention verified against Δangle", cw.signAgreement === true, String(cw.signAgreement));

const ccwFrames = cwFrames.map((f, i) => ({ ...f, angle: -i * 12, velocity: -120, velocityRaw: -118, direction: -1 as const }));
const ccw = rotationReadout(ccwFrames, null);
check("negative angular motion → LEFT", ccw.direction === "LEFT", `${ccw.direction}`);

// A contradicting sensor sign must be surfaced, not silently trusted.
const contradicting = cwFrames.map((f) => ({ ...f, velocity: -120, velocityRaw: -118 }));
check("contradicting sensor sign is reported (signAgreement=false)", rotationReadout(contradicting, null).signAgreement === false);
check(
  "direction threshold is a real constant (not hardcoded per spin)",
  ROTATION_DIRECTION_MIN_DEG_PER_SEC > 0 && ROTATION_DIRECTION_MIN_DEG_PER_SEC < 50,
  String(ROTATION_DIRECTION_MIN_DEG_PER_SEC),
);

// --- frames feed the physics evidence end-to-end --------------------------
for (const f of cwFrames) recordMotionFrame(f);
const wired = computePhysicsEvidence(getMotionFrames(), { windowMs: 5_000 });
check("stored live frames feed the physics model (evidence VALID)", wired.evidence, wired.reason);
check("physics Top-4 can be formed from real evidence (exactly 4)", Object.entries(wired.outcomeProbabilities).sort((a, b) => b[1] - a[1]).slice(0, 4).length === 4);
check("duplicate frame timestamps are rejected (no double counting)", (() => {
  const before = getMotionFrames().length;
  recordMotionFrame({ ...cwFrames[0] });
  return getMotionFrames().length === before;
})());

// --- ingest from the sensor's own pre-result buffer -----------------------
const ingested = ingestLivePhysicsBuffer(t0 + 300, t0 + 400);
check("live physics buffer ingest runs without a sensor (0 frames, no fabrication)", ingested === 0);
const sync = syncLiveFrames(15_000, t0 + 5_000);
check("syncLiveFrames reports the merged frame count", sync.total >= cwFrames.length, JSON.stringify(sync));

// --- dealer position from frame geometry ----------------------------------
const flat = new Array(12).fill(0.5);
const leftShift = flat.map((v, i) => (i < 4 ? v + 0.4 : v));
const estLeft = estimateDealerPosition({ columns: leftShift, previousColumns: flat, timestamp: t0 });
check("frame change in the left third → LEFT", estLeft.position === "LEFT", `${estLeft.position} ${estLeft.reason}`);
check("position confidence reported", estLeft.confidence > 0, String(estLeft.confidence));
const rightShift = flat.map((v, i) => (i >= 8 ? v + 0.4 : v));
check("frame change in the right third → RIGHT", estimateDealerPosition({ columns: rightShift, previousColumns: flat, timestamp: t0 }).position === "RIGHT");
const centreShift = flat.map((v, i) => (i >= 4 && i < 8 ? v + 0.4 : v));
check("frame change in the middle third → CENTER", estimateDealerPosition({ columns: centreShift, previousColumns: flat, timestamp: t0 }).position === "CENTER");
const spreadShift = flat.map((v, i) => v + 0.1 * ((i % 3) + 1));
const spread = estimateDealerPosition({ columns: spreadShift, previousColumns: flat, timestamp: t0 });
check("diffuse change → position UNKNOWN (never guessed)", spread.position === "UNKNOWN" && spread.reason.includes("spread"), spread.reason);
const noPrev = estimateDealerPosition({ columns: leftShift, previousColumns: null, timestamp: t0 });
check("single frame → position UNKNOWN with the exact reason", noPrev.position === "UNKNOWN" && noPrev.reason.includes("second frame"), noPrev.reason);
const noMotion = estimateDealerPosition({ columns: flat, previousColumns: flat, timestamp: t0 });
check("no frame change → position UNKNOWN (insufficient evidence)", noMotion.position === "UNKNOWN", noMotion.reason);

// observation carries the measured position into the profile
resetDealerProfiles();
const dObs = observeDealer({ timestamp: t0, descriptor: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2], columns: rightShift, previousColumns: flat });
check("dealer observation records the measured position", dObs.position === "RIGHT", `${dObs.position} · ${dObs.positionReason}`);
const profAfter = getDealerProfiles().slice(-1)[0];
check("profile exposes the measured position", profAfter.position.current === "RIGHT" && profAfter.position.counts.RIGHT === 1, JSON.stringify(profAfter.position));
check("profile keeps an UNKNOWN reason when geometry is insufficient", (() => {
  const obs = observeDealer({ timestamp: t0 + 1_000, columns: flat, previousColumns: flat });
  const p2 = getDealerProfiles().slice(-1)[0];
  return obs.position === "UNKNOWN" && typeof p2.position.lastReason === "string" && p2.position.lastReason.length > 0;
})());

// dealer persistence round-trip (session continuity)
const exported = exportDealerProfiles();
resetDealerProfiles();
const restored = importDealerProfiles(JSON.parse(JSON.stringify(exported)));
check("dealer profiles survive a reload (persist round-trip)", restored.restored >= 1, JSON.stringify(restored));
check("restored profile keeps its measured position", getDealerProfiles().some((p) => p.position.current === "RIGHT"));

// --- channel availability is explicit -------------------------------------
const bundle = buildLiveSignalBundle({
  lockTimestamp: Date.now(),
  historyProbabilities: null,
  historyTop4: null,
});
const byKey = Object.fromEntries(bundle.ensemble.channels.map((c) => [c.key, c]));
check("channel status is explicit (READY/INSUFFICIENT) for every channel", bundle.ensemble.channels.every((c) => c.status === "READY" || c.status === "INSUFFICIENT"));
check("theoretical channel is always READY", byKey.theoretical.status === "READY");
check("a channel without data is INSUFFICIENT and carries its reason", byKey.history.status === "INSUFFICIENT" && byKey.history.reason.length > 0, byKey.history.reason);
check("INSUFFICIENT channels carry weight 0 (never counted as zero-quality evidence)", bundle.ensemble.channels.filter((c) => c.status === "INSUFFICIENT").every((c) => c.effectiveWeight === 0));

// --- timestamp contract on the live path ----------------------------------
__setFlagsForTest({ ...SIGNAL_FLAGS_OFF });
const stopTs = Date.now() - 1_000;
const lockTs = Date.now();
const lateBundle = buildLiveSignalBundle({
  lockTimestamp: lockTs,
  historyProbabilities: null,
  historyTop4: null,
  spinId: "late-spin",
  physicalStopTimestamp: stopTs, // stop BEFORE the lock → the lock must be rejected
  recordPrediction: true,
});
const latePred = getPredictionsForTest().filter((p) => p.spinId === "late-spin");
check("a lock taken at/after the physical stop is REJECTED (no post-stop prediction)", latePred.length === 0 && lateBundle.predictionRecord === null);
const okStop = Date.now() + 5_000;
const okBundle = buildLiveSignalBundle({
  lockTimestamp: lockTs,
  historyProbabilities: null,
  historyTop4: null,
  spinId: "ok-spin",
  physicalStopTimestamp: okStop,
  recordPrediction: true,
});
check("a lock before the physical stop is accepted", okBundle.predictionRecord !== null);
check("accepted record satisfies latestUsed ≤ lock < physicalStop", (() => {
  const r = okBundle.predictionRecord!;
  return (r.latestUsedTimestamp === null || r.latestUsedTimestamp <= r.lockTimestamp) && r.lockTimestamp < (r.physicalStopTimestamp ?? Infinity);
})());
check("ledger audit still passes after the live-path checks", auditLedger().leakagePassed && auditLedger().timestampPassed);
check("store audit still passes (no duplicates / no future stamps)", auditSignalStore().rounds.passed && auditSignalStore().timestamps.passed);
__setFlagsForTest({ ...SIGNAL_FLAGS_OFF });

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.log("failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
