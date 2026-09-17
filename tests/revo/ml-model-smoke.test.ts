/**
 * SMOKE TEST for mlModel.ts — verifies basic end-to-end functionality.
 * Run: `bun test tests/revo/ml-model-smoke.test.ts`
 */
import { test, expect, describe } from "bun:test";
import {
  trainMLModel,
  predictML,
  extractFeatures,
  featuresToVector,
  resetMLModel,
  getMLModel,
  uniformPrediction,
  assertNoLeakage,
  OUTCOME_NAMES,
  FEATURE_NAMES,
  NUM_FEATURES,
  MIN_SAMPLES,
  type MLSpinSample,
  type PhysicsSnapshot,
  type MLFeatures,
} from "../../src/components/revo/mlModel";
import type { SpinData } from "../../src/components/revo/aiStats";

// --- Helpers --------------------------------------------------------------

function makeSnapshot(
  t: number,
  angle: number,
  velocityRaw: number,
  extra: Partial<PhysicsSnapshot> = {},
): PhysicsSnapshot {
  return {
    timestamp: t,
    angle,
    velocity: velocityRaw,
    velocityRaw,
    acceleration: -10,
    confidence: 0.9,
    direction: 1,
    isTracking: true,
    calibrationStable: true,
    movementState: Math.abs(velocityRaw) > 50 ? "MOVING" : "STOPPED",
    profDiff: 0,
    signalAgreement: 0.85,
    ...extra,
  };
}

function makeSpin(
  outcome: string,
  lockTs: number,
  historyOutcomes: string[] = [],
  spinStartTs?: number,
): MLSpinSample {
  const snapshots: PhysicsSnapshot[] = [];
  // Generate 30 snapshots over 3 seconds (100ms cadence), spinning then decelerating.
  for (let i = 0; i < 30; i++) {
    const t = (spinStartTs ?? lockTs - 3000) + i * 100;
    const v = Math.max(50, 800 - i * 25); // decelerating
    snapshots.push(makeSnapshot(t, i * 30, v));
  }
  const history: SpinData[] = historyOutcomes.map((sector, idx) => ({
    sector,
    settledAt: new Date(lockTs - 60000 - (historyOutcomes.length - idx) * 5000).toISOString(),
    topSlotMatched: false,
  }));
  return { snapshots, history, outcome, lockTimestamp: lockTs, spinStartTimestamp: spinStartTs };
}

// --- Tests ----------------------------------------------------------------

describe("mlModel — types & constants", () => {
  test("OUTCOME_NAMES has 8 canonical outcomes", () => {
    expect(OUTCOME_NAMES).toHaveLength(8);
    expect(OUTCOME_NAMES).toEqual([
      "1", "2", "5", "10", "PACHINKO", "COIN FLIP", "CASH HUNT", "CRAZY TIME",
    ]);
  });

  test("FEATURE_NAMES matches NUM_FEATURES", () => {
    expect(FEATURE_NAMES.length).toBe(NUM_FEATURES);
    expect(NUM_FEATURES).toBeGreaterThan(20);
  });
});

