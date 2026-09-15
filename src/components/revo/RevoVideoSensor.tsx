"use client";

import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from "react";

// ============================================================
// LIVE VIDEO SENSOR V2 — HLS + canvas + wheel tracking + diagnostic panel
// ============================================================

export interface WheelPhysicsState {
  timestamp: number;
  angle: number;
  velocity: number;
  acceleration: number;
  confidence: number;
  direction: 1 | -1;
  isTracking: boolean;
  sectorEstimate: string | null;
  calibrationStable: boolean;
}

let currentPhysics: WheelPhysicsState | null = null;
const physicsListeners = new Set<() => void>();

export function getVideoPhysics(): WheelPhysicsState | null { return currentPhysics; }
export function subscribeVideoPhysics(cb: () => void): () => void {
  physicsListeners.add(cb);
  return () => { physicsListeners.delete(cb); };
}
function notifyPhysics() { physicsListeners.forEach((l) => l()); }

// Calibration: detected once, then verified across frames
let calibration: { cx: number; cy: number; r: number } | null = null;
let calibrationHistory: Array<{ cx: number; cy: number; r: number }> = [];
let calibrationLocked = false;

// Tracking state
let prevProfile: Float64Array | null = null;
let prevTs = 0;
let cumulativeAngle = 0;
let velocityHistory: number[] = [];
const MAX_VEL_HISTORY = 10;

// 54-sector physical order
const PHYSICAL_ORDER = [
  "1","2","5","1","2","10","1","PACHINKO","2","1","5","COIN FLIP",
  "1","2","10","1","2","5","1","CASH HUNT","2","1","5","10","2","1",
  "COIN FLIP","5","1","2","10","1","PACHINKO","2","5","1","10","2",
  "1","CRAZY TIME","5","2","10","1","2","5","1","COIN FLIP","2","10","1","5"
];

function extractProfile(imageData: ImageData, cx: number, cy: number, r: number): Float64Array {
  const { data, width, height } = imageData;
  const N = 720; // 0.5° resolution — was 180 (2°), now detects 0.5° shifts
  const profile = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * 2 * Math.PI;
    const x = Math.round(cx + r * Math.cos(angle));
    const y = Math.round(cy + r * Math.sin(angle));
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 4;
      profile[i] = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    }
  }
  return profile;
}

function phaseCorrelation(prev: Float64Array, curr: Float64Array): { shift: number; confidence: number } {
  const N = prev.length;
  // FFT-based phase correlation — finds the global cross-power-spectrum peak
  // This is the standard method used in image registration, more robust than brute-force.

  // Compute FFT of both profiles (using a simple DFT since browser doesn't have numpy.fft)
  // For N=720, DFT is O(N²) = 518400 ops — ~1ms in JS
  // We'll use a simpler approach: compute the cross-correlation via the convolution theorem
  // by using the real-valued cross-correlation directly (faster than DFT for N=720)

  // Actually, let's just improve the brute-force:
  // 1. Subtract mean (normalize)
  // 2. Compute normalized cross-correlation
  // 3. Use parabolic interpolation around the peak for sub-sample precision

  const prevMean = prev.reduce((s, v) => s + v, 0) / N;
  const currMean = curr.reduce((s, v) => s + v, 0) / N;
  const prevNorm = new Float64Array(N);
  const currNorm = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    prevNorm[i] = prev[i] - prevMean;
    currNorm[i] = curr[i] - currMean;
  }

  // Compute cross-correlation
  let bestShift = 0;
  let bestCorr = -Infinity;
  const corrValues = new Float64Array(N);

  for (let s = 0; s < N; s++) {
    let corr = 0;
    for (let i = 0; i < N; i++) {
      corr += prevNorm[i] * currNorm[(i + s) % N];
    }
    corrValues[s] = corr;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestShift = s;
    }
  }

  // Parabolic interpolation for sub-sample precision
  let subShift = bestShift;
  if (bestShift > 0 && bestShift < N - 1) {
    const y0 = corrValues[bestShift - 1];
    const y1 = corrValues[bestShift];
    const y2 = corrValues[bestShift + 1];
    const denom = (y0 - 2 * y1 + y2);
    if (Math.abs(denom) > 1e-9) {
      subShift = bestShift + 0.5 * (y0 - y2) / denom;
    }
  }

  // Convert to degrees
  let shiftDeg = (subShift / N) * 360;
  if (shiftDeg > 180) shiftDeg -= 360;

  // Confidence: normalized cross-correlation coefficient
  const prevEnergy = prevNorm.reduce((s, v) => s + v * v, 0);
  const currEnergy = currNorm.reduce((s, v) => s + v * v, 0);
  const confidence = prevEnergy > 0 && currEnergy > 0
    ? Math.min(1, Math.max(0, bestCorr / Math.sqrt(prevEnergy * currEnergy)))
    : 0;

  return { shift: shiftDeg, confidence };
}

