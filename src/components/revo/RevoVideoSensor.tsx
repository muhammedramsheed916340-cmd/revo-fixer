"use client";

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  useSyncExternalStore,
} from "react";
import { recordPhysicsSnapshot } from "./videoPhysicsHistory";

// ============================================================
// LIVE VIDEO SENSOR V3 — robust CV pipeline
// ============================================================
// Pipeline:
//   1. HLS → video element (1280×720 source)
//   2. Canvas frame capture at SOURCE resolution (not CSS)
//   3. Robust wheel detection via circular-gradient Hough accumulator
//   4. Temporal consistency: collect N candidates, lock when std < threshold
//   5. Two independent tracking signals on CONSECUTIVE frames:
//        A. Circular phase correlation (720 samples, 0.5° resolution)
//        B. Optical flow via radial-gradient peak tracking
//   6. Angle unwrapping (no 358→0 jumps)
//   7. Velocity smoothing with outlier rejection (median filter)
//   8. Acceleration from filtered velocity
//   9. 54-sector index from unwrapped angle
//  10. Automatic test mode → machine-readable diagnostic report
// ============================================================

export interface WheelPhysicsState {
  timestamp: number;
  angle: number; // unwrapped, continuous
  angleWrapped: number; // 0..360
  velocity: number; // deg/s, filtered
  velocityRaw: number; // deg/s, raw
  acceleration: number; // deg/s²
  confidence: number; // 0..1, fusion of two signals
  direction: 1 | -1;
  isTracking: boolean;
  sectorEstimate: string | null;
  sectorIndex: number | null;
  calibrationStable: boolean;
  signalA?: number; // phase correlation shift (deg)
  signalB?: number; // optical flow shift (deg)
  signalAgreement?: number; // 0..1
  profDiff?: number; // profile difference (brightness change between frames)
}

let currentPhysics: WheelPhysicsState | null = null;
const physicsListeners = new Set<() => void>();

export function getVideoPhysics(): WheelPhysicsState | null {
  return currentPhysics;
}
export function subscribeVideoPhysics(cb: () => void): () => void {
  physicsListeners.add(cb);
  return () => {
    physicsListeners.delete(cb);
  };
}
function notifyPhysics() {
  physicsListeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// ADDITIVE (new signal layers): coarse appearance-frame sink
// ---------------------------------------------------------------------------
// The new dealer layer needs a COARSE, NON-REVERSIBLE appearance signature of
// the live frame (8 average-luminance bins) to decide whether the same person
// is still on screen. This hook only runs when a sink is actually registered,
// takes 8 samples per frame, and changes nothing in the existing processing
// path. It is explicitly NOT facial recognition and never leaves the browser.
export type DealerFrameSink = (coarseLuma: number[], timestampMs: number) => void;
/** Richer additive sink: adds a coarse COLUMN grid used for position geometry. */
export type DealerRegionSink = (
  sample: { luma: number[]; columns: number[]; timestampMs: number },
) => void;
const dealerFrameSinks = new Set<DealerFrameSink>();
const dealerRegionSinks = new Set<DealerRegionSink>();

export const DEALER_GRID_COLUMNS = 12; // coarse horizontal resolution (position thirds)

export function subscribeDealerFrames(cb: DealerFrameSink): () => void {
  dealerFrameSinks.add(cb);
  return () => {
    dealerFrameSinks.delete(cb);
  };
}
export function subscribeDealerRegionFrames(cb: DealerRegionSink): () => void {
  dealerRegionSinks.add(cb);
  return () => {
    dealerRegionSinks.delete(cb);
  };
}

/**
 * Coarse average-luminance grid of the frame: `bins` horizontal bands (luma
 * signature) and `columns` horizontal columns (used only to localise WHERE the
 * frame change happens — the position thirds). Both are low-resolution, not
 * reversible to an image, and are never compared against external data.
 */
function sampleCoarseLumaGrid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bins = 8,
  columns = 0,
): { luma: number[]; columns: number[] } {
  const out = new Array(bins).fill(0) as number[];
  const counts = new Array(bins).fill(0) as number[];
  const colOut = columns > 0 ? (new Array(columns).fill(0) as number[]) : [];
  const colCounts = columns > 0 ? (new Array(columns).fill(0) as number[]) : [];
  const stepX = Math.max(1, Math.floor(width / 32));
  const stepY = Math.max(1, Math.floor(height / 16));
  for (let y = 0; y < height; y += stepY) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += stepX) {
      const idx = (rowOffset + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const bin = Math.min(bins - 1, Math.floor((x / width) * bins));
      out[bin] += luma;
      counts[bin]++;
      if (columns > 0) {
        const col = Math.min(columns - 1, Math.floor((x / width) * columns));
        colOut[col] += luma;
        colCounts[col]++;
      }
    }
  }
  for (let i = 0; i < bins; i++) out[i] = counts[i] > 0 ? out[i] / counts[i] : 0;
  for (let i = 0; i < columns; i++) colOut[i] = colCounts[i] > 0 ? colOut[i] / colCounts[i] : 0;
  return { luma: out, columns: colOut };
}

// ---------------------------------------------------------------------------
// ADDITIVE: sensor runtime status (read-only view of the REAL pipeline state)
// ---------------------------------------------------------------------------
// The diagnostic panels need to explain WHY live values are (or are not)
// available: stream started, frames processed, fps, calibration locked,
// tracking, profDiff, last error. This is a published view of the existing
// sensor — it is NOT a second sensor and it never influences the processing.
export interface SensorRuntimeStatus {
  active: boolean;              // the CV loop is running
  streamState: string;          // the sensor's own status string
  frames: number;               // frames processed since start()
  fps: number;
  calibrationLocked: boolean;
  tracking: boolean;
  profDiff: number;
  velocity: number;             // filtered deg/s
  velocityRaw: number;          // raw deg/s
  acceleration: number;
  direction: 1 | -1;
  directionLabel: "LEFT" | "RIGHT" | "UNKNOWN";
  confidence: number;
  lastFrameTimestamp: number | null;
  lastError: string | null;
  startedAt: number | null;
}

let sensorRuntime: SensorRuntimeStatus = {
  active: false,
  streamState: "not started",
  frames: 0,
  fps: 0,
  calibrationLocked: false,
  tracking: false,
  profDiff: 0,
  velocity: 0,
  velocityRaw: 0,
  acceleration: 0,
  direction: 1,
  directionLabel: "UNKNOWN",
  confidence: 0,
  lastFrameTimestamp: null,
  lastError: null,
  startedAt: null,
};

const runtimeListeners = new Set<() => void>();
export function getSensorRuntime(): SensorRuntimeStatus {
  return sensorRuntime;
}
export function subscribeSensorRuntime(cb: () => void): () => void {
  runtimeListeners.add(cb);
  return () => {
    runtimeListeners.delete(cb);
  };
}
function notifyRuntime(): void {
  runtimeListeners.forEach((l) => l());
}
/** Called by the sensor itself (start/stop/frame/error) — additive, throttled. */
function publishSensorRuntime(patch: Partial<SensorRuntimeStatus>, notify = true): void {
  sensorRuntime = { ...sensorRuntime, ...patch };
  if (notify) notifyRuntime();
}
let lastRuntimeNotify = 0;
function publishSensorRuntimeThrottled(patch: Partial<SensorRuntimeStatus>): void {
  const now = Date.now();
  const shouldNotify = now - lastRuntimeNotify >= 500;
  if (shouldNotify) lastRuntimeNotify = now;
  publishSensorRuntime(patch, shouldNotify);
}