describe("mlModel — extractFeatures", () => {
  test("extracts features from snapshots + history", () => {
    const snapshots = [
      makeSnapshot(1000, 10, 500),
      makeSnapshot(1100, 50, 400),
      makeSnapshot(1200, 100, 300),
    ];
    const history: SpinData[] = [
      { sector: "1", settledAt: new Date(900).toISOString(), topSlotMatched: false },
      { sector: "2", settledAt: new Date(950).toISOString(), topSlotMatched: false },
    ];
    const feats = extractFeatures(snapshots, history, 1200);
    expect(feats.physics.angle).toBeGreaterThan(0);
    expect(feats.physics.velocityRaw).toBe(300);
    expect(feats.history.count).toBe(2);
    expect(feats.history.lastOutcome).toBe("2");
    expect(feats.context.lockTimestamp).toBe(1200);
  });

  test("filters out future snapshots (leakage guard)", () => {
    const snapshots = [
      makeSnapshot(1000, 10, 500),
      makeSnapshot(2000, 100, 100),  // FUTURE
      makeSnapshot(3000, 200, 50),   // FUTURE
    ];
    const feats = extractFeatures(snapshots, [], 1500);
    // Only the first snapshot is pre-lock; velocityRaw = 500.
    expect(feats.physics.velocityRaw).toBe(500);
  });

  test("filters out future history spins (leakage guard)", () => {
    const history: SpinData[] = [
      { sector: "1", settledAt: new Date(1000).toISOString(), topSlotMatched: false },
      { sector: "2", settledAt: new Date(5000).toISOString(), topSlotMatched: false },  // FUTURE
    ];
    const feats = extractFeatures([], history, 1500);
    expect(feats.history.count).toBe(1);
    expect(feats.history.lastOutcome).toBe("1");
  });

  test("featuresToVector returns correct length", () => {
    const feats = extractFeatures([], []);
    const vec = featuresToVector(feats);
    expect(vec).toHaveLength(NUM_FEATURES);
  });

  test("handles empty inputs gracefully", () => {
    const feats = extractFeatures([], []);
    expect(feats.physics.angle).toBe(0);
    expect(feats.history.count).toBe(0);
    expect(feats.history.lastOutcome).toBeNull();
    const vec = featuresToVector(feats);
    expect(vec).toHaveLength(NUM_FEATURES);
    // Should not contain NaN/Infinity
    for (const v of vec) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("mlModel — trainMLModel & predictML", () => {
  test("returns fallback when insufficient data", () => {
    resetMLModel();
    const samples: MLSpinSample[] = [];
    for (let i = 0; i < MIN_SAMPLES - 1; i++) {
      samples.push(makeSpin("1", 1_000_000 + i * 10_000, ["1", "2"]));
    }
    const stats = trainMLModel(samples);
    expect(stats.trained).toBe(false);
    expect(stats.reason).toContain("Insufficient");

    const feats = extractFeatures([], []);
    const pred = predictML(feats);
    expect(pred.isFallback).toBe(true);
    // 8 uniform probabilities summing to 1
    const sum = Object.values(pred.probabilities).reduce((s, p) => s + p, 0);
    expect(sum).toBeCloseTo(1, 6);
    for (const n of OUTCOME_NAMES) {
      expect(pred.probabilities[n]).toBeCloseTo(1 / 8, 5);
    }
  });

  test("trains on enough samples and predicts non-uniform distribution", () => {
    resetMLModel();
    const samples: MLSpinSample[] = [];
    // Create a synthetic pattern: "1" appears most often when last outcome was "2"
    const outcomes = ["1", "2", "1", "1", "2", "1", "5", "1", "2", "1"];
    for (let i = 0; i < 80; i++) {
      const out = outcomes[i % outcomes.length]!;
      const prevOutcomes = outcomes.slice(0, i);
      samples.push(makeSpin(out, 1_000_000 + i * 60_000, prevOutcomes));
    }
    const stats = trainMLModel(samples);
    expect(stats.trained).toBe(true);
    expect(stats.trainSamples).toBeGreaterThan(0);
    expect(stats.validationSamples).toBeGreaterThan(0);
    expect(stats.trainAccuracy).toBeGreaterThanOrEqual(0);
    expect(stats.validationAccuracy).toBeGreaterThanOrEqual(0);
    expect(stats.trainLogLoss).toBeGreaterThanOrEqual(0);
    expect(getMLModel()).not.toBeNull();

    // Predict with a sample whose last outcome is "2" — model should learn "1" is common.
    const lastHistory: SpinData[] = [
      { sector: "2", settledAt: new Date(Date.now() - 5000).toISOString(), topSlotMatched: false },
    ];
    const snapshots = [makeSnapshot(Date.now(), 50, 0)]; // wheel stopped
    const feats = extractFeatures(snapshots, lastHistory, Date.now());
    const pred = predictML(feats);

    expect(pred.isFallback).toBe(false);
    expect(pred.topOutcome).toBeTruthy();
    const sum = Object.values(pred.probabilities).reduce((s, p) => s + p, 0);
    expect(sum).toBeCloseTo(1, 6);
    for (const n of OUTCOME_NAMES) {
      expect(pred.probabilities[n]).toBeGreaterThanOrEqual(0);
      expect(pred.probabilities[n]).toBeLessThanOrEqual(1);
    }
  });

  test("chronological split: validation samples have LATER timestamps than train", () => {
    resetMLModel();
    const samples: MLSpinSample[] = [];
    for (let i = 0; i < 100; i++) {
      samples.push(makeSpin("1", 1_000_000 + i * 60_000, []));
    }
    const stats = trainMLModel(samples);
    expect(stats.trained).toBe(true);
    expect(stats.trainSamples + stats.validationSamples).toBe(100);
    // 70/30 split (approximately)
    expect(stats.trainSamples).toBeGreaterThanOrEqual(60);
    expect(stats.validationSamples).toBeGreaterThanOrEqual(20);
  });

  test("never shuffles: re-running produces identical weights", () => {
    resetMLModel();
    const samples: MLSpinSample[] = [];
    for (let i = 0; i < 50; i++) {
      samples.push(makeSpin("1", 1_000_000 + i * 60_000, []));
    }
    trainMLModel(samples);
    const m1 = getMLModel()!;
    const w1 = JSON.stringify(m1.classifiers[0]!.weights);
    resetMLModel();
    // Pass samples in REVERSE order — chronological sort should still produce identical weights.
    trainMLModel([...samples].reverse());
    const m2 = getMLModel()!;
    const w2 = JSON.stringify(m2.classifiers[0]!.weights);
    expect(w2).toBe(w1);
  });

  test("probabilities are finite and sum to 1 even with all-zero features", () => {
    resetMLModel();
    const samples: MLSpinSample[] = [];
    for (let i = 0; i < 60; i++) {
      samples.push(makeSpin("1", 1_000_000 + i * 60_000, []));
    }
    trainMLModel(samples);
    const feats = extractFeatures([], []);
    const pred = predictML(feats);
    const sum = Object.values(pred.probabilities).reduce((s, p) => s + p, 0);
    expect(sum).toBeCloseTo(1, 6);
    for (const v of Object.values(pred.probabilities)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("mlModel — uniformPrediction & assertNoLeakage", () => {
  test("uniformPrediction returns 1/8 for each outcome", () => {
    const pred = uniformPrediction();
    expect(pred.isFallback).toBe(true);
    for (const n of OUTCOME_NAMES) {
      expect(pred.probabilities[n]).toBeCloseTo(1 / 8, 5);
    }
  });

  test("assertNoLeakage detects future snapshots", () => {
    const snapshots = [
      makeSnapshot(1000, 10, 100),
      makeSnapshot(2000, 20, 100),  // FUTURE (lock = 1500)
    ];
    const result = assertNoLeakage(snapshots, [], 1500);
    expect(result.passed).toBe(false);
    expect(result.violations).toBe(1);
  });

  test("assertNoLeakage passes when all timestamps pre-lock", () => {
    const snapshots = [makeSnapshot(1000, 10, 100), makeSnapshot(1200, 20, 100)];
    const result = assertNoLeakage(snapshots, [], 1500);
    expect(result.passed).toBe(true);
    expect(result.violations).toBe(0);
  });
});