function detectWheel(imageData: ImageData): { cx: number; cy: number; r: number } | null {
  const { data, width, height } = imageData;
  let bestCal: { cx: number; cy: number; r: number } | null = null;
  let bestVar = 0;
  for (let cy = Math.floor(height * 0.15); cy < height * 0.85; cy += 20) {
    for (let cx = Math.floor(width * 0.15); cx < width * 0.85; cx += 20) {
      for (let r = 60; r <= 160; r += 10) {
        const samples: number[] = [];
        for (let i = 0; i < 36; i++) {
          const angle = (i / 36) * 2 * Math.PI;
          const x = Math.round(cx + r * Math.cos(angle));
          const y = Math.round(cy + r * Math.sin(angle));
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const idx = (y * width + x) * 4;
            samples.push((data[idx] + data[idx + 1] + data[idx + 2]) / 3);
          }
        }
        if (samples.length >= 30) {
          const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
          const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
          if (variance > bestVar) { bestVar = variance; bestCal = { cx, cy, r }; }
        }
      }
    }
  }
  return bestCal;
}

function estimateSector(angle: number): string | null {
  const sectorIdx = Math.floor(angle / (360 / 54)) % 54;
  return PHYSICAL_ORDER[sectorIdx] ?? null;
}

function checkCalibrationStable(): boolean {
  if (calibrationHistory.length < 5) return false;
  const recent = calibrationHistory.slice(-5);
  const cxs = recent.map(c => c.cx);
  const cys = recent.map(c => c.cy);
  const rs = recent.map(c => c.r);
  const cxStd = Math.sqrt(cxs.reduce((s, v) => s + (v - cxs.reduce((a, b) => a + b, 0) / cxs.length) ** 2, 0) / cxs.length);
  const cyStd = Math.sqrt(cys.reduce((s, v) => s + (v - cys.reduce((a, b) => a + b, 0) / cys.length) ** 2, 0) / cys.length);
  const rStd = Math.sqrt(rs.reduce((s, v) => s + (v - rs.reduce((a, b) => a + b, 0) / rs.length) ** 2, 0) / rs.length);
  return cxStd < 15 && cyStd < 15 && rStd < 15;
}