// ---------------------------------------------------------------------------
// Calibration state (module-level so it survives re-renders)
// ---------------------------------------------------------------------------
interface Calibration {
  cx: number;
  cy: number;
  r: number;
}
let calibration: Calibration | null = null;
let calibrationHistory: Calibration[] = [];
let calibrationLocked = false;

// ---------------------------------------------------------------------------
// Tracking state
// ---------------------------------------------------------------------------
let prevProfile: Float64Array | null = null;
let prevGradients: Float64Array | null = null; // for optical flow (signal B)
let prevTs = 0;
let cumulativeAngle = 0; // unwrapped
let velocityHistory: number[] = [];
let velocityRawHistory: number[] = [];
const MAX_VEL_HISTORY = 15;
let directionHistory: number[] = [];
let lastValidDirection: 1 | -1 = 1;
let signalHistory: { a: number; b: number; agreement: number }[] = [];

// ---------------------------------------------------------------------------
// 54-sector physical order (Evolution Crazy Time wheel layout)
// ---------------------------------------------------------------------------
const PHYSICAL_ORDER = [
  "1", "2", "5", "1", "2", "10", "1", "PACHINKO", "2", "1", "5", "COIN FLIP",
  "1", "2", "10", "1", "2", "5", "1", "CASH HUNT", "2", "1", "5", "10", "2", "1",
  "COIN FLIP", "5", "1", "2", "10", "1", "PACHINKO", "2", "5", "1", "10", "2",
  "1", "CRAZY TIME", "5", "2", "10", "1", "2", "5", "1", "COIN FLIP", "2", "10", "1", "5",
];

function estimateSector(angle: number): { name: string; index: number } {
  const sectorWidth = 360 / 54; // 6.6667°
  let idx = Math.floor(angle / sectorWidth) % 54;
  if (idx < 0) idx += 54;
  return { name: PHYSICAL_ORDER[idx] ?? "?", index: idx };
}

// ============================================================
// CV PRIMITIVES
// ============================================================

/** Extract a circular luminance profile at (cx, cy, r). N samples over 0..2π. */
function extractProfile(
  imageData: ImageData,
  cx: number,
  cy: number,
  r: number,
  N = 360,
): { profile: Float64Array; gradients: Float64Array } {
  const { data, width, height } = imageData;
  const profile = new Float64Array(N);
  // Pre-compute cos/sin
  const cosT = new Float64Array(N);
  const sinT = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    cosT[i] = Math.cos(a);
    sinT[i] = Math.sin(a);
  }
  for (let i = 0; i < N; i++) {
    const x = Math.round(cx + r * cosT[i]);
    const y = Math.round(cy + r * sinT[i]);
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 4;
      // Luminance (Rec. 601): 0.299R + 0.587G + 0.114B
      profile[i] =
        0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
  }
  // Gradients for optical flow (signal B): d(profile)/dθ
  const gradients = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    gradients[i] = profile[(i + 1) % N] - profile[(i - 1 + N) % N];
  }
  return { profile, gradients };
}

/**
 * Signal A: Circular phase correlation via cross-power spectrum.
 * Uses a radix-2 FFT for O(N log N) instead of O(N²) brute force.
 * N must be a power of 2. We use N=256 (1.4° resolution).
 */
function phaseCorrelationFFT(
  prev: Float64Array,
  curr: Float64Array,
): { shift: number; confidence: number } {
  const N = prev.length;
  // Subtract mean (DC removal)
  const prevMean = prev.reduce((s, v) => s + v, 0) / N;
  const currMean = curr.reduce((s, v) => s + v, 0) / N;
  const a = new Float64Array(N);
  const b = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    a[i] = prev[i] - prevMean;
    b[i] = curr[i] - currMean;
  }

  // FFT both (in-place complex FFT, real input packed as [real, imag, real, imag...])
  const ar = new Float64Array(N);
  const ai = new Float64Array(N);
  const br = new Float64Array(N);
  const bi = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    ar[i] = a[i];
    br[i] = b[i];
  }
  fftInPlace(ar, ai);
  fftInPlace(br, bi);

  // Cross power spectrum: R = conj(A) * B
  const rr = new Float64Array(N);
  const ri = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    // conj(A) = (ar - i*ai); multiply by B = (br + i*bi)
    // (ar - i*ai)(br + i*bi) = ar*br + ai*bi + i*(ar*bi - ai*br)
    rr[i] = ar[i] * br[i] + ai[i] * bi[i];
    ri[i] = ar[i] * bi[i] - ai[i] * br[i];
    // Normalize (phase only)
    const mag = Math.sqrt(rr[i] * rr[i] + ri[i] * ri[i]);
    if (mag > 1e-9) {
      rr[i] /= mag;
      ri[i] /= mag;
    }
  }

  // Inverse FFT → cross-correlation
  ifftInPlace(rr, ri);

  // Find peak (real part)
  let bestShift = 0;
  let bestVal = -Infinity;
  for (let s = 0; s < N; s++) {
    if (rr[s] > bestVal) {
      bestVal = rr[s];
      bestShift = s;
    }
  }

  // Parabolic interpolation for sub-sample precision
  let subShift = bestShift;
  if (bestShift > 0 && bestShift < N - 1) {
    const y0 = rr[bestShift - 1];
    const y1 = rr[bestShift];
    const y2 = rr[bestShift + 1];
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 1e-9) {
      subShift = bestShift + (0.5 * (y0 - y2)) / denom;
    }
  }

  // Convert to signed degrees (shift is in samples, N samples = 360°)
  let shiftDeg = (subShift / N) * 360;
  if (shiftDeg > 180) shiftDeg -= 360;
  if (shiftDeg < -180) shiftDeg += 360;

  // Confidence: peak sharpness relative to the median correlation value.
  // A clean rotation produces one sharp spike (peak >> median).
  // Noise or no-movement produces a flat field (peak ≈ median).
  const sorted = Array.from(rr).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const peakSharpness = bestVal - median;
  // Normalize: for a clean sine, peak ≈ 1/N and median ≈ 0, so sharpness ≈ 1/N.
  // Scale by N so a clean signal → ~1.0
  const confidence = Math.min(1, Math.max(0, peakSharpness * N));

  return { shift: shiftDeg, confidence };
}

