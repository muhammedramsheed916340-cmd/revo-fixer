# Live Dealer + Wheel Physics + Prediction UI — Wiring Report

Commit: **e66ab65** (branch `arena/01a0bafa-revo-fixer`) · earlier commits in this effort: `06ae48e`, `c34e721`, `cee7cf9`
Reproduce everything below:

```bash
node --import ./scripts/ts-resolve-register.mjs scripts/verify_signal_layers.ts       # 147 mechanism checks
node --import ./scripts/ts-resolve-register.mjs scripts/render_signal_panels.ts       # 15 real-DOM render checks
node --import ./scripts/ts-resolve-register.mjs scripts/validate_signal_layers.ts --max-rounds 1279
for f in tests/revo/*.test.ts; do node --import ./scripts/ts-resolve-register.mjs "$f"; done   # 81 existing tests
```

Everything here is **additive**: no existing feature, engine, validation, UI, API, DB field,
audit or safety mechanism was deleted, disabled, simplified or replaced. No dealer name, wheel
direction, speed, physics value or prediction is fabricated anywhere — when real data is missing the
UI shows `UNKNOWN` / `INSUFFICIENT` **with the exact reason**.

---

## 1. Root cause

Six independent wiring defects, each of which alone was enough to keep live values off the screen:

1. **The collector was never mounted.** `RevoSignalCollector` (the only writer of live data into the
   experimental store) was written but not rendered by `RevoApp`, so the store stayed empty → dealer
   profile, physics evidence and ensemble channels all reported "no data".
2. **Unit mismatch (the decisive physics bug).** The live sensor stamps `WheelPhysicsState.timestamp`
   with `Date.now() / 1000` — **epoch seconds** — while every analysis window, dedupe and threshold in
   the new layers works in **milliseconds**. Every "frames in the last 20 s" query therefore returned
   nothing → physics always `INSUFFICIENT` → no physics Top-4, ever.
3. **No sensor-status visibility.** Nothing exposed whether the CV loop was running, calibrated,
   tracking, or had died with a stream error, so "no values" could not be attributed to a stage.
4. **No dealer position model existed** at all — the panel had nothing to show for LEFT/CENTER/RIGHT.
5. **No feed from the production pre-result snapshot buffer.** The new layers only saw frames that
   passed through their own hook; they never read the sensor's own `snapshotBuffer`
   (`getPhysicsInRange`) that the production pipeline already maintains.
6. **Availability was implicit.** The ensemble table showed "on/off" and "real/none" but never an
   explicit `READY`/`INSUFFICIENT` state with the reason, so a missing channel looked like silence.

## 2. Files changed (all additive — 0 lines deleted)

| File | Change |
|---|---|
| `src/components/revo/RevoSignalCollector.tsx` | Rewritten as the live bridge (mounts in `RevoApp`): telemetry frames → store, sensor pre-result buffer → store, dealer observation with position geometry before each round, one physics dossier + shadow prediction per completed spin |
| `src/components/revo/RevoVideoSensor.tsx` | **+** `subscribeDealerRegionFrames` (12-column coarse luminance grid), `SensorRuntimeStatus` + `getSensorRuntime`/`subscribeSensorRuntime` published by the existing loop (start/stop/stream/error/calibration/frame stats). No existing line changed |
| `src/components/revo/signalDataStore.ts` | Frame dedupe by timestamp, throttled frame notifications (~4/s), `toEpochMs` normalisation on write, `ingestLivePhysicsBuffer()` / `syncLiveFrames()`, dealer-profile persistence (`revo_dealerProfiles_v1`), `observeDealer()` position plumbing |
| `src/components/revo/wheelPhysicsLayer.ts` | **+** `toEpochMs()`, `rotationReadout()` (measured direction/speed/confidence, sign-agreement check, UNKNOWN reasons), `ROTATION_DIRECTION_MIN_DEG_PER_SEC`, `frameFromSensorState()` emits ms |
| `src/components/revo/dealerSignal.ts` | **+** `DealerPosition`, `estimateDealerPosition()` (frame-change localisation over screen thirds, confidence-gated), position stored per profile (`current`, `counts`, `lastReason`), `exportDealerProfiles()`/`importDealerProfiles()` |
| `src/components/revo/signalEnsemble.ts` | **+** explicit `status: READY \| INSUFFICIENT` on every channel; INSUFFICIENT channels always carry weight 0 and their reason |
| `src/components/revo/RevoLiveSensorDebugPanel.tsx` | **NEW** expandable LIVE SENSOR DEBUG panel (video → motion → wheel/timeline → dealer → prediction → all-8 scores) |
| `src/components/revo/RevoPhysicsMotionPanel.tsx` | **+** WHEEL ROTATION block (direction/speed/raw speed/confidence/tracking/acceleration + sensor status line), live frame sync |
| `src/components/revo/RevoDealerPanel.tsx` | **+** dealer name (UNKNOWN when unnamed), profile id, MEASURED position + confidence + reason, identification tiles |
| `src/components/revo/RevoSignalEnsemblePanel.tsx` | **+** READY/INSUFFICIENT column, live-vs-shadow mode banner |
| `src/components/revo/RevoTimeSignalPanel.tsx`, `SignalPanelFrame.tsx`, `RevoApp.tsx` | mount the debug panel, lint-clean simple memo deps (TSPanel/frame mounted earlier) |
| `scripts/bun-test-shim.mjs` | **NEW** — runs the repo's existing `bun:test` suites under plain Node (bun is not installed here) |
| `scripts/render_signal_panels.ts` | **NEW** — real-DOM (jsdom) render test of the panels |
| `scripts/ts-resolve-loader.mjs` | maps `bun:test` → shim, resolves `index.js` |
| `scripts/verify_signal_layers.ts` | +60 live-pipeline checks (147 total) |
| `LIVE_PIPELINE_FIX_REPORT.md` | this report |

