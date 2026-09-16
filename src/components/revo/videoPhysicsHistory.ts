/**
 * VIDEO PHYSICS HISTORY COLLECTOR V2.1
 * =====================================
 *
 * Collects chronological video physics snapshots for the Fusion V2 experiment.
 *
 * CRITICAL FIX (V2.1): A spin is NOT classified as INSUFFICIENT just because
 * the wheel is stopped at T-20. The wheel can start moving after T-20. We now
 * evaluate the ENTIRE window [lockPoint, T] for movement, not just the
 * snapshot at the lock point timestamp.
 *
 * Each lock point stores:
 *   - The physics snapshot at that timestamp (for angle/velocity at lock)
 *   - Whether movement was detected in [lockPoint, T] (the full window)
 *   - The movement state (STOPPED / MOVING / UNKNOWN)
 *
 * This preserves the complete pre-result window and correctly identifies spins
 * where movement begins after T-20.
 */

import type { WheelPhysicsState } from "./RevoVideoSensor";

export type MovementState = "STOPPED" | "MOVING" | "UNKNOWN";

export interface PhysicsSnapshot {
  timestamp: number; // ms epoch (when the snapshot was taken)
  angle: number; // unwrapped, continuous (degrees)
  velocity: number; // deg/s (filtered)
  acceleration: number; // deg/s²
  confidence: number; // 0..1 (tracking confidence)
  direction: 1 | -1;
  isTracking: boolean;
  calibrationStable: boolean;
  movementState: MovementState;
}

export interface LockPointState {
  lockTimestamp: number; // ms epoch
  lockLabel: string; // "T-20", "T-15", etc.
  physics: PhysicsSnapshot | null; // latest physics at or before lock
  videoValid: boolean; // TRUE if movement exists in [lock, T]
  videoReason: string;
  // Window analysis: movement in [lock, T]
  windowHasMovement: boolean;
  windowMovementStart: number | null; // ms epoch when movement began (null = never)
  windowMaxVelocity: number; // max |velocity| in the window
  windowTrackingCount: number; // frames with isTracking=true in window
  windowTotalFrames: number; // total frames in window
}

export interface SynchronizedSpin {
  spinId: string; // settledAt as unique ID
  resultTimestamp: number; // ms epoch (settledAt)
  actualOutcome: string;
  actualSector: number | null;
  // Physics snapshots available BEFORE this result (strictly pre-result)
  physicsHistory: PhysicsSnapshot[];
  // Complete window telemetry [T-60, T] for reproduction
  fullWindow: PhysicsSnapshot[];
  // Lock-point states (computed from pre-result physics)
  lockPoints: {
    "T-20": LockPointState | null;
    "T-15": LockPointState | null;
    "T-10": LockPointState | null;
    "T-5": LockPointState | null;
  };
  // Timing metadata
  apiReceivedAt: number; // when the API delivered this result
  resultToApiDelay: number; // resultTimestamp → apiReceivedAt (ms)
}

// Ring buffer of recent physics snapshots (max 5 minutes = 300s at ~20fps = 6000)
const MAX_SNAPSHOTS = 6000;
let snapshotBuffer: PhysicsSnapshot[] = [];
const bufferListeners = new Set<() => void>();

// Completed synchronized spins (for experiment)
let synchronizedSpins: SynchronizedSpin[] = [];
const MAX_SYNCHRONIZED = 500;

// Sector-map observations (from stopped-wheel results)
interface SectorObservation {
  outcome: string;
  sectorIndex: number | null;
  angle: number | null; // wheel angle when stopped
  timestamp: number;
  spinId: string;
}
let sectorObservations: SectorObservation[] = [];

/**
 * Determine movement state from a physics snapshot.
 * - STOPPED: velocity < 5°/s (wheel not rotating)
 * - MOVING: velocity >= 5°/s AND isTracking (wheel rotating)
 * - UNKNOWN: not tracking or confidence too low
 */
function classifyMovement(physics: {
  velocity: number;
  isTracking: boolean;
  confidence: number;
}): MovementState {
  if (!physics.isTracking || physics.confidence < 0.1) return "UNKNOWN";
  return Math.abs(physics.velocity) >= 5 ? "MOVING" : "STOPPED";
}

/**
 * Record a physics snapshot. Called from the video sensor's frame loop.
 * Stores ALL snapshots (including stopped-wheel) so we can analyze the
 * complete pre-result window.
 */