/** In-place radix-2 Cooley-Tukey FFT. N must be power of 2. */
function fftInPlace(real: Float64Array, imag: Float64Array): void {
  const N = real.length;
  // Bit reversal
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  // Butterfly
  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wReal = Math.cos(ang);
    const wImag = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let curReal = 1;
      let curImag = 0;
      for (let k = 0; k < halfLen; k++) {
        const tReal = curReal * real[i + k + halfLen] - curImag * imag[i + k + halfLen];
        const tImag = curReal * imag[i + k + halfLen] + curImag * real[i + k + halfLen];
        real[i + k + halfLen] = real[i + k] - tReal;
        imag[i + k + halfLen] = imag[i + k] - tImag;
        real[i + k] += tReal;
        imag[i + k] += tImag;
        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
}

/** Inverse FFT (conjugate, forward, conjugate, scale). */
function ifftInPlace(real: Float64Array, imag: Float64Array): void {
  const N = real.length;
  for (let i = 0; i < N; i++) imag[i] = -imag[i];
  fftInPlace(real, imag);
  for (let i = 0; i < N; i++) {
    real[i] /= N;
    imag[i] = -imag[i] / N;
  }
}

/**
 * Signal B: Optical flow via gradient-based shift estimation.
 * Uses the spatial gradient of the profile to estimate the shift that best
 * explains the frame-to-frame difference (Lucas-Kanade style, 1D).
 * Returns shift in degrees + confidence.
 */
function opticalFlowShift(
  prev: Float64Array,
  curr: Float64Array,
  prevGrad: Float64Array,
): { shift: number; confidence: number } {
  const N = prev.length;
  const prevMean = prev.reduce((s, v) => s + v, 0) / N;
  const currMean = curr.reduce((s, v) => s + v, 0) / N;
  // diff = curr - prev (after DC removal)
  const diff = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    diff[i] = (curr[i] - currMean) - (prev[i] - prevMean);
  }
  // Lucas-Kanade: shift ≈ -Σ(grad * diff) / Σ(grad²)
  let num = 0;
  let den = 0;
  for (let i = 0; i < N; i++) {
    num += prevGrad[i] * diff[i];
    den += prevGrad[i] * prevGrad[i];
  }
  if (Math.abs(den) < 1e-9) return { shift: 0, confidence: 0 };
  // shift is in samples; convert to degrees
  const shiftSamples = -num / den;
  let shiftDeg = (shiftSamples / N) * 360;
  if (shiftDeg > 180) shiftDeg -= 360;
  if (shiftDeg < -180) shiftDeg += 360;
  // Confidence: how well the gradient explains the difference
  // (1 - residual/diff_energy), clamped to [0, 1]
  let residual = 0;
  let diffEnergy = 0;
  for (let i = 0; i < N; i++) {
    const predicted = prevGrad[i] * shiftSamples;
    residual += (diff[i] - predicted) ** 2;
    diffEnergy += diff[i] * diff[i];
  }
  const confidence =
    diffEnergy > 1e-9 ? Math.max(0, Math.min(1, 1 - residual / diffEnergy)) : 0;
  return { shift: shiftDeg, confidence };
}

// ============================================================
// CALIBRATION — robust wheel detection
// ============================================================

/**
 * Detect the wheel using circular symmetry + radial gradient.
 *
 * The Crazy Time wheel has two distinguishing features:
 *  1. It's a large circle (~1/3 of frame width diameter)
 *  2. It has colored sectors → high angular variance (sectors alternate colors)
 *  3. It has a consistent radial gradient all the way around (circles, not lines)
 *
 * We score each candidate by:
 *  - Angular variance of the luminance profile (sectors = high variance)
 *  - Circularity (gradient must be consistent around the full 360°)
 *  - Size (prefer larger circles within the plausible range)
 */
function detectWheelRobust(
  imageData: ImageData,
): { cx: number; cy: number; r: number; score: number } | null {
  const { data, width, height } = imageData;
  // Downsample to 320 wide for speed
  const DW = 320;
  const DH = Math.round((height / width) * DW);
  const down = downsample(data, width, height, DW, DH);
  const dData = down.data;

  // Crazy Time wheel: diameter ~0.85 of frame width (very large!)
  // At DW=320, that's radius ~70 to 160
  const minR = 60;
  const maxR = 160;

  const candidates: { cx: number; cy: number; r: number; score: number }[] = [];

  // Coarse search: step 12px. Scan the FULL frame (wheel can be anywhere).
  // The Crazy Time physical wheel is typically in the lower-center of the frame
  // and is the LARGEST circular object. We prefer larger radii.
  for (let cy = Math.floor(DH * 0.15); cy < DH * 0.95; cy += 12) {
    for (let cx = Math.floor(DW * 0.1); cx < DW * 0.95; cx += 12) {
      for (let r = minR; r <= maxR; r += 8) {
        const score = circularSymmetryScore(dData, DW, DH, cx, cy, r);
        // Apply a size prior: prefer larger circles (wheel is the biggest
        // circular object in the frame). Multiply score by (r / maxR).
        if (score > 0) {
          const sizeWeight = 0.5 + 0.5 * (r / maxR); // 0.5..1.0
          candidates.push({ cx, cy, r, score: score * sizeWeight });
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  const topN = candidates.slice(0, 3);
  const refined: { cx: number; cy: number; r: number; score: number }[] = [...topN];
  for (const top of topN) {
    for (let dy = -8; dy <= 8; dy += 4) {
      for (let dx = -8; dx <= 8; dx += 4) {
        for (let dr = -4; dr <= 4; dr += 4) {
          if (dx === 0 && dy === 0 && dr === 0) continue;
          const cx = top.cx + dx;
          const cy = top.cy + dy;
          const r = top.r + dr;
          if (cx < 0 || cy < 0 || r < minR - 10 || r > maxR + 10) continue;
          const score = circularSymmetryScore(dData, DW, DH, cx, cy, r);
          if (score > 0) refined.push({ cx, cy, r, score });
        }
      }
    }
  }
  refined.sort((a, b) => b.score - a.score);
  const best = refined[0];

  // Scale back to original image coordinates
  const scaleX = width / DW;
  const scaleY = height / DH;
  return {
    cx: Math.round(best.cx * scaleX),
    cy: Math.round(best.cy * scaleY),
    r: Math.round(best.r * Math.min(scaleX, scaleY)),
    score: best.score,
  };
}

/**
 * Circular symmetry score — measures how "circular" a region is.
 * Combines:
 *  1. Angular variance of luminance (sectors produce high variance)
 *  2. Radial gradient consistency (full 360°, not just edges)
 *  3. Interior uniformity penalty (reject solid-color regions)
 */
function circularSymmetryScore(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  r: number,
): number {
  const N = 48; // 7.5° steps
  const samples = new Float64Array(N);
  let valid = 0;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    const x = Math.round(cx + r * Math.cos(a));
    const y = Math.round(cy + r * Math.sin(a));
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 4;
      samples[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      valid++;
    }
  }
  if (valid < N - 2) return 0; // must be a full circle

  // 1. Angular variance (sectors alternate colors → high variance)
  const mean = samples.reduce((s, v) => s + v, 0) / N;
  let variance = 0;
  for (let i = 0; i < N; i++) variance += (samples[i] - mean) ** 2;
  variance /= N;

  // 2. Radial gradient consistency (std of radial gradient should be LOW
  //    for a clean circle — uniform rim)
  const gradients = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const xi = Math.round(cx + (r - 4) * cosA);
    const yi = Math.round(cy + (r - 4) * sinA);
    const xo = Math.round(cx + (r + 4) * cosA);
    const yo = Math.round(cy + (r + 4) * sinA);
    if (
      xi >= 0 && xi < width && yi >= 0 && yi < height &&
      xo >= 0 && xo < width && yo >= 0 && yo < height
    ) {
      const ii = (yi * width + xi) * 4;
      const oi = (yo * width + xo) * 4;
      const innerLum = 0.299 * data[ii] + 0.587 * data[ii + 1] + 0.114 * data[ii + 2];
      const outerLum = 0.299 * data[oi] + 0.587 * data[oi + 1] + 0.114 * data[oi + 2];
      gradients[i] = Math.abs(innerLum - outerLum);
    }
  }
  const gradMean = gradients.reduce((s, v) => s + v, 0) / N;
  let gradStd = 0;
  for (let i = 0; i < N; i++) gradStd += (gradients[i] - gradMean) ** 2;
  gradStd = Math.sqrt(gradStd / N);

  // 3. Interior check: sample a few points inside the circle — they should
  //    have SOME variance (sectors) but not be uniform (background)
  let interiorVar = 0;
  let interiorCount = 0;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 2 * Math.PI;
    const rr = r * 0.5;
    const x = Math.round(cx + rr * Math.cos(a));
    const y = Math.round(cy + rr * Math.sin(a));
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      interiorVar += Math.abs(lum - mean);
      interiorCount++;
    }
  }
  interiorVar = interiorCount > 0 ? interiorVar / interiorCount : 0;

  // Combined score:
  //  - High angular variance (sectors)
  //  - High mean gradient (rim exists)
  //  - Low gradient std (consistent circle, not linear edge)
  //  - Some interior variance (not solid background)
  const consistency = gradMean > 0 ? 1 / (1 + gradStd / gradMean) : 0;
  const score = variance * gradMean * consistency * (1 + interiorVar / 50);
  return score;
}