## 3. Data-flow fix (the traced path)

```
LIVE HLS  (/api/video-proxy → hls.js, unchanged)
  → RevoVideoSensor.processFrame            (unchanged CV: FFT phase correlation + optical flow)
      ├─ currentPhysics  ──► notifyPhysics() ──► collector.recordMotionFrame(frameFromSensorState(...))
      │                        (seconds→ms normalised here and in the store)
      ├─ recordPhysicsSnapshot (production pre-result buffer, ms)
      │                        └─► collector.syncLiveFrames() → ingestLivePhysicsBuffer()  [idempotent]
      └─ coarse frame grid (8 luma bins + 12 columns) ──► dealer position thirds
  → signalDataStore (single writer, dedupe, 2000 rounds / 24 000 frames)
  → wheelPhysicsLayer.computePhysicsEvidence(frames ≤ lock)  ──► 8-outcome vector + diagnostics
  → physicsDossier (dossier + prediction record, timestamp contract enforced)
  → dealerSignal.computeDealerSignal(dealerId identified BEFORE the lock)
  → signalEnsemble.fuseSignals(...)  ──► dynamic Top-4 (shadow) / production passthrough (live)
  → RevoGame publishes the production Top-4 → ensemble passthrough + history channel
Rendering: every panel subscribes with useSyncExternalStore to the SAME live state — no second
sensor, no localStorage polling, no page refresh.
```

## 4. Live sensor values observed