export function recordPhysicsSnapshot(physics: WheelPhysicsState): void {
  const movementState = classifyMovement(physics);
  const snapshot: PhysicsSnapshot = {
    timestamp: physics.timestamp * 1000, // convert s→ms
    angle: physics.angle,
    velocity: physics.velocity,
    acceleration: physics.acceleration,
    confidence: physics.confidence,
    direction: physics.direction,
    isTracking: physics.isTracking,
    calibrationStable: physics.calibrationStable,
    movementState,
  };

  snapshotBuffer.push(snapshot);
  if (snapshotBuffer.length > MAX_SNAPSHOTS) {
    snapshotBuffer.shift();
  }

  bufferListeners.forEach((l) => l());
}

/**
 * Get all physics snapshots in a time range [fromMs, toMs].
 */
export function getPhysicsInRange(
  fromMs: number,
  toMs: number,
): PhysicsSnapshot[] {
  return snapshotBuffer.filter(
    (s) => s.timestamp >= fromMs && s.timestamp <= toMs,
  );
}

/**
 * Get the latest physics snapshot at or before the given timestamp.
 */
export function getPhysicsAt(timestampMs: number): PhysicsSnapshot | null {
  let result: PhysicsSnapshot | null = null;
  for (let i = snapshotBuffer.length - 1; i >= 0; i--) {
    if (snapshotBuffer[i].timestamp <= timestampMs) {
      result = snapshotBuffer[i];
      break;
    }
  }
  return result;
}

/**
 * Analyze a window [lockTs, resultTs] for movement.
 * Returns whether movement was detected, when it started, max velocity, etc.
 */
function analyzeWindow(
  lockTs: number,
  resultTs: number,
): {
  hasMovement: boolean;
  movementStart: number | null;
  maxVelocity: number;
  trackingCount: number;
  totalFrames: number;
} {
  const window = getPhysicsInRange(lockTs, resultTs);
  let hasMovement = false;
  let movementStart: number | null = null;
  let maxVelocity = 0;
  let trackingCount = 0;

  for (const snap of window) {
    if (snap.movementState === "MOVING") {
      if (!hasMovement) {
        movementStart = snap.timestamp;
      }
      hasMovement = true;
    }
    if (snap.isTracking) trackingCount++;
    const absVel = Math.abs(snap.velocity);
    if (absVel > maxVelocity) maxVelocity = absVel;
  }

  return {
    hasMovement,
    movementStart,
    maxVelocity,
    trackingCount,
    totalFrames: window.length,
  };
}

/**
 * Record a synchronized spin: pairs a live result with its pre-result
 * physics history at T-20, T-15, T-10, T-5 lock points.
 *
 * V2.1 FIX: A lock point is VALID if there's movement in [lock, T],
 * NOT just if the wheel is moving at the exact lock timestamp.
 * The wheel can start moving after T-20.
 */
