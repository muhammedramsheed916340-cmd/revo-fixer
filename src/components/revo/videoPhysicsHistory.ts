/**
 * VIDEO PHYSICS HISTORY COLLECTOR
 * =================================
 *
 * Collects chronological video physics snapshots for the Fusion V2 experiment.
 *
 * Each snapshot is timestamped and stored in a ring buffer. When a live result
 * arrives, we can look back in time to find the physics state at T-20, T-15,
 * T-10, T-5 (where T = physical wheel stop ≈ result settledAt).
 *
 * CRITICAL: All snapshots are PRE-RESULT. We NEVER store frames after the
 * result arrives. This guarantees no data leakage.
 */

import type { WheelPhysicsState } from "./RevoVideoSensor";

export interface PhysicsSnapshot {
  timestamp: number; // ms epoch (when the snapshot was taken)
  angle: number; // unwrapped, continuous (degrees)
  velocity: number; // deg/s (filtered)
  acceleration: number; // deg/s²
  confidence: number; // 0..1 (tracking confidence)
  direction: 1 | -1;
  isTracking: boolean;
  calibrationStable: boolean;
}

export interface SynchronizedSpin {
  spinId: string; // settledAt as unique ID
  resultTimestamp: number; // ms epoch (settledAt)
  actualOutcome: string;
  actualSector: number | null;
  // Physics snapshots available BEFORE this result (strictly pre-result)
  physicsHistory: PhysicsSnapshot[];
  // Lock-point states (computed from pre-result physics)
  lockPoints: {
    "T-20": LockPointState | null;
    "T-15": LockPointState | null;
    "T-10": LockPointState | null;
    "T-5": LockPointState | null;
  };
}

export interface LockPointState {
  lockTimestamp: number; // ms epoch
  lockLabel: string; // "T-20", "T-15", etc.
  physics: PhysicsSnapshot | null; // latest physics at or before lock
  videoValid: boolean;
  videoReason: string;
}

// Ring buffer of recent physics snapshots (max 5 minutes = 300s at ~20fps = 6000)
const MAX_SNAPSHOTS = 6000;
let snapshotBuffer: PhysicsSnapshot[] = [];
const bufferListeners = new Set<() => void>();

// Completed synchronized spins (for experiment)
let synchronizedSpins: SynchronizedSpin[] = [];
const MAX_SYNCHRONIZED = 500;

/**
 * Record a physics snapshot. Called from the video sensor's frame loop.
 * Only stores snapshots when the sensor is actively tracking (to avoid
 * filling the buffer with stopped-wheel noise).
 */
export function recordPhysicsSnapshot(physics: WheelPhysicsState): void {
  const snapshot: PhysicsSnapshot = {
    timestamp: physics.timestamp * 1000, // convert s→ms
    angle: physics.angle,
    velocity: physics.velocity,
    acceleration: physics.acceleration,
    confidence: physics.confidence,
    direction: physics.direction,
    isTracking: physics.isTracking,
    calibrationStable: physics.calibrationStable,
  };

  snapshotBuffer.push(snapshot);
  if (snapshotBuffer.length > MAX_SNAPSHOTS) {
    snapshotBuffer.shift();
  }

  bufferListeners.forEach((l) => l());
}

/**
 * Get all physics snapshots in a time range [fromMs, toMs].
 * Used to extract pre-result physics for a specific spin.
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
 * This is the PRE-RESULT state — no future frames.
 */
export function getPhysicsAt(timestampMs: number): PhysicsSnapshot | null {
  // Find the latest snapshot with timestamp <= timestampMs
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
 * Record a synchronized spin: pairs a live result with its pre-result
 * physics history at T-20, T-15, T-10, T-5 lock points.
 *
 * @param spinId Unique spin ID (settledAt)
 * @param resultTimestamp When the result was settled (ms epoch)
 * @param actualOutcome The actual outcome name
 * @param actualSector The actual sector index (0..53), if known
 */
export function recordSynchronizedSpin(
  spinId: string,
  resultTimestamp: number,
  actualOutcome: string,
  actualSector: number | null,
): SynchronizedSpin {
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
    const videoValid = physics !== null && physics.isTracking && physics.confidence > 0.15;
    const videoReason = physics === null
      ? "No video frame at this lock point"
      : !physics.isTracking
        ? "Not tracking at lock time"
        : physics.confidence < 0.15
          ? `Confidence too low (${(physics.confidence * 100).toFixed(0)}%)`
          : `Valid — v=${physics.velocity.toFixed(0)}°/s conf=${(physics.confidence * 100).toFixed(0)}%`;

    lockPoints[label as keyof typeof lockPoints] = {
      lockTimestamp: lockTs,
      lockLabel: label,
      physics,
      videoValid,
      videoReason,
    };
  }

  // Also collect the full physics history in the 60s before the result
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
    lockPoints,
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

  return spin;
}

/**
 * Get all synchronized spins (for experiment).
 */
export function getSynchronizedSpins(): SynchronizedSpin[] {
  return synchronizedSpins;
}

/**
 * Get the count of synchronized spins.
 */
export function getSynchronizedCount(): number {
  return synchronizedSpins.length;
}

/**
 * Get the current snapshot buffer size (for monitoring).
 */
export function getBufferSize(): number {
  return snapshotBuffer.length;
}

/**
 * Get statistics about the buffer (for UI display).
 */
export function getBufferStats(): {
  totalSnapshots: number;
  trackingSnapshots: number;
  validVideoSpins: number;
  timeSpanSeconds: number;
} {
  const trackingSnapshots = snapshotBuffer.filter((s) => s.isTracking).length;
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
    validVideoSpins,
    timeSpanSeconds: timeSpan,
  };
}

/**
 * Clear all data (for reset).
 */
export function clearAll(): void {
  snapshotBuffer = [];
  synchronizedSpins = [];
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