**Honest limitation first:** this sandbox has no browser and cannot reach the stream host
(`live101.egprom.com` is unreachable; only GitHub is), so I could not watch the casino feed myself.
Instead the identical rendering path was exercised in a real DOM (jsdom + the app's React 19 runtime)
with real store writes, and the cold-start path was verified to refuse to invent data:

| Scenario | Observed UI output |
|---|---|
| Cold start (no stream, no rounds, no dealer) | `video INACTIVE`, `frames 0`, `0.0 fps`, `cal UNLOCKED`, `Tracking IDLE`, rotation `UNKNOWN (no tracking)`, physics `INSUFFICIENT`, dealer *"No dealer profile yet"*, no LEFT/RIGHT invented |
| Simulated live pipeline (60 real rounds, seconds-stamped 120 °/s rotation, dealer frame geometry) | rotation **RIGHT · ~120 °/s · conf 100%**, `Speed 120.0 °/s`, `Raw speed 118.0 °/s`, `Acceleration -4.0 °/s²`, motion state reported, dealer **profile `dealer-…` · name UNKNOWN · position RIGHT (conf …)** , `63 rounds` stored, channels `READY/INSUFFICIENT` |

The debug panel now prints, live: stream state, frame count, FPS, calibration, tracking, profDiff,
raw/filtered velocity, acceleration, direction, motion state, dealer + position, physics VALID/
INSUFFICIENT, lock/latest-used/physical-stop timestamps and the reason string.

## 5. Dealer detection status

- Identification chain: public-UI name (only when the game shows one) → coarse 8-bin appearance
  descriptor → **new profile, never a forced identity**. Names are never invented.
- **Measured position**, not hardcoded: the frame is reduced to 12 coarse column luminances and the
  frame-to-frame change is localised into screen thirds; a third must own ≥50 % of the change energy
  (and the frame must carry ≥0.02 mean |Δluma|) or the answer is `UNKNOWN` with the reason
  ("change is spread across the frame…", "waiting for a second frame…", "frame change too small…").
- Profiles persist across reloads (`revo_dealerProfiles_v1`) so a dealer keeps the same id while the
  visual identity stays consistent.
- Identity safety unchanged: no private-data keys, no external databases, no sensitive attributes,
  no biometric templates (the descriptor is 8 coarse luminance bins).

## 6. Wheel direction status

- Direction is **measured** from per-frame unwrapped-angle deltas together with the signed
  velocities, with an explicit threshold (`ROTATION_DIRECTION_MIN_DEG_PER_SEC = 8 °/s`):
  `> threshold → RIGHT`, `< −threshold → LEFT`, otherwise `UNKNOWN` (idle / untracked / insufficient).
- The sensor's own sign is cross-checked against the measured Δangle; a contradiction is surfaced as
  `signAgreement=false` instead of being trusted silently. Nothing is inferred from the last result.
- Verified: idle → UNKNOWN with reason; +120 °/s → RIGHT; −120 °/s → LEFT; contradicting sign detected.

## 7. Wheel speed status

- Displayed live: filtered speed, raw speed, acceleration, direction confidence, tracking state,
  20-second moving-frame count — plus the sensor line (frames/fps/calibration/profDiff/stream state).
- Spike handling is inherited from the production sensor (outlier rejection + median smoothing); the
  layer additionally requires `isTracking` and treats sub-threshold motion as *not rotating*.
- When tracking is unavailable the UI shows `INSUFFICIENT` and the exact reason, never a fake `0 °/s`.

## 8. Physics prediction status

- Evidence is computed **only** from frames with `timestamp ≤ lockTimestamp`; the lock is refused at
  or after the physical stop, and the store/ledger audits re-check the contract afterwards.
- Each valid record carries: predictionId, spinId, lock/latestUsed/physicalStop/actualResult
  timestamps, currentAngle, angular velocity, acceleration, deceleration, predicted stopping angle,
  angular error, sector error, confidence, Top-4 and all 8 probabilities.
- If there are not enough valid moving frames the layer returns an ALL-ZERO vector with the reason and
  the UI prints `PHYSICS INSUFFICIENT: <reason>` — it never falls back to `[1,2,5,10]`.
- **Fixed this round:** the epoch-seconds/ms mismatch that made every window empty (reason #2 above).

## 9. Top-4 status

- All 8 outcomes are always evaluated from real evidence; the Top-4 is selected by fused probability
  with a deterministic tie-break — no fixed `[1,2,5,10]`, no forced bonus, no random selection, no
  rotation, no last-result chasing, no protected outcome.
- With the physics evidence valid the physics-only Top-4 is produced (verified: exactly 4 distinct
  outcomes). With no valid evidence the panel shows `INSUFFICIENT` instead of a set.
- The **production** Top-4 is untouched: the experimental ensemble runs as *shadow* (weights only,
  flags overridden inside the call) while the real flags stay OFF, so the live prediction shown by
  RevoGame is exactly what the production scorer produced before this work.

## 10. Leakage audit

| Check | Result |
|---|---|
| Walk-forward harness (real rounds) | 500 benchmark + 1279 ledger rounds — **0 leakage violations**, 0 duplicate, 0 timestamp problems, integrity PASS |
| Prediction ledger | `latestUsed ≤ lock < physicalStop` enforced on append; lock at/after the physical stop **rejected** (verified) |
| Frame windows | physics evidence and the panels filter `timestamp ≤ lock` / last-20 s only; no post-stop, no API-arrival time, no future frame |
| Dealer attribution | observations are recorded before the round settles; post-settlement attribution is **rejected** |
| Shadow records | explicitly flagged `shadow: true` + `SHADOW:` mode prefix; they are visible in the ledger but never influence production |

## 11. Test results

| Suite | Result |
|---|---|
| Mechanism checks (`scripts/verify_signal_layers.ts`) | **147 passed · 0 failed** |
| Real-DOM render checks (`scripts/render_signal_panels.ts`) | **15 passed · 0 failed** |
| Existing repo suites (`tests/revo/*`, via the `bun:test` shim) | **81 passed · 0 failed** (8 files) |
| TypeScript (strict config, all new/changed files) | clean — only pre-existing errors remain in untouched code (`fusionEngine.ts`, one pre-existing cast in `RevoVideoSensor.tsx:1309`) |
| ESLint | clean on every new/touched file (the 3 remaining warnings are pre-existing in `RevoGame.tsx`/`RevoVideoSensor.tsx`, confirmed identical at `HEAD~`) |
| Walk-forward validation | unchanged — audits PASS, all four flags **NOT PROMOTABLE** |
| Vercel builds (3 projects: `revo-fixer`, `revo-fixer-ai8n`, `revo-fixerramshi`) | all **success** for commit `e66ab65` |

**Live browser test — what I could and could not do:** I cannot open a browser or reach the HLS host
from this environment, so I did not watch the casino stream. The closest faithful substitute was run
instead: the actual panel components rendered in a real DOM with the real store API, proving that
(a) a cold start shows honest `INACTIVE/UNKNOWN/INSUFFICIENT` values and no invented data, and
(b) after live data arrives the UI updates **without a reload** and displays direction, speed, dealer
profile, measured position and channel availability. The remaining unknown is purely whether your
browser can fetch the stream — the debug panel now tells you at a glance (`video ACTIVE/INACTIVE`,
frames, fps, calibration, and the stream error string if HLS fails). Press **Start** on the Live
Video Sensor panel to begin; the panels follow it automatically.

## 12. Commit hash

**`e66ab65`** — `fix(revo): normalise telemetry timestamps (epoch seconds → ms) so live physics
evidence is never empty` (preceded by `06ae48e` pipeline wiring, `c34e721` hydration fix, `cee7cf9`
initial additive layers). Pushed to `arena/01a0bafa-revo-fixer`; PR #1 into `main` is open and
Vercel has built all three projects successfully for this commit.

> No accuracy claim is made anywhere: the layers remain diagnostic/flag-OFF until a walk-forward
> validation shows a measurable, statistically-supported out-of-sample improvement.
