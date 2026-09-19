/**
 * REAL WHEEL PHYSICS + MOTION SIGNAL — EXPERIMENTAL LAYER (ADDITIVE)
 * =================================================================
 *
 * NEW FILE. Nothing existing is modified. This layer continuously analyses
 * the live wheel video (via the existing sensor telemetry) and produces
 * PRE-RESULT physical evidence. It is OFF by default
 * (see `signalFlags.ts` → PHYSICS_SIGNAL).
 *
 * It measures, from the ACTUAL video:
 *   1. rotation direction    — LEFT / RIGHT + confidence, stability, changes
 *   2. wheel speed           — current / average / peak velocity, acceleration,
 *                              deceleration, velocity trend, estimated time to stop
 *   3. movement state        — IDLE · SPINNING · FAST · DECELERATING · SLOW ·
 *                              NEAR_STOP · STOPPED (hysteresis state machine)
 *   4. vibration / physical movement — frame-to-frame motion, radial movement,
 *                              centre displacement, wobble, vibration/noise level,
 *                              optical-flow strength, phase-correlation strength,
 *                              abnormal/noisy frame detection
 *   5. position / sector tracking — current angle, angular displacement, the
 *                              sector passing the reference point, direction,
 *                              predicted stopping angle + uncertainty
 *
 * It then maps the physical evidence onto ALL 8 outcomes (never forcing one),
 * using the SAME constant-deceleration stopping model the project already
 * validated (`fusionEngine.predictStoppingAngle`), so the physics of the
 * project stay in ONE place.
 *
 * HARD RULES ENCODED
 * ------------------
 *   - Direction is MEASURED from the video (frame-to-frame angle deltas +
 *     the sensor's own direction sign). LEFT/RIGHT is never assumed or hardcoded.
 *   - No post-stop frames may influence a prediction: `lockPhysicsPrediction()`
 *     refuses to lock when `lockTimestamp >= physicalStopTimestamp`.
 *   - The physics layer never forces an outcome: it returns a probability
 *     vector over all 8 outcomes plus an explicit confidence. When tracking is
 *     insufficient the vector is ALL ZEROS (never silently replaced by
 *     theoretical numbers) — exactly like the existing fusion engine.
 */

import { predictStoppingAngle, type StoppingPrediction } from "./fusionEngine";
import { OUTCOMES_8, THEORETICAL_BASE_54 } from "./timeSignal";
import { mulberry32, round as roundTo, safeDiv, clamp01 } from "./signalStats";

export const WHEEL_MOTION_VERSION = "wheel-motion-v1.0";

// ============================================================
// 1. FRAME MODEL + SENSOR ADAPTER
// ============================================================

/**
 * One frame of wheel telemetry. Structurally compatible with the existing
 * `WheelPhysicsState` produced by RevoVideoSensor, plus OPTIONAL physical
 * measurements the sensor may add later (radial movement, centre displacement)
 * — when they are absent the layer reports them as UNAVAILABLE rather than
 * inventing a value.
 */
export interface MotionFrame {
  timestamp: number;              // ms epoch
  angle: number;                  // unwrapped, continuous (deg)
  angleWrapped?: number;          // 0..360
  velocity: number;               // deg/s (filtered)
  velocityRaw?: number;           // deg/s (raw)
  acceleration: number;           // deg/s²
  confidence: number;             // 0..1 (sensor tracking confidence)
  direction: 1 | -1;              // sensor sign convention
  isTracking: boolean;
  calibrationStable?: boolean;
  sectorIndex?: number | null;
  sectorEstimate?: string | null;
  opticalFlowStrength?: number;   // signalB (deg)
  phaseCorrelationStrength?: number; // signalAgreement 0..1
  profDiff?: number;              // frame profile difference (brightness change)
  radialMovement?: number;        // px (optional; sensor may not provide)
  centerDisplacement?: number;    // px (optional; sensor may not provide)
}

/** Adapter: existing sensor state → MotionFrame (extra fields preserved when present). */
export function frameFromSensorState(p: {
  timestamp: number;
  angle: number;
  angleWrapped?: number;
  velocity: number;
  velocityRaw?: number;
  acceleration: number;
  confidence: number;
  direction: 1 | -1;
  isTracking: boolean;
  calibrationStable?: boolean;
  sectorIndex?: number | null;
  sectorEstimate?: string | null;
  signalA?: number;
  signalB?: number;
  signalAgreement?: number;
  profDiff?: number;
}): MotionFrame {
  return {
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
    sectorIndex: p.sectorIndex ?? null,
    sectorEstimate: p.sectorEstimate ?? null,
    opticalFlowStrength: p.signalB,
    phaseCorrelationStrength: p.signalAgreement,
    profDiff: p.profDiff,
  };
}

// ============================================================
// 2. DIRECTION ANALYSIS
// ============================================================

export type WheelDirection = "LEFT" | "RIGHT" | "UNKNOWN";

export interface DirectionEstimate {
  direction: WheelDirection;
  confidence: number;             // 0..1
  stability: number;              // 0..1 (1 = never changed)
  changes: number;                // detected direction flips during the spin
  changePoints: { timestamp: number; from: WheelDirection; to: WheelDirection; angle: number }[];
  samples: number;
  movingSamples: number;
  source: string;
  note: string;
}

const DIRECTION_MIN_MOVEMENT_DEG = 0.5; // per-frame angle delta that counts as real movement
const DIRECTION_CONFIDENCE_SCALE = 30;  // frames needed for high confidence

/**
 * Measure rotation direction from the ACTUAL frame data.
 *
 * Two independent signals are combined:
 *   A. sign of the frame-to-frame angle delta (the physical measurement)
 *   B. the sensor's own direction sign (its internal estimate)
 *
 * Neither is trusted alone; disagreement lowers confidence instead of being
 * hidden. Nothing is hardcoded as LEFT or RIGHT.
 */
