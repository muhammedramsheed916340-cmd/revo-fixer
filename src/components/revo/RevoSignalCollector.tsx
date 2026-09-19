"use client";

/**
 * SIGNAL COLLECTOR (ADDITIVE — new component, renders nothing)
 * ===========================================================
 *
 * The ONLY writer of live data into the experimental signal store. It listens
 * to the existing (already deduplicated) live-result bus and the existing
 * video-physics stream and records:
 *
 *   · every REAL settled round with its exact settlement timestamp,
 *   · wheel telemetry frames (throttled) for the physics layer,
 *   · periodic dealer observations from the coarse appearance signature,
 *     identified BEFORE the round settles and attributed to the round before
 *     it settles,
 *   · one PHYSICS DOSSIER per completed physical spin, with the prediction
 *     frozen BEFORE the physical stop (frames used: strictly ≤ lock), and the
 *     actual result attached afterwards from the real result bus.
 *
 * Nothing here can change a production prediction: the only model call it
 * makes passes `flagsOverride` (shadow mode) so the fused output it stores is
 * explicitly labelled SHADOW and every feature flag stays at its real value.
 */

import { useEffect, useRef } from "react";
import { subscribeLiveResults } from "./liveResultsBus";
import { getVideoPhysics, subscribeVideoPhysics, subscribeDealerFrames } from "./RevoVideoSensor";
import {
  attributeRoundToDealer,
  buildLiveSignalBundle,
  getMotionFrames,
  getTimedRounds,
  observeDealer,
  recordMotionFrame,
  recordSpinCompletion,
  recordSettledRound,
} from "./signalDataStore";
import { getCompletedSpins, getPhysicsInRange } from "./videoPhysicsHistory";
import { computePhysicsEvidence, frameFromSensorState } from "./wheelPhysicsLayer";
import { getDossiers, finalizeDossier, upsertDossier } from "./physicsDossier";
import { getSignalFlags, SIGNAL_FLAGS_OFF, type SignalFeatureFlags } from "./signalFlags";
import { LIVE_RESULT_SECTOR_TO_OUTCOME } from "./signalSectorMap";

const FRAME_THROTTLE_MS = 100;     // ≤10 frames/s — plenty for the motion layer
const DEALER_SAMPLE_MS = 15_000;   // one dealer observation every ~15 s
const SHADOW_FLAGS: SignalFeatureFlags = {
  ...SIGNAL_FLAGS_OFF,
  TIME_SIGNAL: true,
  DEALER_SIGNAL: true,
  PHYSICS_SIGNAL: true,
  FUSION: true,
};
/** How long before the physical stop the experimental physics lock is frozen. */
const PHYSICS_LOCK_LEAD_MS = 2_000;

export function RevoSignalCollector() {
  const lastFrameAt = useRef(0);
  const lastDealerAt = useRef(0);
  const dealerId = useRef<string | null>(null);
  const latestGrid = useRef<number[] | null>(null);
  const recordedSpins = useRef<Set<string>>(new Set());

  // ---- coarse appearance frames (captured only while this hook is mounted) --
  useEffect(() => subscribeDealerFrames((grid) => {
    latestGrid.current = grid;
  }), []);

  // ---- settle hooks: real rounds + physics dossier post-mortem --------------
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
        // Attribute the round to the dealer identified BEFORE this settlement.
        attributeRoundToDealer(dealerId.current, recorded.round, e.time);
      }

      // ---- physics dossier for the spin that just ended ----
      const spins = getCompletedSpins();
      const spin = [...spins]
        .reverse()
        .find((s) => s.physicalSpinStop !== null && !recordedSpins.current.has(s.spinId));
      if (!spin || spin.physicalSpinStop === null) return;
      recordedSpins.current.add(spin.spinId);

      const physicalStop = spin.physicalSpinStop;
      const lockTimestamp = physicalStop - PHYSICS_LOCK_LEAD_MS;
      if (lockTimestamp <= (spin.physicalSpinStart ?? 0)) return;

      // Frames used by the prediction: strictly at/before the lock, i.e. never
      // post-stop and never after the result.
      const preLockFrames = getPhysicsInRange(spin.physicalSpinStart ?? lockTimestamp - 8_000, lockTimestamp).map((s) =>
        frameFromSensorState(s as never),
      );
      if (preLockFrames.length === 0) return;

      const evidence = computePhysicsEvidence(preLockFrames, { windowMs: 4_000 });
      if (evidence.evidence) recordSpinCompletion({
        spinId: spin.spinId,
        physicalStopTimestamp: physicalStop,
        deceleration: evidence.diagnostics.deceleration,
        direction: evidence.diagnostics.direction === "LEFT" ? -1 : 1,
      });

      const existing = getDossiers().find((d) => d.spinId === spin.spinId);
      if (!existing) {
        // SHADOW bundle: computed with every experimental signal enabled, so the
        // dossier records what the full ensemble WOULD have predicted at this
        // lock. Real flags are untouched → production behaviour is unchanged.
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

      // Attach the real settled result to the dossier (never a retrospective
      // change to the prediction itself — only the actual column).
      const dossier = getDossiers().find((d) => d.spinId === spin.spinId);
      if (dossier && dossier.hit === null) {
        finalizeDossier(dossier, { outcome, sector: null, resultTimestamp: e.time });
      } else if (!dossier) {
        upsertDossier(spin.spinId, lockTimestamp, {
          physicalStop: physicalStop,
          actualResult: outcome,
          actualResultTimestamp: e.time,
          latestUsedTimestamp: evidence.latestUsedTimestamp,
          direction: evidence.diagnostics.direction,
          velocityAtLock: evidence.diagnostics.speedDegPerSec,
          deceleration: evidence.diagnostics.deceleration,
          motionState: evidence.diagnostics.motionState,
          physicsConfidence: evidence.physicsConfidence,
        });
      }
    });
  }, []);

  // ---- wheel telemetry frames ---------------------------------------------
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      if (now - lastFrameAt.current < FRAME_THROTTLE_MS) return;
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
    const unsubscribe = subscribeVideoPhysics(tick);
    const interval = setInterval(tick, 250);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  // ---- periodic dealer observation (always BEFORE a round settles) ---------
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastDealerAt.current < DEALER_SAMPLE_MS) return;
      lastDealerAt.current = now;
      const physics = getVideoPhysics();
      const obs = observeDealer({
        timestamp: now,
        descriptor: latestGrid.current,
        physics: physics
          ? {
              direction: physics.direction > 0 ? "RIGHT" : physics.direction < 0 ? "LEFT" : "UNKNOWN",
              speed: Math.abs(physics.velocityRaw),
              deceleration: Math.abs(Math.min(0, physics.acceleration)),
            }
          : null,
      });
      dealerId.current = obs.dealerId;
    }, 5_000);
    return () => clearInterval(interval);
  }, []);

  // ---- store/invariant self-check (development visibility only) ------------
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const id = setInterval(() => {
      const rounds = getTimedRounds();
      const dossiers = getDossiers();
      const flags = getSignalFlags();
      if (dossiers.length > 0 && Math.random() < 0.02) {
        // eslint-disable-next-line no-console
        console.debug(
          `[signal-collector] rounds=${rounds.length} frames=${getMotionFrames().length} dossiers=${dossiers.length} ` +
            `flags=${JSON.stringify(flags)} (experimental layers never modify the production prediction)`,
        );
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  return null;
}

export default RevoSignalCollector;