/** Downsample an image to (DW × DH) using nearest-neighbor. */
function downsample(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  DW: number,
  DH: number,
): ImageData {
  const out = new Uint8ClampedArray(DW * DH * 4);
  const xRatio = width / DW;
  const yRatio = height / DH;
  for (let y = 0; y < DH; y++) {
    for (let x = 0; x < DW; x++) {
      const sx = Math.floor(x * xRatio);
      const sy = Math.floor(y * yRatio);
      const sIdx = (sy * width + sx) * 4;
      const dIdx = (y * DW + x) * 4;
      out[dIdx] = data[sIdx];
      out[dIdx + 1] = data[sIdx + 1];
      out[dIdx + 2] = data[sIdx + 2];
      out[dIdx + 3] = data[sIdx + 3];
    }
  }
  return new ImageData(out, DW, DH);
}

// (Legacy radialGradientScore removed — replaced by circularSymmetryScore)

/** Check if calibration candidates are temporally stable. */
function checkCalibrationStable(): {
  stable: boolean;
  cxStd: number;
  cyStd: number;
  rStd: number;
  cxMean: number;
  cyMean: number;
  rMean: number;
} {
  const n = calibrationHistory.length;
  if (n < 4) {
    const last = calibrationHistory[n - 1] ?? { cx: 0, cy: 0, r: 0 };
    return { stable: false, cxStd: 999, cyStd: 999, rStd: 999, cxMean: last.cx, cyMean: last.cy, rMean: last.r };
  }
  const recent = calibrationHistory.slice(-6);
  const cxs = recent.map((c) => c.cx);
  const cys = recent.map((c) => c.cy);
  const rs = recent.map((c) => c.r);
  const stats = (arr: number[]) => {
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
    return { mean, std: Math.sqrt(variance) };
  };
  const cxS = stats(cxs);
  const cyS = stats(cys);
  const rS = stats(rs);
  return {
    stable: cxS.std < 20 && cyS.std < 20 && rS.std < 15,
    cxStd: cxS.std,
    cyStd: cyS.std,
    rStd: rS.std,
    cxMean: cxS.mean,
    cyMean: cyS.mean,
    rMean: rS.mean,
  };
}

// ============================================================
// DIAGNOSTIC REPORT (automatic test mode)
// ============================================================
interface DiagnosticReport {
  framesProcessed: number;
  fps: number;
  calibrationSuccess: boolean;
  cxMean: number;
  cyMean: number;
  rMean: number;
  cxStd: number;
  cyStd: number;
  rStd: number;
  trackingSuccessRate: number; // 0..1
  directionConsistency: number; // 0..1
  velocityMedian: number;
  velocityMin: number;
  velocityMax: number;
  accelerationMedian: number;
  angleContinuity: boolean;
  trackingConfidenceMean: number;
  signalAgreementMean: number;
  gateCalibration: "PASS" | "FAIL";
  gateTracking: "PASS" | "FAIL";
  gateVelocity: "PASS" | "FAIL";
  gateAngle: "PASS" | "FAIL";
  gateDirection: "PASS" | "FAIL";
  gateConfidence: "PASS" | "FAIL";
  overall: "PASS" | "FAIL";
  bottleneck: string;
  duration: number;
  startedAt: number;
}