export function analyzeDirection(frames: MotionFrame[]): DirectionEstimate {
  if (frames.length < 2) {
    return {
      direction: "UNKNOWN",
      confidence: 0,
      stability: 0,
      changes: 0,
      changePoints: [],
      samples: frames.length,
      movingSamples: 0,
      source: "angle-delta+sign",
      note: "INSUFFICIENT FRAMES — direction cannot be measured (no assumption applied).",
    };
  }

  let deltaRight = 0;
  let deltaLeft = 0;
  let sensorRight = 0;
  let sensorLeft = 0;
  let moving = 0;
  let flips = 0;
  let lastSign = 0;
  const changePoints: DirectionEstimate["changePoints"] = [];

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const cur = frames[i];
    const delta = cur.angle - prev.angle;
    const dt = Math.max(1e-3, (cur.timestamp - prev.timestamp) / 1000);
    const perFrame = delta; // unwrapped angle is continuous

    if (Math.abs(perFrame) >= DIRECTION_MIN_MOVEMENT_DEG && cur.isTracking) {
      moving++;
      const sign = Math.sign(perFrame);
      if (sign > 0) deltaRight++;
      else deltaLeft++;
      if (lastSign !== 0 && sign !== lastSign) {
        flips++;
        changePoints.push({
          timestamp: cur.timestamp,
          from: lastSign > 0 ? "RIGHT" : "LEFT",
          to: sign > 0 ? "RIGHT" : "LEFT",
          angle: cur.angle,
        });
      }
      lastSign = sign;
    }
    // Sensor's own direction estimate (deg/s sign convention)
    const effVel = cur.velocityRaw ?? cur.velocity;
    if (Math.abs(effVel) > 5 && cur.isTracking) {
      if (effVel > 0) sensorRight++;
      else sensorLeft++;
    }
    void dt;
  }

  const deltaTotal = deltaRight + deltaLeft;
  const sensorTotal = sensorRight + sensorLeft;
  const deltaDir: WheelDirection = deltaTotal === 0 ? "UNKNOWN" : deltaRight >= deltaLeft ? "RIGHT" : "LEFT";
  const sensorDir: WheelDirection = sensorTotal === 0 ? "UNKNOWN" : sensorRight >= sensorLeft ? "RIGHT" : "LEFT";

  const deltaConfidence = safeDiv(Math.max(deltaRight, deltaLeft), deltaTotal);
  const sensorConfidence = safeDiv(Math.max(sensorRight, sensorLeft), sensorTotal);
  const agreement = deltaDir === sensorDir || deltaDir === "UNKNOWN" || sensorDir === "UNKNOWN";

  const direction: WheelDirection = deltaDir !== "UNKNOWN" ? deltaDir : sensorDir;
  const rawConfidence = deltaDir !== "UNKNOWN" ? deltaConfidence : sensorConfidence;
  const sampleFactor = Math.min(1, safeDiv(moving, DIRECTION_CONFIDENCE_SCALE));
  const agreementFactor = agreement ? 1 : 0.75;
  const confidence = clamp01(rawConfidence * sampleFactor * agreementFactor);

  const stabilityRaw = moving > 0 ? 1 - safeDiv(flips, moving) : 0;

  const note = deltaTotal === 0
    ? "NO MEASURABLE ROTATION — direction stays UNKNOWN (never guessed)."
    : `${direction} measured from ${deltaTotal} moving frames (Δangle ${deltaRight}→ / ${deltaLeft}←, sensor ${sensorRight}→/${sensorLeft}←, agreement=${agreement ? "yes" : "NO"}).`;

  return {
    direction,
    confidence: roundTo(confidence, 4),
    stability: roundTo(clamp01(stabilityRaw), 4),
    changes: flips,
    changePoints,
    samples: frames.length,
    movingSamples: moving,
    source: "angle-delta+sign",
    note,
  };
}

// ============================================================
// 2b. LIVE ROTATION READOUT (for the UI + debug panel)
// ============================================================
// A single, explicitly-sourced answer to "which way is the wheel turning right
// now and how fast". It NEVER guesses: when the measured motion is below the
// direction threshold the answer is UNKNOWN/IDLE with the exact reason.
//
// Sources, in order of preference:
//   1. video frames (per-frame unwrapped-angle deltas + signed velocities)
//   2. the live sensor state (its own filtered velocity, when frames are sparse)
//
// Sign convention (project-wide): positive angular velocity = RIGHT/CW,
// negative = LEFT/CCW. The convention is VERIFIED against the measured angle
// delta of the same frames (`signAgreement`), so a wrong sensor sign is surfaced
// instead of silently trusted.

/** |velocity| below this is treated as "not rotating" → direction UNKNOWN. */
export const ROTATION_DIRECTION_MIN_DEG_PER_SEC = 8;

export interface RotationReadout {
  direction: WheelDirection;
  confidence: number;               // 0..1
  filteredSpeedDegPerSec: number;   // |filtered velocity| of the latest sample
  rawSpeedDegPerSec: number;        // |raw velocity| of the latest sample
  signedVelocityDegPerSec: number;  // filtered, signed
  acceleration: number;             // deg/s²
  tracking: boolean;
  thresholdDegPerSec: number;
  frames: number;
  movingFrames: number;
  signAgreement: boolean | null;    // sensor sign vs measured angle delta
  source: "video-frames" | "sensor-state" | "none";
  reason: string;                   // exact reason when direction is UNKNOWN
  /** Ready-to-render text, e.g. `RIGHT · 812 °/s (conf 91%)`. */
  display: string;
}

function velocitySource(frames: MotionFrame[]): { signed: number; raw: number; acceleration: number; tracking: boolean } {
  const last = frames[frames.length - 1];
  return {
    signed: last.velocity,
    raw: typeof last.velocityRaw === "number" ? last.velocityRaw : Math.abs(last.velocity),
    acceleration: last.acceleration,
    tracking: last.isTracking,
  };
}

/**
 * Measure the CURRENT rotation direction/speed from real video motion.
 *
 * `frames` must be chronological; `sensor` (optional) is the live sensor state
 * used only when there are not enough frames yet.
 */