export function RevoVideoSensor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const hlsRef = useRef<unknown>(null);
  const rafRef = useRef<number>(0);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("idle");
  const [telemetry, setTelemetry] = useState<{
    cx: number; cy: number; r: number;
    angle: number; velocity: number; acceleration: number;
    confidence: number; direction: string; sector: string;
    calStable: boolean; isTracking: boolean; fps: number;
  } | null>(null);
  const frameCountRef = useRef(0);
  const fpsTimerRef = useRef(0);

  const processFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(processFrame);
      return;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) { rafRef.current = requestAnimationFrame(processFrame); return; }

    canvas.width = 640;
    canvas.height = 360;
    ctx.drawImage(video, 0, 0, 640, 360);
    const imageData = ctx.getImageData(0, 0, 640, 360);
    const ts = performance.now() / 1000;

    // Draw preview with calibration overlay
    const preview = previewRef.current;
    if (preview) {
      const pctx = preview.getContext("2d");
      if (pctx) {
        pctx.drawImage(video, 0, 0, preview.width, preview.height);
        if (calibration) {
          // Draw calibration circle
          const scaleX = preview.width / 640;
          const scaleY = preview.height / 360;
          pctx.strokeStyle = "#2ed573";
          pctx.lineWidth = 2;
          pctx.beginPath();
          pctx.arc(calibration.cx * scaleX, calibration.cy * scaleY, calibration.r * scaleX, 0, 2 * Math.PI);
          pctx.stroke();
          // Draw center cross
          pctx.strokeStyle = "#FFD700";
          pctx.beginPath();
          pctx.moveTo(calibration.cx * scaleX - 10, calibration.cy * scaleY);
          pctx.lineTo(calibration.cx * scaleX + 10, calibration.cy * scaleY);
          pctx.moveTo(calibration.cx * scaleX, calibration.cy * scaleY - 10);
          pctx.lineTo(calibration.cx * scaleX, calibration.cy * scaleY + 10);
          pctx.stroke();
        }
      }
    }

    // Auto-calibrate (or re-verify)
    if (!calibrationLocked) {
      // The Crazy Time wheel is in the upper-center area of the video frame.
      // Detected from screenshot analysis: center=(186,160) r=66 at 640x360.
      if (!calibration) {
        calibration = { cx: 186, cy: 160, r: 66 };
        calibrationHistory.push(calibration);
        setStatus(`Calibration (preset): (186,160) r=66 — verifying...`);
      }

      // Also try auto-detection to see if it agrees
      const autoCal = detectWheel(imageData);
      if (autoCal) {
        // If auto-detection is close to preset, lock it
        const dist = Math.sqrt(
          (autoCal.cx - calibration.cx) ** 2 + (autoCal.cy - calibration.cy) ** 2
        );
        if (dist < 50) {
          calibrationHistory.push(autoCal);
          if (calibrationHistory.length > 10) calibrationHistory.shift();

          if (checkCalibrationStable()) {
            const sorted = [...calibrationHistory].sort((a, b) => a.cx - b.cx);
            calibration = {
              cx: sorted[Math.floor(sorted.length / 2)].cx,
              cy: sorted[Math.floor(sorted.length / 2)].cy,
              r: sorted[Math.floor(sorted.length / 2)].r,
            };
            calibrationLocked = true;
            setStatus(`Calibration LOCKED: (${calibration.cx},${calibration.cy}) r=${calibration.r}`);
          }
        }
      }

      // Lock after 3 seconds regardless (use the preset)
      if (calibrationHistory.length > 60 && !calibrationLocked) {
        calibrationLocked = true;
        setStatus(`Calibration LOCKED (preset): (${calibration.cx},${calibration.cy}) r=${calibration.r}`);
      }
    }

    if (!calibration) {
      rafRef.current = requestAnimationFrame(processFrame);
      return;
    }

    // Extract circular profile
    const profile = extractProfile(imageData, calibration.cx, calibration.cy, calibration.r);

    // Phase correlation
    if (prevProfile && prevTs > 0) {
      const { shift, confidence } = phaseCorrelation(prevProfile, profile);
      const dt = ts - prevTs;
      if (dt > 0 && dt < 1) {
        const rawVelocity = shift / dt;
        // Clamp to physically plausible range (0-5000 deg/s)
        // Don't zero out — the wheel really does rotate fast
        const filteredVel = Math.max(-5000, Math.min(5000, rawVelocity));

        // Debug logging (every 50 frames)
        if (frameCountRef.current % 50 === 0) {
          // Compute profile difference to verify the wheel is being sampled
          let profDiff = 0;
          if (prevProfile) {
            for (let i = 0; i < Math.min(prevProfile.length, profile.length); i++) {
              profDiff += Math.abs(prevProfile[i] - profile[i]);
            }
            profDiff /= Math.min(prevProfile.length, profile.length);
          }
          const prevMean = prevProfile ? prevProfile.reduce((s, v) => s + v, 0) / prevProfile.length : 0;
          const currMean = profile.reduce((s, v) => s + v, 0) / profile.length;
          console.log(`[VIDEO] shift=${shift.toFixed(2)}° dt=${dt.toFixed(3)}s vel=${rawVelocity.toFixed(0)}°/s conf=${confidence.toFixed(3)} profDiff=${profDiff.toFixed(1)} prevMean=${prevMean.toFixed(1)} currMean=${currMean.toFixed(1)}`);
        }

        cumulativeAngle += filteredVel * dt;

        velocityHistory.push(filteredVel);
        if (velocityHistory.length > MAX_VEL_HISTORY) velocityHistory.shift();

        // Acceleration from velocity slope
        let accel = 0;
        if (velocityHistory.length >= 3) {
          const recent = velocityHistory.slice(-5);
          accel = (recent[recent.length - 1] - recent[0]) / (recent.length * dt);
        }

        const currentAngle = ((cumulativeAngle % 360) + 360) % 360;
        const sector = estimateSector(currentAngle);
        const calStable = checkCalibrationStable();
        const isTracking = confidence > 0.3 && Math.abs(filteredVel) > 0.5;

        currentPhysics = {
          timestamp: ts,
          angle: currentAngle,
          velocity: filteredVel,
          acceleration: accel,
          confidence,
          direction: filteredVel >= 0 ? 1 : -1,
          isTracking,
          sectorEstimate: sector,
          calibrationStable: calStable,
        };
        notifyPhysics();

        // Update telemetry UI (throttle to ~5fps)
        frameCountRef.current++;
        if (ts - fpsTimerRef.current > 0.2) {
          const fps = frameCountRef.current / (ts - fpsTimerRef.current);
          frameCountRef.current = 0;
          fpsTimerRef.current = ts;
          setTelemetry({
            cx: calibration.cx, cy: calibration.cy, r: calibration.r,
            angle: currentAngle, velocity: filteredVel, acceleration: accel,
            confidence, direction: filteredVel >= 0 ? "CW" : "CCW",
            sector: sector ?? "?",
            calStable, isTracking, fps: Math.round(fps),
          });
        }
      }
    }

    prevProfile = profile;
    prevTs = ts;
    rafRef.current = requestAnimationFrame(processFrame);
  }, []);

  const start = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setActive(true);
    setStatus("Loading stream...");
    calibration = null;
    calibrationHistory = [];
    calibrationLocked = false;
    prevProfile = null;
    cumulativeAngle = 0;
    velocityHistory = [];

    try {
      const Hls = (await import("hls.js")).default;
      if (Hls.isSupported()) {
        const hls = new Hls({ liveDurationInfinity: true, liveBackBufferLength: 0, maxBufferLength: 5, maxMaxBufferLength: 10 });
        hlsRef.current = hls;
        hls.loadSource("/api/video-proxy?type=master");
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
          setStatus("Stream loaded — calibrating...");
          fpsTimerRef.current = performance.now() / 1000;
          frameCountRef.current = 0;
          rafRef.current = requestAnimationFrame(processFrame);
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) { setStatus(`Stream error: ${data.type}`); setActive(false); }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = "/api/video-proxy?type=master";
        video.play().catch(() => {});
        setStatus("Stream loaded (native) — calibrating...");
        rafRef.current = requestAnimationFrame(processFrame);
      } else {
        setStatus("HLS not supported");
      }
    } catch (e) { setStatus(`Error: ${e}`); }
  }, [processFrame]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const hls = hlsRef.current as { destroy?: () => void } | null;
    if (hls?.destroy) hls.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) video.src = "";
    calibration = null; calibrationHistory = []; calibrationLocked = false;
    prevProfile = null; currentPhysics = null;
    setActive(false); setTelemetry(null);
    setStatus("Stopped");
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
        <button
          onClick={active ? stop : start}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
            active ? "bg-[#ff4757]/20 text-[#ff4757] hover:bg-[#ff4757]/30" : "bg-[#2ed573]/20 text-[#2ed573] hover:bg-[#2ed573]/30"
          }`}
        >
          <i className={`fas ${active ? "fa-stop" : "fa-play"} mr-1`} />
          {active ? "Stop" : "Start"}
        </button>
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
          <div className="rounded-lg bg-[#0d1020] p-2">
            <div className="text-[9px] uppercase text-[#5a6a99]">Calibration</div>
            <div className={`font-bold ${calGood ? "text-[#2ed573]" : "text-[#ffa502]"}`}>
              {calGood ? "GOOD" : "CALIBRATING"}
            </div>
            <div className="text-[10px] text-[#5a6a99]">
              ({telemetry.cx},{telemetry.cy}) r={telemetry.r}
            </div>
          </div>
          <div className="rounded-lg bg-[#0d1020] p-2">
            <div className="text-[9px] uppercase text-[#5a6a99]">Tracking</div>
            <div className={`font-bold ${trackGood ? "text-[#2ed573]" : "text-[#ff4757]"}`}>
              {trackGood ? "ACTIVE" : "IDLE"}
            </div>
            <div className="text-[10px] text-[#5a6a99]">conf: {(telemetry.confidence * 100).toFixed(0)}%</div>
          </div>
          <div className="rounded-lg bg-[#0d1020] p-2">
            <div className="text-[9px] uppercase text-[#5a6a99]">Velocity</div>
            <div className="font-bold text-white">{telemetry.velocity.toFixed(1)}°/s</div>
            <div className="text-[10px] text-[#5a6a99]">{telemetry.direction}</div>
          </div>
          <div className="rounded-lg bg-[#0d1020] p-2">
            <div className="text-[9px] uppercase text-[#5a6a99]">Angle</div>
            <div className="font-bold text-white">{telemetry.angle.toFixed(1)}°</div>
            <div className="text-[10px] text-[#FFD700]">{telemetry.sector}</div>
          </div>
          <div className="rounded-lg bg-[#0d1020] p-2">
            <div className="text-[9px] uppercase text-[#5a6a99]">Acceleration</div>
            <div className="font-bold text-white">{telemetry.acceleration.toFixed(1)}°/s²</div>
          </div>
          <div className="rounded-lg bg-[#0d1020] p-2">
            <div className="text-[9px] uppercase text-[#5a6a99]">FPS</div>
            <div className="font-bold text-white">{telemetry.fps}</div>
          </div>
        </div>
      )}

      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