export function recordSynchronizedSpin(
  spinId: string,
  resultTimestamp: number,
  actualOutcome: string,
  actualSector: number | null,
): SynchronizedSpin {
  const apiReceivedAt = Date.now();
  const resultToApiDelay = apiReceivedAt - resultTimestamp;

  // Extract pre-result physics for each lock point
  const lockOffsets: { label: string; offsetMs: number }[] = [
    { label: "T-20", offsetMs: 20000 },
    { label: "T-15", offsetMs: 15000 },
    { label: "T-10", offsetMs: 10000 },
    { label: "T-5", offsetMs: 5000 },
  ];

  const lockPoints: SynchronizedSpin["lockPoints"] = {
    "T-20": null,
    "T-15": null,
    "T-10": null,
    "T-5": null,
  };

  for (const { label, offsetMs } of lockOffsets) {
    const lockTs = resultTimestamp - offsetMs;
    const physics = getPhysicsAt(lockTs);

    // Analyze the FULL window [lockTs, resultTs] for movement
    const windowAnalysis = analyzeWindow(lockTs, resultTimestamp);

    // V2.1: A lock point is VALID if:
    //   1. Physics exists at the lock timestamp (we have a frame), AND
    //   2. Movement was detected in the window [lockTs, resultTs]
    // This allows the wheel to be stopped at T-20 but start moving at T-16.
    const hasFrame = physics !== null;
    const windowHasMovement = windowAnalysis.hasMovement;
    const videoValid = hasFrame && windowHasMovement;

    let videoReason: string;
    if (!hasFrame) {
      videoReason = "No video frame at lock point";
    } else if (!windowHasMovement) {
      videoReason = `No movement in [${label}, T] (wheel stopped throughout)`;
    } else {
      videoReason = `Valid — movement at ${windowAnalysis.movementStart ? new Date(windowAnalysis.movementStart).toLocaleTimeString() : "?"}, max v=${windowAnalysis.maxVelocity.toFixed(0)}°/s, ${windowAnalysis.trackingCount}/${windowAnalysis.totalFrames} tracking frames`;
    }

    lockPoints[label as keyof typeof lockPoints] = {
      lockTimestamp: lockTs,
      lockLabel: label,
      physics,
      videoValid,
      videoReason,
      windowHasMovement,
      windowMovementStart: windowAnalysis.movementStart,
      windowMaxVelocity: windowAnalysis.maxVelocity,
      windowTrackingCount: windowAnalysis.trackingCount,
      windowTotalFrames: windowAnalysis.totalFrames,
    };
  }

  // Collect the full window [T-60, T] for reproduction
  const fullWindow = getPhysicsInRange(resultTimestamp - 60000, resultTimestamp);

  // Also collect the pre-result physics history
  const physicsHistory = getPhysicsInRange(
    resultTimestamp - 60000,
    resultTimestamp,
  );

  const spin: SynchronizedSpin = {
    spinId,
    resultTimestamp,
    actualOutcome,
    actualSector,
    physicsHistory,
    fullWindow,
    lockPoints,
    apiReceivedAt,
    resultToApiDelay,
  };

  // Add to synchronized spins (dedupe by spinId)
  const existingIdx = synchronizedSpins.findIndex((s) => s.spinId === spinId);
  if (existingIdx >= 0) {
    synchronizedSpins[existingIdx] = spin;
  } else {
    synchronizedSpins.push(spin);
    if (synchronizedSpins.length > MAX_SYNCHRONIZED) {
      synchronizedSpins.shift();
    }
  }

  // Record sector observation for sector-map validation
  if (actualSector !== null) {
    // Find the physics snapshot closest to the result time (stopped wheel)
    const stoppedPhysics = getPhysicsAt(resultTimestamp);
    sectorObservations.push({
      outcome: actualOutcome,
      sectorIndex: actualSector,
      angle: stoppedPhysics?.angle ?? null,
      timestamp: resultTimestamp,
      spinId,
    });
    if (sectorObservations.length > 200) sectorObservations.shift();
  }

  return spin;
}

/**
 * Get all synchronized spins (for experiment).
 */
export function getSynchronizedSpins(): SynchronizedSpin[] {
  return synchronizedSpins;
}

export function getSynchronizedCount(): number {
  return synchronizedSpins.length;
}

export function getBufferSize(): number {
  return snapshotBuffer.length;
}

/**
 * Get buffer statistics (for UI display).
 */
export function getBufferStats(): {
  totalSnapshots: number;
  trackingSnapshots: number;
  movingSnapshots: number;
  validVideoSpins: number;
  timeSpanSeconds: number;
} {
  const trackingSnapshots = snapshotBuffer.filter((s) => s.isTracking).length;
  const movingSnapshots = snapshotBuffer.filter(
    (s) => s.movementState === "MOVING",
  ).length;
  const validVideoSpins = synchronizedSpins.filter((spin) =>
    Object.values(spin.lockPoints).some((lp) => lp?.videoValid),
  ).length;

  const timeSpan =
    snapshotBuffer.length > 1
      ? (snapshotBuffer[snapshotBuffer.length - 1].timestamp -
          snapshotBuffer[0].timestamp) /
        1000
      : 0;

  return {
    totalSnapshots: snapshotBuffer.length,
    trackingSnapshots,
    movingSnapshots,
    validVideoSpins,
    timeSpanSeconds: timeSpan,
  };
}

/**
 * Get comprehensive statistics about the collected data.
 */