export function rotationReadout(
  frames: MotionFrame[],
  sensor?: { velocity: number; velocityRaw?: number; acceleration: number; confidence: number; direction: 1 | -1; isTracking: boolean } | null,
): RotationReadout {
  const ordered = [...frames].sort((a, b) => a.timestamp - b.timestamp);
  const threshold = ROTATION_DIRECTION_MIN_DEG_PER_SEC;

  // --- 1. frame-based measurement (authoritative) ---
  let rightFrames = 0;
  let leftFrames = 0;
  let movingFrames = 0;
  let sensorAgrees = 0;
  let sensorCompared = 0;
  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i];
    const dt = i > 0 ? Math.max(1e-3, (f.timestamp - ordered[i - 1].timestamp) / 1000) : 0;
    const delta = i > 0 ? f.angle - ordered[i - 1].angle : 0;
    const effVel = typeof f.velocityRaw === "number" && Math.abs(f.velocityRaw) > 1 ? f.velocityRaw : f.velocity;
    const measuredSign = Math.abs(delta) >= 0.01 ? Math.sign(delta) : Math.sign(effVel);
    if (!f.isTracking) continue;
    if (Math.abs(effVel) < threshold && dt === 0) continue;
    if (Math.abs(effVel) < threshold && Math.abs(delta) < threshold * dt) continue;
    movingFrames++;
    if (measuredSign > 0) rightFrames++;
    else if (measuredSign < 0) leftFrames++;
    if (i > 0 && Math.abs(delta) >= 0.01 && Math.abs(effVel) >= threshold) {
      sensorCompared++;
      if (Math.sign(effVel) === Math.sign(delta)) sensorAgrees++;
    }
  }
  const measuredTotal = rightFrames + leftFrames;
  const measured: WheelDirection = measuredTotal === 0 ? "UNKNOWN" : rightFrames >= leftFrames ? "RIGHT" : "LEFT";
  const measuredConfidence = measuredTotal === 0 ? 0 : Math.max(rightFrames, leftFrames) / measuredTotal;
  const signAgreement = sensorCompared === 0 ? null : sensorAgrees / sensorCompared >= 0.5;

  const latest = ordered.length > 0 ? velocitySource(ordered) : null;
  const sensorSigned = latest ? latest.signed : (sensor?.velocity ?? 0);
  const sensorRaw = latest ? latest.raw : (Math.abs(sensor?.velocityRaw ?? 0) || Math.abs(sensor?.velocity ?? 0));
  const acceleration = latest ? latest.acceleration : (sensor?.acceleration ?? 0);
  const tracking = latest ? latest.tracking : Boolean(sensor?.isTracking);
  const speed = Math.abs(sensorSigned);

  const sampleFactor = clamp01(measuredTotal / 5);
  const confidence = clamp01(measuredConfidence * (0.4 + 0.6 * sampleFactor));

  // Not moving (or not tracking) → UNKNOWN with the exact reason.
  if (!tracking) {
    return {
      direction: "UNKNOWN",
      confidence: 0,
      filteredSpeedDegPerSec: speed,
      rawSpeedDegPerSec: Math.abs(sensorRaw),
      signedVelocityDegPerSec: sensorSigned,
      acceleration,
      tracking: false,
      thresholdDegPerSec: threshold,
      frames: ordered.length,
      movingFrames,
      signAgreement,
      source: ordered.length > 0 ? "video-frames" : sensor ? "sensor-state" : "none",
      reason:
        ordered.length === 0 && !sensor
          ? "no live sensor state and no frames — video pipeline not started"
          : "sensor reports no tracking on the current frames (wheel idle or stream not calibrated)",
      display: "UNKNOWN (no tracking)",
    };
  }
  if (speed < threshold && measuredTotal === 0) {
    return {
      direction: "UNKNOWN",
      confidence: 0,
      filteredSpeedDegPerSec: speed,
      rawSpeedDegPerSec: Math.abs(sensorRaw),
      signedVelocityDegPerSec: sensorSigned,
      acceleration,
      tracking: true,
      thresholdDegPerSec: threshold,
      frames: ordered.length,
      movingFrames,
      signAgreement,
      source: ordered.length > 0 ? "video-frames" : "sensor-state",
      reason: `measured speed ${speed.toFixed(1)} °/s is below the direction threshold ${threshold} °/s — not rotating (IDLE)`,
      display: `UNKNOWN (idle · ${speed.toFixed(1)} °/s)`,
    };
  }
  if (measured === "UNKNOWN") {
    // Frames exist but the newest samples are not usable → fall back to the
    // sensor's own sign, clearly labelled, and only when it is above threshold.
    if (sensor && Math.abs(sensor.velocity) >= threshold && sensor.isTracking) {
      const dir: WheelDirection = sensor.velocity > 0 ? "RIGHT" : "LEFT";
      return {
        direction: dir,
        confidence: clamp01(0.3 * sensor.confidence),
        filteredSpeedDegPerSec: Math.abs(sensor.velocity),
        rawSpeedDegPerSec: Math.abs(sensor.velocityRaw ?? sensor.velocity),
        signedVelocityDegPerSec: sensor.velocity,
        acceleration,
        tracking: true,
        thresholdDegPerSec: threshold,
        frames: ordered.length,
        movingFrames,
        signAgreement,
        source: "sensor-state",
        reason: "no usable angle deltas in the frame window — using the sensor's own signed velocity",
        display: `${dir} · ${Math.abs(sensor.velocity).toFixed(0)} °/s (sensor sign, low confidence)`,
      };
    }
    return {
      direction: "UNKNOWN",
      confidence: 0,
      filteredSpeedDegPerSec: speed,
      rawSpeedDegPerSec: Math.abs(sensorRaw),
      signedVelocityDegPerSec: sensorSigned,
      acceleration,
      tracking,
      thresholdDegPerSec: threshold,
      frames: ordered.length,
      movingFrames,
      signAgreement,
      source: "video-frames",
      reason: `no measurable angular movement in ${ordered.length} frame(s) (need ≥2 tracking frames above ${threshold} °/s)`,
      display: "UNKNOWN (no measurable rotation)",
    };
  }

  return {
    direction: measured,
    confidence,
    filteredSpeedDegPerSec: speed,
    rawSpeedDegPerSec: Math.abs(sensorRaw),
    signedVelocityDegPerSec: sensorSigned,
    acceleration,
    tracking,
    thresholdDegPerSec: threshold,
    frames: ordered.length,
    movingFrames,
    signAgreement,
    source: "video-frames",
    reason: `measured from ${measuredTotal} moving frame(s) (${rightFrames}→ / ${leftFrames}←)`,
    display: `${measured} · ${speed.toFixed(0)} °/s (conf ${(confidence * 100).toFixed(0)}%)`,
  };
}

// ============================================================
// 3. SPEED / ACCELERATION / DECELERATION PROFILE
// ============================================================

export interface SpeedPoint {
  timestamp: number;
  velocity: number;
  acceleration: number;
}