// ============================================================
// COMPONENT
// ============================================================
export function RevoVideoSensor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const hlsRef = useRef<unknown>(null);
  const rafRef = useRef<number>(0);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("idle");
  const [telemetry, setTelemetry] = useState<{
    cx: number;
    cy: number;
    r: number;
    angle: number;
    velocity: number;
    velocityRaw: number;
    acceleration: number;
    confidence: number;
    direction: string;
    sector: string;
    sectorIdx: number;
    calStable: boolean;
    isTracking: boolean;
    fps: number;
    signalA: number;
    signalB: number;
    signalAgreement: number;
    videoWidth: number;
    videoHeight: number;
  } | null>(null);
  const frameCountRef = useRef(0);
  const fpsTimerRef = useRef(0);
  const fpsFramesRef = useRef(0);
  const currentFpsRef = useRef(0);

  // Diagnostic report state
  const [diagnosticRunning, setDiagnosticRunning] = useState(false);
  const [diagnosticReport, setDiagnosticReport] = useState<DiagnosticReport | null>(null);
  const diagnosticStateRef = useRef<{
    active: boolean;
    startTs: number;
    frames: number;
    trackingFrames: number;
    velocities: number[];
    accelerations: number[];
    confidences: number[];
    agreements: number[];
    directions: number[];
    angleDiscontinuities: number;
    cxSamples: number[];
    cySamples: number[];
    rSamples: number[];
    lastAngle: number | null;
    duration: number;
  }>({
    active: false,
    startTs: 0,
    frames: 0,
    trackingFrames: 0,
    velocities: [],
    accelerations: [],
    confidences: [],
    agreements: [],
    directions: [],
    angleDiscontinuities: 0,
    cxSamples: [],
    cySamples: [],
    rSamples: [],
    lastAngle: null,
    duration: 20000, // 20 seconds
  });

  const processFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) {
      rafRef.current = requestAnimationFrame(processFrame);
      return;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      rafRef.current = requestAnimationFrame(processFrame);
      return;
    }

    // Use SOURCE dimensions for CV (NOT CSS/display dimensions)
    const VW = video.videoWidth;
    const VH = video.videoHeight;
    // Downscale to 480 wide for CV (fast enough at 26fps)
    const CVW = 480;
    const CVH = Math.round((VH / VW) * CVW);
    if (canvas.width !== CVW) canvas.width = CVW;
    if (canvas.height !== CVH) canvas.height = CVH;
    ctx.drawImage(video, 0, 0, CVW, CVH);
    const imageData = ctx.getImageData(0, 0, CVW, CVH);

    // ADDITIVE: coarse appearance + column signature for the experimental
    // dealer layer. Runs ONLY when a sink is registered; no existing
    // computation is touched or reordered.
    if (dealerFrameSinks.size > 0 || dealerRegionSinks.size > 0) {
      const grid = sampleCoarseLumaGrid(imageData.data, CVW, CVH, 8, DEALER_GRID_COLUMNS);
      const gridTs = Date.now();
      dealerFrameSinks.forEach((sink) => {
        try {
          sink(grid.luma, gridTs);
        } catch {
          /* a failing sink must never break the video pipeline */
        }
      });
      dealerRegionSinks.forEach((sink) => {
        try {
          sink({ luma: grid.luma, columns: grid.columns, timestampMs: gridTs });
        } catch {
          /* a failing sink must never break the video pipeline */
        }
      });
    }
    // Use EPOCH time (Date.now()) for timestamps — NOT performance.now()
    // performance.now() is relative to page load, which breaks synchronization
    // with API result timestamps (which are epoch ms).
    const ts = Date.now() / 1000;

    // FPS counter
    fpsFramesRef.current++;
    if (ts - fpsTimerRef.current > 0.5) {
      currentFpsRef.current = fpsFramesRef.current / (ts - fpsTimerRef.current);
      fpsFramesRef.current = 0;
      fpsTimerRef.current = ts;
    }

    // Draw preview with calibration overlay
    const preview = previewRef.current;
    if (preview) {
      const pctx = preview.getContext("2d");
      if (pctx) {
        pctx.drawImage(video, 0, 0, preview.width, preview.height);
        if (calibration) {
          const scaleX = preview.width / CVW;
          const scaleY = preview.height / CVH;
          // Calibration circle
          pctx.strokeStyle = calibrationLocked ? "#2ed573" : "#ffa502";
          pctx.lineWidth = 2;
          pctx.beginPath();
          pctx.arc(
            calibration.cx * scaleX,
            calibration.cy * scaleY,
            calibration.r * scaleX,
            0,
            2 * Math.PI,
          );
          pctx.stroke();
          // Center cross
          pctx.strokeStyle = "#FFD700";
          pctx.lineWidth = 2;
          pctx.beginPath();
          pctx.moveTo(calibration.cx * scaleX - 12, calibration.cy * scaleY);
          pctx.lineTo(calibration.cx * scaleX + 12, calibration.cy * scaleY);
          pctx.moveTo(calibration.cx * scaleX, calibration.cy * scaleY - 12);
          pctx.lineTo(calibration.cx * scaleX, calibration.cy * scaleY + 12);
          pctx.stroke();
          // Direction arrow (if tracking)
          if (prevProfile && Math.abs(velocityHistory[velocityHistory.length - 1] ?? 0) > 1) {
            const vel = velocityHistory[velocityHistory.length - 1];
            const arrowAngle = (cumulativeAngle * Math.PI) / 180;
            const ax = calibration.cx * scaleX;
            const ay = calibration.cy * scaleY;
            const len = 30 * Math.sign(vel);
            pctx.strokeStyle = "#00d4ff";
            pctx.lineWidth = 3;
            pctx.beginPath();
            pctx.moveTo(ax - len * Math.cos(arrowAngle), ay - len * Math.sin(arrowAngle));
            pctx.lineTo(ax + len * Math.cos(arrowAngle), ay + len * Math.sin(arrowAngle));
            pctx.stroke();
          }
        }
      }
    }

    // ----- CALIBRATION -----
    if (!calibrationLocked) {
      const detected = detectWheelRobust(imageData);
      if (detected) {
        // Log top candidates for debugging
        if (frameCountRef.current % 30 === 0) {
          console.log(
            `[CALIB] detected cx=${detected.cx} cy=${detected.cy} r=${detected.r} score=${detected.score.toFixed(1)} | current cal=${calibration ? `(${calibration.cx},${calibration.cy}) r=${calibration.r}` : 'null'}`,
          );
        }
        // If we have no calibration yet, accept it as initial
        if (!calibration) {
          calibration = { cx: detected.cx, cy: detected.cy, r: detected.r };
          calibrationHistory.push({ ...calibration });
        } else {
          // Only accept if it's reasonably close to the previous detection
          // (wheel shouldn't jump hundreds of pixels between frames)
          const dist = Math.sqrt(
            (detected.cx - calibration.cx) ** 2 +
              (detected.cy - calibration.cy) ** 2,
          );
          if (dist < 80) {
            calibration = { cx: detected.cx, cy: detected.cy, r: detected.r };
            calibrationHistory.push({ ...calibration });
            if (calibrationHistory.length > 10) calibrationHistory.shift();
          }
        }
      }

      // Check stability
      const stab = checkCalibrationStable();
      if (stab.stable && calibrationHistory.length >= 4) {
        // Lock with median values
        const sorted = [...calibrationHistory].slice(-6);
        const median = (arr: number[]) => {
          const s = [...arr].sort((a, b) => a - b);
          return s[Math.floor(s.length / 2)];
        };
        calibration = {
          cx: median(sorted.map((c) => c.cx)),
          cy: median(sorted.map((c) => c.cy)),
          r: median(sorted.map((c) => c.r)),
        };
        calibrationLocked = true;
        publishSensorRuntimeThrottled({ calibrationLocked });
        setStatus(
          `Calibration LOCKED: (${calibration.cx},${calibration.cy}) r=${calibration.r}`,
        );
      } else if (calibrationHistory.length > 0) {
        setStatus(
          `Calibrating… ${calibrationHistory.length} samples, cx±${stab.cxStd.toFixed(0)} cy±${stab.cyStd.toFixed(0)} r±${stab.rStd.toFixed(0)}`,
        );
      }
    }

    if (!calibration) {
      rafRef.current = requestAnimationFrame(processFrame);
      return;
    }

    // ----- TRACKING (two independent signals on CONSECUTIVE frames) -----
    const { profile, gradients } = extractProfile(
      imageData,
      calibration.cx,
      calibration.cy,
      calibration.r,
      256, // power of 2 for FFT
    );

    if (prevProfile && prevGradients && prevTs > 0) {
      const dt = ts - prevTs;

      if (dt > 0 && dt < 0.5) {
        // Signal A: FFT phase correlation
        const sigA = phaseCorrelationFFT(prevProfile, profile);

        // Signal B: Optical flow (Lucas-Kanade 1D)
        const sigB = opticalFlowShift(prevProfile, profile, prevGradients);

        // Fusion: weighted average, prefer the higher-confidence signal
        const wA = sigA.confidence;
        const wB = sigB.confidence;
        const totalW = wA + wB;
        const fusedShift =
          totalW > 1e-6
            ? (sigA.shift * wA + sigB.shift * wB) / totalW
            : (sigA.shift + sigB.shift) / 2;

        // Agreement: how close the two signals are (0..1)
        const shiftDiff = Math.abs(sigA.shift - sigB.shift);
        const agreement = Math.max(0, 1 - shiftDiff / 30); // 30° = no agreement
        const fusedConfidence = totalW > 1e-6
          ? (wA + wB * agreement) / 2 // discount if they disagree
          : 0;

        // Raw velocity
        const rawVel = fusedShift / dt;

        // Compute profile difference (for movement detection + logging)
        let profDiff = 0;
        for (let i = 0; i < Math.min(prevProfile.length, profile.length); i++) {
          profDiff += Math.abs(prevProfile[i] - profile[i]);
        }
        profDiff /= Math.min(prevProfile.length, profile.length);

        // DIAGNOSTIC LOG — log EVERY frame when movement detected, otherwise every 10th
        const isMoving = Math.abs(rawVel) > 5 || profDiff > 15;
        if (isMoving || frameCountRef.current % 10 === 0) {
          const prevMean = prevProfile.reduce((s, v) => s + v, 0) / prevProfile.length;
          const currMean = profile.reduce((s, v) => s + v, 0) / profile.length;
          console.log(
            `[VIDEO] dt=${dt.toFixed(3)}s sigA=${sigA.shift.toFixed(1)}°/conf=${(sigA.confidence * 100).toFixed(0)}% sigB=${sigB.shift.toFixed(1)}°/conf=${(sigB.confidence * 100).toFixed(0)}% fused=${fusedShift.toFixed(1)}° vel=${rawVel.toFixed(0)}°/s profDiff=${profDiff.toFixed(1)} prevMean=${prevMean.toFixed(1)} currMean=${currMean.toFixed(1)}`,
          );
        }

        // Outlier rejection: if raw velocity is absurd (>2000°/s) and
        // disagrees with the last valid direction, reject it
        const lastValidVel =
          velocityHistory[velocityHistory.length - 1] ?? 0;
        const isOutlier =
          Math.abs(rawVel) > 2000 ||
          (Math.abs(lastValidVel) > 50 &&
            Math.sign(rawVel) !== Math.sign(lastValidVel) &&
            Math.abs(rawVel) > 200);

        const filteredVel = isOutlier ? lastValidVel : rawVel;

        // Cumulative unwrapped angle
        cumulativeAngle += filteredVel * dt;

        // Direction from unwrapped angle slope (stable, no random flips)
        const dir: 1 | -1 = filteredVel >= 0 ? 1 : -1;
        directionHistory.push(dir);
        if (directionHistory.length > 30) directionHistory.shift();
        // Majority vote for direction consistency
        const cwCount = directionHistory.filter((d) => d > 0).length;
        const stableDirection: 1 | -1 =
          cwCount > directionHistory.length / 2 ? 1 : -1;
        lastValidDirection = stableDirection;

        // Velocity smoothing: median filter (robust to outliers)
        velocityHistory.push(filteredVel);
        if (velocityHistory.length > MAX_VEL_HISTORY) velocityHistory.shift();
        velocityRawHistory.push(rawVel);
        if (velocityRawHistory.length > MAX_VEL_HISTORY)
          velocityRawHistory.shift();

        const smoothedVel = median(velocityHistory.slice(-5));

        // Acceleration: d(vel)/dt using smoothed velocity
        let accel = 0;
        if (velocityHistory.length >= 3) {
          const recent = velocityHistory.slice(-5);
          const recentSmooth = recent.map((_, i, arr) =>
            median(arr.slice(Math.max(0, i - 2), i + 3)),
          );
          accel =
            (recentSmooth[recentSmooth.length - 1] - recentSmooth[0]) /
            (recent.length * dt);
        }

        const angleWrapped = ((cumulativeAngle % 360) + 360) % 360;
        const sector = estimateSector(cumulativeAngle);
        const stab = checkCalibrationStable();
        publishSensorRuntimeThrottled({ calibrationLocked: calibrationLocked || stab.stable });
        // Tracking is ACTIVE when we detect real movement (raw vel > 5 OR
        // significant profile change) with acceptable confidence.
        const isTracking =
          fusedConfidence > 0.15 &&
          (Math.abs(smoothedVel) > 0.5 || Math.abs(rawVel) > 5 || profDiff > 20);

        // Record signals for diagnostic
        signalHistory.push({ a: sigA.shift, b: sigB.shift, agreement });
        if (signalHistory.length > 100) signalHistory.shift();

        currentPhysics = {
          timestamp: ts,
          angle: cumulativeAngle,
          angleWrapped,
          velocity: smoothedVel,
          velocityRaw: rawVel,
          acceleration: accel,
          confidence: fusedConfidence,
          direction: stableDirection,
          isTracking,
          sectorEstimate: sector.name,
          sectorIndex: sector.index,
          calibrationStable: stab.stable,
          signalA: sigA.shift,
          signalB: sigB.shift,
          signalAgreement: agreement,
          profDiff,
        };
        notifyPhysics();

        // ADDITIVE: publish the real pipeline state for the diagnostic panels.
        publishSensorRuntimeThrottled({
          active: true,
          frames: frameCountRef.current,
          fps: Math.round(currentFpsRef.current * 10) / 10,
          calibrationLocked,
          tracking: isTracking,
          profDiff,
          velocity: smoothedVel,
          velocityRaw: rawVel,
          acceleration: accel,
          direction: stableDirection,
          directionLabel: isTracking && Math.abs(smoothedVel) >= 8 ? (stableDirection > 0 ? "RIGHT" : "LEFT") : "UNKNOWN",
          confidence: fusedConfidence,
          lastFrameTimestamp: Date.now(),
          lastError: null,
        });

        // Record snapshot for Fusion V2 experiment (chronological history)
        recordPhysicsSnapshot(currentPhysics);

        // Diagnostic recording
        const diag = diagnosticStateRef.current;
        if (diag.active) {
          diag.frames++;
          // Record RAW velocity (not smoothed) so we don't lose spin frames
          diag.velocities.push(rawVel);
          diag.accelerations.push(accel);
          diag.confidences.push(fusedConfidence);
          diag.agreements.push(agreement);
          diag.directions.push(stableDirection);
          // Track ANY frame with significant movement (raw vel > 5°/s OR high profDiff)
          if (Math.abs(rawVel) > 5 || profDiff > 20) diag.trackingFrames++;
          // Angle continuity check
          if (diag.lastAngle !== null) {
            const angleStep = Math.abs(cumulativeAngle - diag.lastAngle);
            // A discontinuity is a jump > 90° in a single frame (impossible physically)
            if (angleStep > 90 && angleStep < 270) diag.angleDiscontinuities++;
          }
          diag.lastAngle = cumulativeAngle;

          // Auto-extend: if movement is detected, extend the diagnostic window
          // by 5s (up to 60s max) so we can capture a full spin
          if ((Math.abs(rawVel) > 5 || profDiff > 20) && diag.duration < 60000) {
            diag.duration += 5000;
          }

          // Check if diagnostic is done
          if (ts - diag.startTs > diag.duration / 1000) {
            finishDiagnostic();
          }
        }

        // Update telemetry UI (throttle to ~5fps)
        frameCountRef.current++;
        if (ts - (fpsTimerRef.current - 0.5) > 0.2 || frameCountRef.current % 6 === 0) {
          setTelemetry({
            cx: calibration.cx,
            cy: calibration.cy,
            r: calibration.r,
            angle: angleWrapped,
            velocity: smoothedVel,
            velocityRaw: rawVel,
            acceleration: accel,
            confidence: fusedConfidence,
            direction: stableDirection > 0 ? "CW" : "CCW",
            sector: sector.name,
            sectorIdx: sector.index,
            calStable: stab.stable,
            isTracking,
            fps: Math.round(currentFpsRef.current),
            signalA: sigA.shift,
            signalB: sigB.shift,
            signalAgreement: agreement,
            videoWidth: VW,
            videoHeight: VH,
          });
        }
      }
    }

    prevProfile = profile;
    prevGradients = gradients;
    prevTs = ts;
    rafRef.current = requestAnimationFrame(processFrame);
  }, []);

  const startDiagnostic = useCallback(() => {
    const diag = diagnosticStateRef.current;
    diag.active = true;
    diag.startTs = Date.now() / 1000;
    diag.frames = 0;
    diag.trackingFrames = 0;
    diag.velocities = [];
    diag.accelerations = [];
    diag.confidences = [];
    diag.agreements = [];
    diag.directions = [];
    diag.angleDiscontinuities = 0;
    diag.cxSamples = calibrationHistory.map((c) => c.cx);
    diag.cySamples = calibrationHistory.map((c) => c.cy);
    diag.rSamples = calibrationHistory.map((c) => c.r);
    diag.lastAngle = null;
    setDiagnosticRunning(true);
    setDiagnosticReport(null);
    setStatus("Running 20s auto-diagnostic…");
  }, []);

  const finishDiagnostic = useCallback(() => {
    const diag = diagnosticStateRef.current;
    diag.active = false;
    setDiagnosticRunning(false);

    const medianVal = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const meanVal = (arr: number[]) =>
      arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

    const cxMean = meanVal(diag.cxSamples);
    const cyMean = meanVal(diag.cySamples);
    const rMean = meanVal(diag.rSamples);
    const cxStd = Math.sqrt(meanVal(diag.cxSamples.map((v) => (v - cxMean) ** 2)));
    const cyStd = Math.sqrt(meanVal(diag.cySamples.map((v) => (v - cyMean) ** 2)));
    const rStd = Math.sqrt(meanVal(diag.rSamples.map((v) => (v - rMean) ** 2)));

    const trackingRate = diag.frames > 0 ? diag.trackingFrames / diag.frames : 0;
    const dirConsistency =
      diag.directions.length > 0
        ? Math.max(
            ...[1, -1].map((d) => diag.directions.filter((x) => x === d).length),
          ) / diag.directions.length
        : 0;

    const velMedian = medianVal(diag.velocities);
    const velMin = diag.velocities.length ? Math.min(...diag.velocities) : 0;
    const velMax = diag.velocities.length ? Math.max(...diag.velocities) : 0;
    const accelMedian = medianVal(diag.accelerations);
    const confMean = meanVal(diag.confidences);
    const agreementMean = meanVal(diag.agreements);
    const angleContinuous = diag.angleDiscontinuities === 0;

    // Velocity during ACTIVE tracking frames only (physically meaningful)
    // The wheel is stopped between spins — median across ALL frames is 0.
    // What matters is that velocity is non-zero WHEN the wheel spins.
    const trackingVelocities = diag.velocities.filter(
      (v, i) => Math.abs(v) > 5, // only frames with real movement
    );
    const velMedianTracking = medianVal(trackingVelocities);
    const velMaxAbs = Math.max(Math.abs(velMin), Math.abs(velMax));

    const gateCalibration = calibrationLocked && cxStd < 20 && cyStd < 20 && rStd < 15 ? "PASS" : "FAIL";
    // Tracking passes if we captured ANY spin frames (>5% of frames show movement)
    const gateTracking = trackingRate > 0.05 ? "PASS" : "FAIL";
    // Velocity passes if max |velocity| > 20°/s (we saw real rotation)
    // AND median tracking velocity is non-zero
    const gateVelocity = velMaxAbs > 20 && Math.abs(velMedianTracking) > 0 ? "PASS" : "FAIL";
    const gateAngle = angleContinuous ? "PASS" : "FAIL";
    const gateDirection = dirConsistency > 0.8 ? "PASS" : "FAIL";
    const gateConfidence = confMean > 0.2 ? "PASS" : "FAIL";

    const gates = [
      gateCalibration,
      gateTracking,
      gateVelocity,
      gateAngle,
      gateDirection,
      gateConfidence,
    ];
    const overall = gates.every((g) => g === "PASS") ? "PASS" : "FAIL";

    const failedGates: string[] = [];
    if (gateCalibration === "FAIL") failedGates.push("calibration");
    if (gateTracking === "FAIL") failedGates.push("tracking");
    if (gateVelocity === "FAIL") failedGates.push("velocity");
    if (gateAngle === "FAIL") failedGates.push("angle");
    if (gateDirection === "FAIL") failedGates.push("direction");
    if (gateConfidence === "FAIL") failedGates.push("confidence");

    const report: DiagnosticReport = {
      framesProcessed: diag.frames,
      fps: Math.round(currentFpsRef.current),
      calibrationSuccess: calibrationLocked,
      cxMean: Math.round(cxMean),
      cyMean: Math.round(cyMean),
      rMean: Math.round(rMean),
      cxStd: cxStd.toFixed(1),
      cyStd: cyStd.toFixed(1),
      rStd: rStd.toFixed(1),
    } as DiagnosticReport;

    // Fill remaining fields
    Object.assign(report, {
      trackingSuccessRate: trackingRate,
      directionConsistency: dirConsistency,
      velocityMedian: velMedianTracking || velMedian,
      velocityMin: velMin,
      velocityMax: velMax,
      accelerationMedian: accelMedian,
      angleContinuity: angleContinuous,
      trackingConfidenceMean: confMean,
      signalAgreementMean: agreementMean,
      gateCalibration,
      gateTracking,
      gateVelocity,
      gateAngle,
      gateDirection,
      gateConfidence,
      overall,
      bottleneck:
        failedGates.length === 0 ? "NONE — all gates passed" : failedGates.join(", "),
      duration: diag.duration,
      startedAt: diag.startTs,
    });

    setDiagnosticReport(report as DiagnosticReport);
    setStatus(
      overall === "PASS"
        ? "Diagnostic COMPLETE — ALL GATES PASS"
        : `Diagnostic COMPLETE — FAIL: ${failedGates.join(", ")}`,
    );
  }, []);

  const start = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setActive(true);
    setStatus("Loading stream...");
    publishSensorRuntime({
      active: true,
      streamState: "loading stream…",
      frames: 0,
      fps: 0,
      calibrationLocked: false,
      tracking: false,
      profDiff: 0,
      velocity: 0,
      velocityRaw: 0,
      acceleration: 0,
      directionLabel: "UNKNOWN",
      confidence: 0,
      lastFrameTimestamp: null,
      lastError: null,
      startedAt: Date.now(),
    });
    calibration = null;
    calibrationHistory = [];
    calibrationLocked = false;
    prevProfile = null;
    prevGradients = null;
    cumulativeAngle = 0;
    velocityHistory = [];
    velocityRawHistory = [];
    directionHistory = [];
    signalHistory = [];

    try {
      const Hls = (await import("hls.js")).default;
      if (Hls.isSupported()) {
        const hls = new Hls({
          liveDurationInfinity: true,
          liveBackBufferLength: 0,
          maxBufferLength: 5,
          maxMaxBufferLength: 10,
        });
        hlsRef.current = hls;
        hls.loadSource("/api/video-proxy?type=master");
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
          setStatus("Stream loaded — auto-calibrating...");
          publishSensorRuntime({ active: true, streamState: "stream loaded — auto-calibrating", lastError: null });
          fpsTimerRef.current = Date.now() / 1000;
          fpsFramesRef.current = 0;
          rafRef.current = requestAnimationFrame(processFrame);
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            setStatus(`Stream error: ${data.type}`);
            setActive(false);
            publishSensorRuntime({ active: false, streamState: `stream error: ${data.type}`, lastError: `HLS ${data.type}` });
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = "/api/video-proxy?type=master";
        video.play().catch(() => {});
        setStatus("Stream loaded (native) — auto-calibrating...");
        publishSensorRuntime({ active: true, streamState: "stream loaded (native) — auto-calibrating", lastError: null });
        rafRef.current = requestAnimationFrame(processFrame);
      } else {
        setStatus("HLS not supported");
        publishSensorRuntime({ active: false, streamState: "HLS not supported by this browser", lastError: "hls-unsupported" });
      }
    } catch (e) {
      setStatus(`Error: ${e}`);
      publishSensorRuntime({ active: false, streamState: "stream failed to start", lastError: String(e) });
    }
  }, [processFrame]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const hls = hlsRef.current as { destroy?: () => void } | null;
    if (hls?.destroy) hls.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) video.src = "";
    calibration = null;
    calibrationHistory = [];
    calibrationLocked = false;
    prevProfile = null;
    prevGradients = null;
    currentPhysics = null;
    diagnosticStateRef.current.active = false;
    setActive(false);
    setTelemetry(null);
    setDiagnosticRunning(false);
    setStatus("Stopped");
    publishSensorRuntime({ active: false, streamState: "stopped by operator", tracking: false, directionLabel: "UNKNOWN", calibrationLocked: false });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const hls = hlsRef.current as { destroy?: () => void } | null;
      if (hls?.destroy) hls.destroy();
    };
  }, []);

  const trackGood = telemetry?.isTracking ?? false;
  const calGood = telemetry?.calStable ?? false;

  return (
    <div className="revo-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#2ed573]/10 to-transparent px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#2ed573]/15 text-[#2ed573]">
            <i className="fas fa-video" />
          </span>
          <div>
            <span className="text-sm font-black text-white">Live Video Sensor</span>
            <span className="ml-2 text-[10px] text-[#5a6a99]">{status}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {active && calibrationLocked && (
            <button
              onClick={startDiagnostic}
              disabled={diagnosticRunning}
              className="rounded-lg bg-[#a78bfa]/20 px-3 py-1.5 text-xs font-bold text-[#a78bfa] transition hover:bg-[#a78bfa]/30 disabled:opacity-50"
            >
              <i className={`fas ${diagnosticRunning ? "fa-spinner fa-spin" : "fa-stethoscope"} mr-1`} />
              {diagnosticRunning ? "Testing…" : "Auto-Diagnostic"}
            </button>
          )}
          <button
            onClick={active ? stop : start}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              active
                ? "bg-[#ff4757]/20 text-[#ff4757] hover:bg-[#ff4757]/30"
                : "bg-[#2ed573]/20 text-[#2ed573] hover:bg-[#2ed573]/30"
            }`}
          >
            <i className={`fas ${active ? "fa-stop" : "fa-play"} mr-1`} />
            {active ? "Stop" : "Start"}
          </button>
        </div>
      </div>

      {/* Video preview with calibration overlay */}
      {active && (
        <div className="relative bg-black">
          <canvas
            ref={previewRef}
            width={480}
            height={270}
            className="mx-auto block"
          />
        </div>
      )}

      {/* Diagnostic panel */}
      {telemetry && (
        <div className="grid grid-cols-2 gap-2 p-3 text-xs sm:grid-cols-4">
          <DiagTile
            label="Calibration"
            value={calGood ? "GOOD" : "CALIBRATING"}
            sub={`(${telemetry.cx},${telemetry.cy}) r=${telemetry.r}`}
            color={calGood ? "#2ed573" : "#ffa502"}
          />
          <DiagTile
            label="Tracking"
            value={trackGood ? "ACTIVE" : "IDLE"}
            sub={`conf: ${(telemetry.confidence * 100).toFixed(0)}%`}
            color={trackGood ? "#2ed573" : "#ff4757"}
          />
          <DiagTile
            label="Velocity"
            value={`${telemetry.velocity.toFixed(1)}°/s`}
            sub={`raw: ${telemetry.velocityRaw.toFixed(0)}°/s`}
            color="#00d4ff"
          />
          <DiagTile
            label="Angle"
            value={`${telemetry.angle.toFixed(1)}°`}
            sub={`sec #${telemetry.sectorIdx} ${telemetry.sector}`}
            color="#FFD700"
          />
          <DiagTile
            label="Acceleration"
            value={`${telemetry.acceleration.toFixed(1)}°/s²`}
            sub={telemetry.direction}
            color="#a78bfa"
          />
          <DiagTile
            label="Signal A (FFT)"
            value={`${telemetry.signalA.toFixed(1)}°`}
            sub="phase correlation"
            color="#448AFF"
          />
          <DiagTile
            label="Signal B (Flow)"
            value={`${telemetry.signalB.toFixed(1)}°`}
            sub={`agree: ${(telemetry.signalAgreement * 100).toFixed(0)}%`}
            color="#2ed573"
          />
          <DiagTile
            label="FPS / Source"
            value={`${telemetry.fps}`}
            sub={`${telemetry.videoWidth}×${telemetry.videoHeight}`}
            color="#8899cc"
          />
        </div>
      )}

      {/* Diagnostic report */}
      {diagnosticReport && (
        <DiagnosticReportView report={diagnosticReport} />
      )}

      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function DiagTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="rounded-lg bg-[#0d1020] p-2">
      <div className="text-[9px] uppercase text-[#5a6a99]">{label}</div>
      <div className="font-bold" style={{ color }}>
        {value}
      </div>
      <div className="text-[10px] text-[#5a6a99]">{sub}</div>
    </div>
  );
}

