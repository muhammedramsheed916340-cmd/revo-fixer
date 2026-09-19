"use client";

/**
 * SIGNAL COLLECTOR (ADDITIVE — new component, renders nothing)
 * ===========================================================
 *
 * The bridge between the LIVE production video pipeline and the experimental
 * layers. It performs no modelling of its own and never influences production;
 * it only copies REAL live values into the signal store and triggers the
 * diagnostic model calls (always with `flagsOverride`, i.e. shadow mode).
 *
 * What it wires, in the order the task requires:
 *
 *   LIVE HLS → RevoVideoSensor (existing)
 *     → coarse frame luma + COLUMN grid  → dealer position (frame thirds)
 *     → currentPhysics telemetry         → signalDataStore motion frames
 *     → the sensor's own pre-result snapshot buffer → ingestLivePhysicsBuffer()
 *     → wheelPhysicsLayer evidence       → physics dossier (pre-lock frames only)
 *     → dealerSignal                     → dealer profile (persisted across reloads)
 *     → live result bus                  → settled rounds → time signal
 *     → signalEnsemble                   → shadow Top-4 + all-8 (never production)
 *
 * HARD RULES PRESERVED
 *   · no fabricated rounds, dealers, directions, speeds or predictions;
 *   · physics evidence is computed ONLY from frames with `timestamp ≤ lock`;
 *   · dealer observations are recorded BEFORE the round they are attributed to;
 *   · every model call is shadow (feature flags are untouched).
 */

import { useEffect, useRef } from "react";
import { subscribeLiveResults } from "./liveResultsBus";
import {
  getSensorRuntime,
  getVideoPhysics,
  subscribeDealerFrames,
  subscribeDealerRegionFrames,
  subscribeVideoPhysics,
} from "./RevoVideoSensor";
import {
  attributeRoundToDealer,
  buildLiveSignalBundle,
  getMotionFrames,
  observeDealer,
  recordMotionFrame,
  recordSettledRound,
  recordSpinCompletion,
  restoreDealerProfiles,
  syncLiveFrames,
} from "./signalDataStore";
import { getCompletedSpins, getPhysicsInRange } from "./videoPhysicsHistory";
import { computePhysicsEvidence, frameFromSensorState } from "./wheelPhysicsLayer";
import { finalizeDossier, getDossiers, upsertDossier } from "./physicsDossier";
import { SIGNAL_FLAGS_OFF, type SignalFeatureFlags } from "./signalFlags";
import { LIVE_RESULT_SECTOR_TO_OUTCOME } from "./signalSectorMap";

const FRAME_THROTTLE_MS = 100;     // ≤10 stored frames/s — plenty for the motion layer
const DEALER_SAMPLE_MS = 10_000;   // one dealer/position observation every ~10 s
const LIVE_SYNC_MS = 3_000;        // pull the sensor's own pre-result buffer this often
const LIVE_SYNC_WINDOW_MS = 20_000;
/** How long before the physical stop the experimental physics lock is frozen. */
const PHYSICS_LOCK_LEAD_MS = 2_000;

const SHADOW_FLAGS: SignalFeatureFlags = {
  ...SIGNAL_FLAGS_OFF,
  TIME_SIGNAL: true,
  DEALER_SIGNAL: true,
  PHYSICS_SIGNAL: true,
  FUSION: true,
};