export interface SpeedProfile {
  currentVelocity: number;        // signed deg/s (last frame)
  currentSpeed: number;           // |velocity|
  averageSpeed: number;           // mean |velocity| over moving frames
  peakSpeed: number;              // max |velocity|
  peakTimestamp: number | null;
  initialVelocity: number;        // first measurable velocity of the spin (signed)
  acceleration: number;           // current acceleration (deg/s²)
  averageAcceleration: number;    // over the spin
  deceleration: number;           // magnitude of the negative acceleration phase (deg/s²)
  decelerationSamples: number;
  velocityTrend: number;          // deg/s² — slope of |v| over the last N frames
  estimatedTimeToStop: number | null; // seconds (null when not estimable)
  profile: SpeedPoint[];
  measurableFrames: number;
  note: string;
}

/** Least-squares slope of y over x. */
function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export function analyzeSpeed(frames: MotionFrame[], opts: { trendWindow?: number; minSpeed?: number } = {}): SpeedProfile {
  const trendWindow = opts.trendWindow ?? 12;
  const minSpeed = opts.minSpeed ?? 2;
  const measurable = frames.filter((f) => f.isTracking && Math.abs(f.velocityRaw ?? f.velocity) >= minSpeed);
  const profile: SpeedPoint[] = frames.map((f) => ({ timestamp: f.timestamp, velocity: f.velocity, acceleration: f.acceleration }));

  if (frames.length === 0) {
    return {
      currentVelocity: 0, currentSpeed: 0, averageSpeed: 0, peakSpeed: 0, peakTimestamp: null,
      initialVelocity: 0, acceleration: 0, averageAcceleration: 0, deceleration: 0, decelerationSamples: 0,
      velocityTrend: 0, estimatedTimeToStop: null, profile: [], measurableFrames: 0,
      note: "NO FRAMES — no speed estimate possible.",
    };
  }

  const last = frames[frames.length - 1];
  const currentVelocity = last.velocity;
  let peakSpeed = 0;
  let peakTimestamp: number | null = null;
  for (const f of frames) {
    const s = Math.abs(f.velocityRaw ?? f.velocity);
    if (s > peakSpeed) {
      peakSpeed = s;
      peakTimestamp = f.timestamp;
    }
  }
  const averageSpeed = measurable.length > 0
    ? measurable.reduce((s, f) => s + Math.abs(f.velocityRaw ?? f.velocity), 0) / measurable.length
    : 0;
  const averageAcceleration = measurable.length > 0
    ? measurable.reduce((s, f) => s + f.acceleration, 0) / measurable.length
    : 0;

  // Deceleration phase: negative accelerations that clearly oppose motion.
  const decelSamples: number[] = [];
  for (const f of frames) {
    const v = f.velocityRaw ?? f.velocity;
    if (f.isTracking && Math.abs(v) > minSpeed && f.acceleration * v < 0) {
      decelSamples.push(Math.abs(f.acceleration));
    }
  }
  decelSamples.sort((a, b) => a - b);
  const deceleration = decelSamples.length > 0
    ? decelSamples[Math.floor(decelSamples.length / 2)] // median (noise-robust)
    : 0;

  const tail = frames.slice(-trendWindow);
  const velocityTrend = slope(tail.map((f) => f.timestamp / 1000), tail.map((f) => Math.abs(f.velocityRaw ?? f.velocity)));

  const currentSpeed = Math.abs(currentVelocity);
  let estimatedTimeToStop: number | null = null;
  if (currentSpeed > minSpeed && deceleration > 0.5) {
    estimatedTimeToStop = currentSpeed / deceleration;
  }

  const initialVelocity = measurable.length > 0 ? (measurable[0].velocityRaw ?? measurable[0].velocity) : 0;

  return {
    currentVelocity: roundTo(currentVelocity, 3),
    currentSpeed: roundTo(currentSpeed, 3),
    averageSpeed: roundTo(averageSpeed, 3),
    peakSpeed: roundTo(peakSpeed, 3),
    peakTimestamp,
    initialVelocity: roundTo(initialVelocity, 3),
    acceleration: roundTo(last.acceleration, 3),
    averageAcceleration: roundTo(averageAcceleration, 3),
    deceleration: roundTo(deceleration, 3),
    decelerationSamples: decelSamples.length,
    velocityTrend: roundTo(velocityTrend, 3),
    estimatedTimeToStop: estimatedTimeToStop === null ? null : roundTo(estimatedTimeToStop, 2),
    profile,
    measurableFrames: measurable.length,
    note: deceleration > 0.5
      ? `Deceleration phase measured from ${decelSamples.length} frames (median |a|=${deceleration.toFixed(2)} °/s²).`
      : "NO CLEAR DECELERATION MEASURED — time-to-stop is not estimated (never guessed).",
  };
}

// ============================================================
// 4. VIBRATION / PHYSICAL MOVEMENT
// ============================================================

export interface VibrationMetrics {
  frameToFrameMotion: number;      // median |Δangle| per frame (deg)
  radialMovement: number | null;   // px — null when the sensor does not provide it
  centerDisplacement: number | null;
  wobble: number | null;
  vibrationScore: number;          // 0..1 (higher = more vibration/noise)
  noiseLevel: number;              // MAD of (Δangle − median Δangle), deg
  opticalFlowStrength: number;     // mean |signalB| (deg), 0 when unavailable
  phaseCorrelationStrength: number;// mean signalAgreement 0..1, 0 when unavailable
  abnormalFrames: number;
  abnormalFrameTimestamps: number[];
  abnormalFrameReasons: string[];
  trackingConfidence: number;      // mean sensor confidence over frames
  calibrationStableRate: number;
  note: string;
}