export function getDataQualityReport(): {
  totalSpins: number;
  spinsWithAnyVideo: number; // spins with at least 1 valid lock point
  spinsWithMovement: number; // spins where movement was detected in any window
  lockPointCoverage: {
    "T-20": { valid: number; total: number; pct: number };
    "T-15": { valid: number; total: number; pct: number };
    "T-10": { valid: number; total: number; pct: number };
    "T-5": { valid: number; total: number; pct: number };
  };
  movingSpinCount: number; // spins with movement before T (any lock point)
  trackingQuality: {
    totalSnapshots: number;
    trackingSnapshots: number;
    movingSnapshots: number;
    trackingRate: number;
  };
  calibrationQuality: {
    stableCount: number;
    totalCount: number;
    stabilityRate: number;
  };
  directionConsistency: number; // 0..1
  timingSync: {
    avgResultToApiDelay: number;
    maxResultToApiDelay: number;
    minResultToApiDelay: number;
  };
  insufficientCount: number; // spins with ALL lock points INSUFFICIENT
  sectorMapStatus: {
    totalObservations: number;
    uniqueOutcomes: number;
    confident: boolean;
  };
} {
  const totalSpins = synchronizedSpins.length;
  const lockLabels = ["T-20", "T-15", "T-10", "T-5"] as const;

  const lockPointCoverage = {
    "T-20": { valid: 0, total: totalSpins, pct: 0 },
    "T-15": { valid: 0, total: totalSpins, pct: 0 },
    "T-10": { valid: 0, total: totalSpins, pct: 0 },
    "T-5": { valid: 0, total: totalSpins, pct: 0 },
  };

  let spinsWithAnyVideo = 0;
  let spinsWithMovement = 0;
  let insufficientCount = 0;

  for (const spin of synchronizedSpins) {
    let hasValid = false;
    let hasMovement = false;
    let allInsufficient = true;

    for (const lp of lockLabels) {
      const lockState = spin.lockPoints[lp];
      if (lockState) {
        if (lockState.videoValid) {
          lockPointCoverage[lp].valid++;
          hasValid = true;
          allInsufficient = false;
        }
        if (lockState.windowHasMovement) {
          hasMovement = true;
        }
      }
    }

    if (hasValid) spinsWithAnyVideo++;
    if (hasMovement) spinsWithMovement++;
    if (allInsufficient) insufficientCount++;
  }

  for (const lp of lockLabels) {
    lockPointCoverage[lp].pct =
      totalSpins > 0 ? lockPointCoverage[lp].valid / totalSpins : 0;
  }

  // Tracking quality
  const trackingSnapshots = snapshotBuffer.filter((s) => s.isTracking).length;
  const movingSnapshots = snapshotBuffer.filter(
    (s) => s.movementState === "MOVING",
  ).length;
  const stableSnapshots = snapshotBuffer.filter(
    (s) => s.calibrationStable,
  ).length;

  // Direction consistency (majority direction)
  let cwCount = 0;
  let ccwCount = 0;
  for (const s of snapshotBuffer) {
    if (s.movementState === "MOVING") {
      if (s.direction > 0) cwCount++;
      else ccwCount++;
    }
  }
  const totalMoving = cwCount + ccwCount;
  const directionConsistency =
    totalMoving > 0
      ? Math.max(cwCount, ccwCount) / totalMoving
      : 0;

  // Timing sync
  const delays = synchronizedSpins
    .map((s) => s.resultToApiDelay)
    .filter((d) => d > 0);
  const avgDelay = delays.length > 0 ? delays.reduce((s, v) => s + v, 0) / delays.length : 0;
  const maxDelay = delays.length > 0 ? Math.max(...delays) : 0;
  const minDelay = delays.length > 0 ? Math.min(...delays) : 0;

  // Sector map status
  const uniqueOutcomes = new Set(
    sectorObservations.map((o) => o.outcome),
  ).size;

  return {
    totalSpins,
    spinsWithAnyVideo,
    spinsWithMovement,
    lockPointCoverage,
    movingSpinCount: spinsWithMovement,
    trackingQuality: {
      totalSnapshots: snapshotBuffer.length,
      trackingSnapshots,
      movingSnapshots,
      trackingRate: snapshotBuffer.length > 0 ? trackingSnapshots / snapshotBuffer.length : 0,
    },
    calibrationQuality: {
      stableCount: stableSnapshots,
      totalCount: snapshotBuffer.length,
      stabilityRate: snapshotBuffer.length > 0 ? stableSnapshots / snapshotBuffer.length : 0,
    },
    directionConsistency,
    timingSync: {
      avgResultToApiDelay: avgDelay,
      maxResultToApiDelay: maxDelay,
      minResultToApiDelay: minDelay,
    },
    insufficientCount,
    sectorMapStatus: {
      totalObservations: sectorObservations.length,
      uniqueOutcomes,
      confident: sectorObservations.length >= 10,
    },
  };
}

/**
 * Get sector observations (for sector-map validation).
 */
export function getSectorObservations(): SectorObservation[] {
  return sectorObservations;
}

/**
 * Clear all data (for reset).
 */
export function clearAll(): void {
  snapshotBuffer = [];
  synchronizedSpins = [];
  sectorObservations = [];
  bufferListeners.forEach((l) => l());
}

/**
 * Subscribe to buffer changes.
 */
export function subscribeToBuffer(cb: () => void): () => void {
  bufferListeners.add(cb);
  return () => {
    bufferListeners.delete(cb);
  };
}