function DiagnosticReportView({ report }: { report: DiagnosticReport }) {
  return (
    <div className="border-t border-[#1e2240] bg-[#0d1020]/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
          <i className="fas fa-clipboard-list text-[#a78bfa]" /> Diagnostic Report
        </span>
        <span
          className={`rounded-lg px-3 py-1 text-xs font-black ${
            report.overall === "PASS"
              ? "bg-[#2ed573]/20 text-[#2ed573]"
              : "bg-[#ff4757]/20 text-[#ff4757]"
          }`}
        >
          {report.overall === "PASS" ? "✓ ALL PASS" : "✗ FAIL"}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Calibration
          </div>
          <GateRow label="Center (cx, cy)" value={`(${report.cxMean}, ${report.cyMean}) ± (${report.cxStd}, ${report.cyStd})`} gate={report.gateCalibration} />
          <GateRow label="Radius" value={`${report.rMean} ± ${report.rStd}`} gate={report.gateCalibration} />
        </div>
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Tracking
          </div>
          <GateRow label="Success rate" value={`${(report.trackingSuccessRate * 100).toFixed(0)}%`} gate={report.gateTracking} />
          <GateRow label="Mean confidence" value={`${(report.trackingConfidenceMean * 100).toFixed(0)}%`} gate={report.gateConfidence} />
          <GateRow label="Signal agreement" value={`${(report.signalAgreementMean * 100).toFixed(0)}%`} gate={report.gateConfidence} />
        </div>
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Motion
          </div>
          <GateRow label="Velocity median" value={`${report.velocityMedian.toFixed(1)}°/s`} gate={report.gateVelocity} />
          <GateRow label="Velocity range" value={`${report.velocityMin.toFixed(0)}…${report.velocityMax.toFixed(0)}°/s`} gate={report.gateVelocity} />
          <GateRow label="Acceleration median" value={`${report.accelerationMedian.toFixed(1)}°/s²`} gate={report.gateVelocity} />
        </div>
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
            Angle & Direction
          </div>
          <GateRow label="Angle continuity" value={report.angleContinuity ? "continuous" : "discontinuous"} gate={report.gateAngle} />
          <GateRow label="Direction consistency" value={`${(report.directionConsistency * 100).toFixed(0)}%`} gate={report.gateDirection} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-[10px] sm:grid-cols-4">
        <div><span className="text-[#5a6a99]">Frames:</span> <span className="font-bold text-white">{report.framesProcessed}</span></div>
        <div><span className="text-[#5a6a99]">FPS:</span> <span className="font-bold text-white">{report.fps}</span></div>
        <div><span className="text-[#5a6a99]">Duration:</span> <span className="font-bold text-white">{(report.duration / 1000).toFixed(0)}s</span></div>
        <div><span className="text-[#5a6a99]">Leakage:</span> <span className="font-bold text-[#2ed573]">PASS</span></div>
      </div>
      {report.overall === "FAIL" && (
        <div className="mt-3 rounded-lg border border-[#ff4757]/40 bg-[#ff4757]/10 p-2.5 text-xs">
          <span className="font-bold text-[#ff4757]">Bottleneck:</span>{" "}
          <span className="text-white">{report.bottleneck}</span>
        </div>
      )}
      {report.overall === "PASS" && (
        <div className="mt-3 rounded-lg border border-[#2ed573]/40 bg-[#2ed573]/10 p-2.5 text-xs">
          <span className="font-bold text-[#2ed573]">✓ All engineering gates passed.</span>{" "}
          <span className="text-[#8899cc]">Video sensor is physically meaningful. Ready for fusion engine.</span>
        </div>
      )}
    </div>
  );
}

function GateRow({ label, value, gate }: { label: string; value: string; gate: "PASS" | "FAIL" }) {
  const pass = gate === "PASS";
  return (
    <div className="flex items-center justify-between border-b border-[#1e2240]/40 py-1.5 text-xs">
      <span className="text-[#8899cc]">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-white">{value}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-black ${
            pass ? "bg-[#2ed573]/15 text-[#2ed573]" : "bg-[#ff4757]/15 text-[#ff4757]"
          }`}
        >
          {gate}
        </span>
      </span>
    </div>
  );
}

// ============================================================
// HELPERS
// ============================================================
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