export function analyzeVibration(frames: MotionFrame[]): VibrationMetrics {
  if (frames.length === 0) {
    return {
      frameToFrameMotion: 0, radialMovement: null, centerDisplacement: null, wobble: null,
      vibrationScore: 0, noiseLevel: 0, opticalFlowStrength: 0, phaseCorrelationStrength: 0,
      abnormalFrames: 0, abnormalFrameTimestamps: [], abnormalFrameReasons: [], trackingConfidence: 0,
      calibrationStableRate: 0, note: "NO FRAMES — vibration metrics unavailable.",
    };
  }
  const deltas: number[] = [];
  for (let i = 1; i < frames.length; i++) deltas.push(frames[i].angle - frames[i - 1].angle);
  deltas.sort((a, b) => a - b);
  const medianDelta = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : 0;
  const frameToFrameMotion = Math.abs(medianDelta);
  const deviations = deltas.map((d) => Math.abs(d - medianDelta)).sort((a, b) => a - b);
  const noiseLevel = deviations.length > 0 ? deviations[Math.floor(deviations.length / 2)] : 0;

  const radialValues = frames.map((f) => f.radialMovement).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const centerValues = frames.map((f) => f.centerDisplacement).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const radialMovement = radialValues.length > 0 ? radialValues.reduce((s, v) => s + v, 0) / radialValues.length : null;
  const centerDisplacement = centerValues.length > 0 ? centerValues.reduce((s, v) => s + v, 0) / centerValues.length : null;
  let wobble: number | null = null;
  if (centerValues.length > 1) {
    const mean = centerValues.reduce((s, v) => s + v, 0) / centerValues.length;
    wobble = Math.sqrt(centerValues.reduce((s, v) => s + (v - mean) ** 2, 0) / centerValues.length);
  }

  const flowValues = frames.map((f) => f.opticalFlowStrength).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const flowStrength = flowValues.length > 0 ? flowValues.reduce((s, v) => s + Math.abs(v), 0) / flowValues.length : 0;
  const pcValues = frames.map((f) => f.phaseCorrelationStrength).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const phaseCorrelationStrength = pcValues.length > 0 ? pcValues.reduce((s, v) => s + v, 0) / pcValues.length : 0;

  const profDiffs = frames.map((f) => f.profDiff).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  let abnormalFrames = 0;
  const abnormalFrameTimestamps: number[] = [];
  const abnormalFrameReasons: string[] = [];
  if (profDiffs.length > 5) {
    const sorted = [...profDiffs].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)];
    const mad = [...sorted.map((v) => Math.abs(v - p50))].sort((a, b) => a - b)[Math.floor(sorted.length / 2)] || 1;
    const threshold = p50 + 5 * mad;
    frames.forEach((f, idx) => {
      const pd = f.profDiff;
      if (typeof pd === "number" && pd > threshold) {
        abnormalFrames++;
        abnormalFrameTimestamps.push(f.timestamp);
        abnormalFrameReasons.push(`frame ${idx}: profDiff=${pd.toFixed(1)} > noise threshold ${threshold.toFixed(1)}`);
      } else if (!f.isTracking || f.confidence < 0.15) {
        abnormalFrames++;
        abnormalFrameTimestamps.push(f.timestamp);
        abnormalFrameReasons.push(`frame ${idx}: tracking lost (confidence=${f.confidence.toFixed(2)})`);
      }
    });
  }

  // Vibration score: angular jitter relative to the rotation, plus noise level,
  // normalized so 0 = perfectly smooth rotation and 1 = heavy noise. The
  // rotation itself is removed (noise is measured on the RESIDUAL), so a fast
  // but smooth wheel does not score as "vibrating".
  const residualScale = Math.max(1, frameToFrameMotion);
  const jitterRatio = clamp01(noiseLevel / (residualScale * 2));
  const abnormalRatio = clamp01(safeDiv(abnormalFrames, frames.length));
  const vibrationScore = clamp01(0.6 * jitterRatio + 0.4 * abnormalRatio);

  const trackingConfidence = frames.reduce((s, f) => s + f.confidence, 0) / frames.length;
  const calStable = frames.filter((f) => f.calibrationStable === true).length;
  const calibrationStableRate = safeDiv(calStable, frames.length);

  return {
    frameToFrameMotion: roundTo(frameToFrameMotion, 4),
    radialMovement: radialMovement === null ? null : roundTo(radialMovement, 4),
    centerDisplacement: centerDisplacement === null ? null : roundTo(centerDisplacement, 4),
    wobble: wobble === null ? null : roundTo(wobble, 4),
    vibrationScore: roundTo(vibrationScore, 4),
    noiseLevel: roundTo(noiseLevel, 4),
    opticalFlowStrength: roundTo(flowStrength, 4),
    phaseCorrelationStrength: roundTo(phaseCorrelationStrength, 4),
    abnormalFrames,
    abnormalFrameTimestamps,
    abnormalFrameReasons: abnormalFrameReasons.slice(0, 20),
    trackingConfidence: roundTo(trackingConfidence, 4),
    calibrationStableRate: roundTo(calibrationStableRate, 4),
    note:
      radialValues.length === 0
        ? "Radial movement / centre displacement UNAVAILABLE from the current sensor (reported as null — never invented)."
        : "Radial + centre measurements supplied by the sensor.",
  };
}

// ============================================================
// 5. MOTION STATE MACHINE
// ============================================================

export type MotionState = "IDLE" | "SPINNING" | "FAST" | "DECELERATING" | "SLOW" | "NEAR_STOP" | "STOPPED";

export const MOTION_THRESHOLDS = {
  stoppedSpeed: 2,          // °/s below which the wheel is at rest
  nearStopSpeed: 60,        // °/s below which the wheel is nearly stopped
  slowSpeed: 250,           // °/s below which the wheel is slow
  fastSpeed: 700,           // °/s above which the wheel is FAST
  decelAccel: -15,          // °/s² below which the wheel is decelerating
  spinAccel: 15,            // °/s² above which the wheel is accelerating
} as const;

export interface MotionAssessment {
  state: MotionState;
  confidence: number;
  previousState: MotionState | null;
  stateDurationMs: number | null;
  history: { timestamp: number; state: MotionState; speed: number }[];
  transitions: number;
  reason: string;
}

/** Classify the CURRENT motion state from the last frame + trend. */
function classifyOneFrame(
  speed: number,
  acceleration: number,
  tracking: boolean,
  prevState: MotionState | null,
): MotionState {
  if (!tracking && speed < MOTION_THRESHOLDS.stoppedSpeed) return "STOPPED";
  if (speed < MOTION_THRESHOLDS.stoppedSpeed) return prevState === "SPINNING" || prevState === "FAST" || prevState === "DECELERATING" ? "NEAR_STOP" : "STOPPED";
  if (speed >= MOTION_THRESHOLDS.fastSpeed) return "FAST";
  if (acceleration <= MOTION_THRESHOLDS.decelAccel) return "DECELERATING";
  if (speed < MOTION_THRESHOLDS.nearStopSpeed) return "NEAR_STOP";
  if (speed < MOTION_THRESHOLDS.slowSpeed) return "SLOW";
  return "SPINNING";
}