export function RevoSignalCollector() {
  const lastFrameAt = useRef(0);
  const lastDealerAt = useRef(0);
  const dealerId = useRef<string | null>(null);
  const latestLuma = useRef<number[] | null>(null);
  const latestColumns = useRef<number[] | null>(null);
  const previousColumns = useRef<number[] | null>(null);
  const recordedSpins = useRef<Set<string>>(new Set());

  // ---- coarse appearance frames (only captured while this hook is mounted) --
  useEffect(() => subscribeDealerFrames((luma) => {
    latestLuma.current = luma;
  }), []);

  // ---- coarse column grid → dealer position geometry -----------------------
  useEffect(() => subscribeDealerRegionFrames((sample) => {
    latestLuma.current = sample.luma;
    if (latestColumns.current) previousColumns.current = latestColumns.current;
    latestColumns.current = sample.columns;
  }), []);

  // ---- restore persisted dealer profiles once (session continuity) ---------
  useEffect(() => {
    restoreDealerProfiles();
  }, []);

  // ---- real settled rounds + one physics dossier per completed spin --------
  useEffect(() => {
    return subscribeLiveResults((e) => {
      const outcome = LIVE_RESULT_SECTOR_TO_OUTCOME[e.sector];
      if (!outcome) return;

      const recorded = recordSettledRound({
        sector: e.sector,
        settledAt: e.time,
        resultKey: `${e.sector}-${e.time}`,
        multiplier: e.multiplier,
        source: "live-api",
      });
      if (recorded.accepted && recorded.round && dealerId.current) {
        // Attribution uses only the dealer identified BEFORE this settlement.
        attributeRoundToDealer(dealerId.current, recorded.round, e.time);
      }

      // ---- physics dossier for the spin that just ended ----
      const spin = [...getCompletedSpins()]
        .reverse()
        .find((s) => s.physicalSpinStop !== null && !recordedSpins.current.has(s.spinId));
      if (!spin || spin.physicalSpinStop === null) return;
      recordedSpins.current.add(spin.spinId);

      const physicalStop = spin.physicalSpinStop;
      const lockTimestamp = physicalStop - PHYSICS_LOCK_LEAD_MS;
      const start = spin.physicalSpinStart ?? lockTimestamp - 8_000;
      if (lockTimestamp <= start) return;

      // Pull anything the sensor buffered that the collector had not stored yet,
      // then take ONLY frames at/before the lock (never post-stop, never future).
      syncLiveFrames(LIVE_SYNC_WINDOW_MS);
      let preLockFrames = getMotionFrames().filter((f) => f.timestamp > start && f.timestamp <= lockTimestamp);
      if (preLockFrames.length === 0) {
        // Fall back to the sensor's own buffer for this exact range (same rule).
        preLockFrames = getPhysicsInRange(start, lockTimestamp).map((snap) =>
          frameFromSensorState({
            timestamp: snap.timestamp,
            angle: snap.angle,
            velocity: snap.velocity,
            velocityRaw: snap.velocityRaw,
            acceleration: snap.acceleration,
            confidence: snap.confidence,
            direction: snap.direction,
            isTracking: snap.isTracking,
            calibrationStable: snap.calibrationStable,
            profDiff: snap.profDiff,
            signalAgreement: snap.signalAgreement,
          } as never),
        );
      }
      if (preLockFrames.length === 0) return;

      const evidence = computePhysicsEvidence(preLockFrames, { windowMs: 4_000 });
      if (evidence.evidence) {
        recordSpinCompletion({
          spinId: spin.spinId,
          physicalStopTimestamp: physicalStop,
          deceleration: evidence.diagnostics.deceleration,
          direction: evidence.diagnostics.direction === "LEFT" ? -1 : 1,
        });
      }

      const exists = getDossiers().some((d) => d.spinId === spin.spinId);
      if (!exists) {
        // SHADOW bundle: every experimental signal forced ON so the dossier
        // records what the full ensemble WOULD have produced at this lock.
        buildLiveSignalBundle({
          lockTimestamp,
          historyProbabilities: null,
          historyTop4: null,
          dealerId: dealerId.current,
          physicalStopTimestamp: physicalStop,
          actualResultTimestamp: e.time,
          actualResult: outcome,
          spinId: spin.spinId,
          flagsOverride: SHADOW_FLAGS,
          recordPrediction: true,
        });
      }

      // Attach the settled result to the dossier (only the actual column).
      const dossier = getDossiers().find((d) => d.spinId === spin.spinId);
      if (dossier && dossier.hit === null) {
        finalizeDossier(dossier, { outcome, sector: null, resultTimestamp: e.time });
      } else if (!dossier) {
        upsertDossier(spin.spinId, lockTimestamp, {
          physicalStart: start,
          physicalStop,
          actualResult: outcome,
          actualResultTimestamp: e.time,
          latestUsedTimestamp: evidence.latestUsedTimestamp,
          direction: evidence.diagnostics.direction,
          velocityAtLock: evidence.diagnostics.speedDegPerSec,
          peakVelocity: evidence.diagnostics.peakSpeed,
          deceleration: evidence.diagnostics.deceleration,
          motionState: evidence.diagnostics.motionState,
          physicsConfidence: evidence.physicsConfidence,
          notes: ["Dossier written without a shadow record (no pre-lock frames available for the model)."],
        });
      }
    });
  }, []);

  // ---- wheel telemetry → motion frames (frame-driven + poll safety net) ----
  useEffect(() => {
    const tick = (force = false) => {
      const now = Date.now();
      if (!force && now - lastFrameAt.current < FRAME_THROTTLE_MS) return;
      lastFrameAt.current = now;
      const p = getVideoPhysics();
      if (!p) return;
      recordMotionFrame(
        frameFromSensorState({
          timestamp: p.timestamp,
          angle: p.angle,
          angleWrapped: p.angleWrapped,
          velocity: p.velocity,
          velocityRaw: p.velocityRaw,
          acceleration: p.acceleration,
          confidence: p.confidence,
          direction: p.direction,
          isTracking: p.isTracking,
          calibrationStable: p.calibrationStable,
          sectorIndex: p.sectorIndex,
          sectorEstimate: p.sectorEstimate,
          signalA: p.signalA,
          signalB: p.signalB,
          signalAgreement: p.signalAgreement,
          profDiff: p.profDiff,
        }),
      );
    };
    const unsubscribe = subscribeVideoPhysics(() => tick(false));
    const interval = setInterval(() => tick(true), 250);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  // ---- keep the store in sync with the sensor's live pre-result buffer -----
  useEffect(() => {
    const interval = setInterval(() => {
      syncLiveFrames(LIVE_SYNC_WINDOW_MS);
    }, LIVE_SYNC_MS);
    return () => clearInterval(interval);
  }, []);

  // ---- dealer observation (BEFORE any round settles) + measured position ---
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastDealerAt.current < DEALER_SAMPLE_MS) return;
      lastDealerAt.current = now;
      const physics = getVideoPhysics();
      const runtime = getSensorRuntime();
      const obs = observeDealer({
        timestamp: now,
        descriptor: latestLuma.current,
        columns: latestColumns.current,
        previousColumns: previousColumns.current,
        physics: physics
          ? {
              direction: runtime.directionLabel,
              speed: Math.abs(physics.velocityRaw),
              deceleration: Math.abs(Math.min(0, physics.acceleration)),
            }
          : null,
      });
      dealerId.current = obs.dealerId;
    }, 2_000);
    return () => clearInterval(interval);
  }, []);

  return null;
}

export default RevoSignalCollector;