export function classifyMotionState(frames: MotionFrame[], speed: SpeedProfile): MotionAssessment {
  if (frames.length === 0) {
    return { state: "IDLE", confidence: 0, previousState: null, stateDurationMs: null, history: [], transitions: 0, reason: "No telemetry yet." };
  }
  const history: MotionAssessment["history"] = [];
  let prev: MotionState | null = null;
  let transitions = 0;
  let lastChangeTimestamp: number | null = null;
  const rawHistory: MotionState[] = [];
  for (const f of frames) {
    const spd = Math.abs(f.velocityRaw ?? f.velocity);
    const st = classifyOneFrame(spd, f.acceleration, f.isTracking, prev);
    if (prev !== null && st !== prev) {
      transitions++;
      lastChangeTimestamp = f.timestamp;
    }
    prev = st;
    rawHistory.push(st);
    history.push({ timestamp: f.timestamp, state: st, speed: roundTo(spd, 3) });
  }
  const state = prev ?? "IDLE";
  const lastTimestamp = frames[frames.length - 1].timestamp;
  const stateDurationMs = lastChangeTimestamp === null ? lastTimestamp - frames[0].timestamp : lastTimestamp - lastChangeTimestamp;

  // Confidence: how much of the recent window agrees with the current state.
  const tail = rawHistory.slice(-10);
  const agree = tail.filter((s) => s === state).length;
  const confidence = clamp01(safeDiv(agree, tail.length) * 0.7 + clamp01(safeDiv(speed.measurableFrames, frames.length)) * 0.3);

  const reason =
    state === "STOPPED"
      ? `Wheel at rest (|v|=${speed.currentSpeed.toFixed(1)} °/s < ${MOTION_THRESHOLDS.stoppedSpeed}).`
      : state === "FAST"
        ? `Wheel spinning fast (|v|=${speed.currentSpeed.toFixed(1)} °/s ≥ ${MOTION_THRESHOLDS.fastSpeed}).`
        : state === "DECELERATING"
          ? `Decelerating at ${speed.acceleration.toFixed(1)} °/s².`
          : state === "NEAR_STOP"
            ? `Nearly stopped (|v|=${speed.currentSpeed.toFixed(1)} °/s).`
            : state === "SLOW"
              ? `Slow rotation (|v|=${speed.currentSpeed.toFixed(1)} °/s).`
              : `Wheel spinning (|v|=${speed.currentSpeed.toFixed(1)} °/s).`;

  return { state, confidence: roundTo(confidence, 4), previousState: rawHistory.length > 1 ? rawHistory[rawHistory.length - 2] : null, stateDurationMs, history, transitions, reason };
}

// ============================================================
// 6. POSITION / SECTOR TRACKING
// ============================================================

export interface PositionTracking {
  currentAngle: number;                 // 0..360 (wrapped)
  currentAngleUnwrapped: number;
  angularDisplacement: number;          // total rotation since the first frame (deg)
  sectorIndexAtReference: number | null;
  outcomeAtReference: string | null;
  direction: WheelDirection;
  predictedStopAngle: number | null;
  stopAngleUncertaintyDeg: number | null;
  predictedSector: number | null;
  predictedOutcome: string | null;
  referencePointAngle: number;          // the physical reference point (default 0°)
  note: string;
}

export function analyzePosition(
  frames: MotionFrame[],
  direction: DirectionEstimate,
  stopping: StoppingPrediction | null,
  referenceAngle = 0,
): PositionTracking {
  if (frames.length === 0) {
    return {
      currentAngle: 0, currentAngleUnwrapped: 0, angularDisplacement: 0, sectorIndexAtReference: null,
      outcomeAtReference: null, direction: direction.direction, predictedStopAngle: null,
      stopAngleUncertaintyDeg: null, predictedSector: null, predictedOutcome: null,
      referencePointAngle: referenceAngle, note: "NO FRAMES — position unavailable.",
    };
  }
  const first = frames[0];
  const last = frames[frames.length - 1];
  const wrapped = ((last.angle % 360) + 360) % 360;
  const angularDisplacement = last.angle - first.angle;
  const valid = stopping?.isValid ?? false;
  return {
    currentAngle: roundTo(wrapped, 4),
    currentAngleUnwrapped: roundTo(last.angle, 4),
    angularDisplacement: roundTo(angularDisplacement, 4),
    sectorIndexAtReference: last.sectorIndex ?? null,
    outcomeAtReference: last.sectorEstimate ?? null,
    direction: direction.direction,
    predictedStopAngle: valid ? roundTo(stopping!.predictedStopAngle, 4) : null,
    stopAngleUncertaintyDeg: valid ? roundTo(stopping!.angularUncertainty, 4) : null,
    predictedSector: valid ? stopping!.predictedStopSector : null,
    predictedOutcome: valid ? stopping!.predictedStopOutcome : null,
    referencePointAngle: referenceAngle,
    note: valid ? "Stopping trajectory estimated from the live video." : "STOP NOT YET ESTIMABLE (insufficient motion/tracking) — no prediction forced.",
  };
}

// ============================================================
// 7. PHYSICS EVIDENCE (all 8 outcomes, never forced)
// ============================================================

export interface PhysicsDiagnostics {
  direction: WheelDirection;
  directionConfidence: number;
  directionStability: number;
  directionChanges: number;
  speedDegPerSec: number;
  averageSpeed: number;
  peakSpeed: number;
  acceleration: number;
  deceleration: number;
  velocityTrend: number;
  timeToStop: number | null;
  currentAngle: number;
  predictedStopAngle: number | null;
  predictedSector: number | null;
  predictedOutcome: string | null;
  stopAngleUncertaintyDeg: number | null;
  vibration: number;
  noiseLevel: number;
  trackingConfidence: number;
  phaseCorrelationStrength: number;
  opticalFlowStrength: number;
  abnormalFrames: number;
  motionState: MotionState;
  motionStateConfidence: number;
  physicsConfidence: number;
  sampleSize: number;
  windowMs: number;
}

export interface PhysicsEvidence {
  version: string;
  timestamp: number;
  latestUsedTimestamp: number | null;
  evidence: boolean;                       // false → must not influence a prediction
  reason: string;
  outcomeProbabilities: Record<string, number>; // all 8; ALL ZERO when not valid
  physicsConfidence: number;
  sectorProbabilities: number[];           // 54
  direction: DirectionEstimate;
  speed: SpeedProfile;
  vibration: VibrationMetrics;
  motion: MotionAssessment;
  position: PositionTracking;
  diagnostics: PhysicsDiagnostics;
  why: string[];
}

export interface ComputePhysicsEvidenceOptions {
  learnedDeceleration?: number | null;
  referenceAngle?: number;
  windowMs?: number;                       // trailing window used for analysis (default 4000 ms)
  minFrames?: number;                      // default 8
  minConfidence?: number;                  // default 0.15
}

/**
 * Compute pre-result physical evidence for ALL 8 outcomes.
 * No outcome is forced: when the wheel is stopped or tracking is insufficient,
 * `evidence=false` and every probability is 0.
 */
export function computePhysicsEvidence(
  frames: MotionFrame[],
  options: ComputePhysicsEvidenceOptions = {},
): PhysicsEvidence {
  const windowMs = options.windowMs ?? 4000;
  const minFrames = options.minFrames ?? 8;
  const minConfidence = options.minConfidence ?? 0.15;
  const referenceAngle = options.referenceAngle ?? 0;

  const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);
  const lastTs = sorted.length > 0 ? sorted[sorted.length - 1].timestamp : null;
  const windowed = lastTs === null ? [] : sorted.filter((f) => f.timestamp >= lastTs - windowMs);

  const direction = analyzeDirection(windowed);
  const speed = analyzeSpeed(windowed);
  const vibration = analyzeVibration(windowed);
  const motion = classifyMotionState(windowed, speed);

  // Stopping model — reuse the project's validated constant-deceleration model.
  let stopping: StoppingPrediction | null = null;
  if (windowed.length > 0) {
    const last = windowed[windowed.length - 1];
    stopping = predictStoppingAngle(
      {
        timestamp: last.timestamp,
        angle: last.angle,
        velocity: last.velocity,
        acceleration: last.acceleration,
        confidence: last.confidence,
        direction: last.direction,
        isTracking: last.isTracking,
        calibrationStable: last.calibrationStable !== false,
      },
      options.learnedDeceleration ?? (speed.deceleration > 0.5 ? speed.deceleration : null),
    );
  }
  const position = analyzePosition(windowed, direction, stopping, referenceAngle);

  const reasons: string[] = [];
  if (windowed.length < minFrames) reasons.push(`only ${windowed.length} frame(s) in the analysis window (need ≥${minFrames})`);
  if (motion.state === "STOPPED" || motion.state === "IDLE") reasons.push(`wheel state is ${motion.state} — nothing to predict`);
  if (vibration.trackingConfidence < minConfidence) reasons.push(`tracking confidence ${(vibration.trackingConfidence * 100).toFixed(0)}% below floor ${(minConfidence * 100).toFixed(0)}%`);
  if (!stopping || !stopping.isValid) reasons.push(`stopping model invalid (${stopping?.reason ?? "no frames"})`);

  const evidence = reasons.length === 0;
  const outcomeProbabilities: Record<string, number> = Object.fromEntries(OUTCOMES_8.map((o) => [o, 0]));
  let sectorProbabilities: number[] = new Array(54).fill(0) as number[];
  if (evidence && stopping) {
    sectorProbabilities = Array.from(stopping.sectorProbabilities);
    for (const o of OUTCOMES_8) outcomeProbabilities[o] = stopping.outcomeProbabilities[o] ?? 0;
    // The stopping model distributes mass over 54 sectors; mapping sectors to
    // the 8 outcomes can leave a rounding remainder. Re-normalise so the
    // layer always hands the ensemble a proper probability vector (sum = 1),
    // and never amplify rounding noise into a dominant outcome.
    const mass = OUTCOMES_8.reduce((s, o) => s + outcomeProbabilities[o], 0);
    if (mass > 1e-9 && Math.abs(mass - 1) > 1e-9) {
      for (const o of OUTCOMES_8) outcomeProbabilities[o] = outcomeProbabilities[o] / mass;
    }
  }

  const physicsConfidence = evidence && stopping ? clamp01(stopping.physicsConfidence * (0.5 + 0.5 * vibration.trackingConfidence)) : 0;

  const diagnostics: PhysicsDiagnostics = {
    direction: direction.direction,
    directionConfidence: direction.confidence,
    directionStability: direction.stability,
    directionChanges: direction.changes,
    speedDegPerSec: speed.currentSpeed,
    averageSpeed: speed.averageSpeed,
    peakSpeed: speed.peakSpeed,
    acceleration: speed.acceleration,
    deceleration: speed.deceleration,
    velocityTrend: speed.velocityTrend,
    timeToStop: speed.estimatedTimeToStop,
    currentAngle: position.currentAngle,
    predictedStopAngle: position.predictedStopAngle,
    predictedSector: position.predictedSector,
    predictedOutcome: position.predictedOutcome,
    stopAngleUncertaintyDeg: position.stopAngleUncertaintyDeg,
    vibration: vibration.vibrationScore,
    noiseLevel: vibration.noiseLevel,
    trackingConfidence: vibration.trackingConfidence,
    phaseCorrelationStrength: vibration.phaseCorrelationStrength,
    opticalFlowStrength: vibration.opticalFlowStrength,
    abnormalFrames: vibration.abnormalFrames,
    motionState: motion.state,
    motionStateConfidence: motion.confidence,
    physicsConfidence: roundTo(physicsConfidence, 4),
    sampleSize: windowed.length,
    windowMs,
  };

  const why: string[] = [];
  why.push(direction.note);
  why.push(speed.note);
  why.push(motion.reason);
  why.push(vibration.note);
  why.push(
    evidence
      ? `Physical evidence AVAILABLE: predicted stop sector ${position.predictedSector} → ${position.predictedOutcome} (σ=${position.stopAngleUncertaintyDeg?.toFixed(1)}°, physics confidence ${(physicsConfidence * 100).toFixed(0)}%).`
      : `Physical evidence NOT available for this lock: ${reasons.join("; ")}.`,
  );
  why.push("Physics never forces a single outcome: it contributes a full 8-outcome probability vector to the ensemble (and zeros when unavailable).");

  return {
    version: WHEEL_MOTION_VERSION,
    timestamp: lastTs ?? 0,
    latestUsedTimestamp: lastTs,
    evidence,
    reason: evidence ? "ok" : reasons.join("; "),
    outcomeProbabilities,
    physicsConfidence: roundTo(physicsConfidence, 4),
    sectorProbabilities,
    direction,
    speed,
    vibration,
    motion,
    position,
    diagnostics,
    why,
  };
}

// ============================================================
// 8. PRE-RESULT LOCK (leakage-proof by construction)
// ============================================================

export interface PhysicsLockRecord {
  predictionId: string;
  spinId: string;
  kind: "physics-lock";
  lockTimestamp: number;
  latestUsedTimestamp: number | null;
  physicalStopTimestamp: number | null;
  frozenBeforePhysicalStop: boolean;
  predictionTop4: string[];
  all8Scores: Record<string, number>;
  confidence: number;
  direction: WheelDirection;
  diagnostics: PhysicsDiagnostics;
  version: string;
}

/**
 * Freeze the physics prediction BEFORE the physical stop.
 * Refuses (returns null) when the lock would occur at/after the physical stop
 * — that is the structural guarantee against post-stop leakage.
 */
export function lockPhysicsPrediction(input: {
  spinId: string;
  evidenceFrames: MotionFrame[];
  physicalStopTimestamp: number | null;
  lockTimestamp: number;
  top4: string[];
  scores: Record<string, number>;
  options?: ComputePhysicsEvidenceOptions;
}): PhysicsLockRecord | null {
  if (input.physicalStopTimestamp !== null && input.lockTimestamp >= input.physicalStopTimestamp) {
    return null; // leaking a post-stop/stopped-wheel state into a "prediction"
  }
  const frames = input.evidenceFrames.filter((f) => f.timestamp <= input.lockTimestamp);
  const ev = computePhysicsEvidence(frames, input.options);
  const latestUsed = frames.length > 0 ? frames[frames.length - 1].timestamp : null;
  return {
    predictionId: `pp-${input.spinId}-${input.lockTimestamp}`,
    spinId: input.spinId,
    kind: "physics-lock",
    lockTimestamp: input.lockTimestamp,
    latestUsedTimestamp: latestUsed,
    physicalStopTimestamp: input.physicalStopTimestamp,
    frozenBeforePhysicalStop: input.physicalStopTimestamp === null ? false : input.lockTimestamp < input.physicalStopTimestamp,
    predictionTop4: input.top4.slice(0, 4),
    all8Scores: { ...input.scores },
    confidence: ev.physicsConfidence,
    direction: ev.direction.direction,
    diagnostics: ev.diagnostics,
    version: WHEEL_MOTION_VERSION,
  };
}

// ============================================================
// 9. LEARNED DECELERATION (from completed dossiers only — no leakage)
// ============================================================

export interface DecelerationObservation {
  spinId: string;
  deceleration: number;
  endedAt: number;                // physical stop timestamp of that spin
  direction: WheelDirection;
}

/**
 * Estimate the deceleration to use for the CURRENT spin from COMPLETED spins
 * only. `beforeTimestamp` filters out anything that ended at/after the current
 * lock, so no future information can leak in.
 */
export function learnDeceleration(
  observations: DecelerationObservation[],
  beforeTimestamp: number,
  direction?: WheelDirection,
): number | null {
  const usable = observations.filter(
    (o) => o.endedAt < beforeTimestamp && Number.isFinite(o.deceleration) && o.deceleration > 0 && (!direction || direction === "UNKNOWN" || o.direction === direction),
  );
  if (usable.length < 3) return null;
  const values = usable.map((o) => o.deceleration).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

// ============================================================
// 10. DETERMINISTIC SYNTHETIC FRAME BUILDER (mechanism tests only)
// ============================================================

/**
 * Build a deterministic synthetic spin for MECHANISM tests (state machine,
 * direction sign, leakage guard). These frames are NEVER used in validation
 * results or accuracy claims — the validation harness only accepts real
 * settled rounds (`validatePhysicsMechanics()` returns a mechanism report, not
 * an accuracy metric).
 */
export function buildSyntheticSpinFrames(config: {
  spinId: string;
  startTimestamp: number;
  durationMs: number;
  fps?: number;
  peakVelocity: number;      // deg/s (signed: positive = RIGHT/clockwise)
  deceleration: number;      // deg/s² magnitude
  noise?: number;            // jitter amplitude
  seed?: number;
}): MotionFrame[] {
  const fps = config.fps ?? 20;
  const noise = config.noise ?? 1.5;
  const rnd = mulberry32(config.seed ?? 1234);
  const dtMs = 1000 / fps;
  const frames: MotionFrame[] = [];
  const accelPhase = config.durationMs * 0.25;
  const decelPhase = config.durationMs * 0.75;
  const dir = Math.sign(config.peakVelocity) || 1;
  const peak = Math.abs(config.peakVelocity);
  let angle = 0;
  let prevVelocity = 0;
  for (let t = 0; t <= config.durationMs; t += dtMs) {
    const signedT = dir * t;
    let velocity: number;
    if (t <= accelPhase) velocity = dir * peak * (t / accelPhase);
    else {
      const decelT = t - accelPhase;
      const v = Math.max(0, peak - (config.deceleration * decelT) / 1000);
      velocity = dir * v;
    }
    const accel = (velocity - prevVelocity) / (dtMs / 1000);
    prevVelocity = velocity;
    angle += (velocity * dtMs) / 1000 + (rnd() - 0.5) * noise;
    const speed = Math.abs(velocity);
    const tracking = speed > 1 || t < config.durationMs * 0.95;
    frames.push({
      timestamp: config.startTimestamp + t,
      angle,
      angleWrapped: ((angle % 360) + 360) % 360,
      velocity,
      velocityRaw: velocity + (rnd() - 0.5) * noise * 2,
      acceleration: accel,
      confidence: tracking ? 0.85 : 0.1,
      direction: dir > 0 ? 1 : -1,
      isTracking: tracking,
      calibrationStable: true,
      opticalFlowStrength: speed * 0.02,
      phaseCorrelationStrength: tracking ? 0.7 : 0.2,
      profDiff: speed > 50 ? 60 + rnd() * 20 : 5 + rnd() * 5,
      radialMovement: undefined,
      centerDisplacement: undefined,
    });
    void signedT;
    void decelPhase;
    if (t > 0 && velocity === 0 && t > config.durationMs * 0.9) break;
  }
  return frames;
}

export { THEORETICAL_BASE_54 };
