# Experimental Signal Layers — Implementation & Validation Report

Generated from the actual run artifacts in this repository:

- machine-readable: `scripts/data/signal_validation_report.json`
- human-readable walk-forward report: `SIGNAL_LAYERS_VALIDATION.md`
- mechanism checks: `scripts/verify_signal_layers.ts` → **106 passed · 0 failed**
- walk-forward validation: `scripts/validate_signal_layers.ts` → 500 real rounds (primary) + 1279 real rounds (secondary)

Reproduce:

```bash
node --import ./scripts/ts-resolve-register.mjs scripts/verify_signal_layers.ts
node --import ./scripts/ts-resolve-register.mjs scripts/validate_signal_layers.ts --max-rounds 1279
```

> **Accuracy honesty statement.** 100% is a DEVELOPMENT TARGET, never a guaranteed accuracy claim.
> Every number below is out-of-sample walk-forward evidence from REAL settled rounds already in
> `scripts/data/`. No mock, synthetic or fabricated round is used in any accuracy metric. Where a
> signal has no real data, this report says so instead of inventing a number.

---

## 1. Files created (all additive — nothing existing was deleted, renamed or simplified)

| File | What it adds |
|---|---|
| `src/components/revo/signalStats.ts` | Statistics kernel: Wilson/Agresti-Coull intervals, χ² goodness-of-fit & homogeneity (small-expected pooling), McNemar, calibration bins/ECE, Brier, log-loss, Benjamini–Hochberg, seeded bootstrap CIs, TVD, seeded PRNG |
| `src/components/revo/timeSignal.ts` | **Time layer**: rolling windows (10/25/50/100/250/full) + clock windows (same hour, previous hour, last 2 h / 6 h / 24 h, same time-of-day historical ±30 min, same session-block historical), per-window per-outcome statistics, momentum, transitions, bonus frequency, regime detection, dynamic base estimation |
| `src/components/revo/wheelPhysicsLayer.ts` | **Physics layer**: direction measurement (never hardcoded), speed/accel/decel, 7-state motion machine, vibration/noise/tracking quality, position & stop-angle projection, 8-outcome physics evidence, physics lock |
| `src/components/revo/physicsDossier.ts` | Per-spin physics dossier + prediction ledger with the timestamp contract, duplicate/leakage/completeness audits and the HIT/MISS summary |
| `src/components/revo/dealerSignal.ts` | **Dealer layer**: identity-safety gate, coarse (non-facial) appearance descriptor, persistent dealer profiles, dealer statistics, A/B/C/D/E comparisons, dealer regime gate, dealer × time context |
| `src/components/revo/signalEnsemble.ts` | Fusion of theoretical + history + time + dealer + physics + ML into exactly 4 dynamic outcomes, plus the A–J arm definitions |
| `src/components/revo/signalFlags.ts` | Feature flags (all OFF by default) and the validation gate that refuses to enable a signal without a passed out-of-sample result |
| `src/components/revo/signalValidation.ts` | Strict walk-forward A–J harness: paired comparisons on shared rounds, McNemar, CIs, calibration, leakage/duplicate/timestamp audits, promotion recommendation |
| `src/components/revo/signalDataStore.ts` | The single writer of live data (real rounds, motion frames, dealer observations), live bundle integration, production-prediction publication, store audit |
| `src/components/revo/signalSectorMap.ts` | One canonical sector ↔ outcome ↔ display map shared by the new layers |
| `src/components/revo/RevoTimeSignalPanel.tsx` | UI: CURRENT TIME WINDOW, SAMPLE SIZE, OBSERVED BASE, THEORETICAL BASE, BASE-RATE SHIFT, REGIME STATUS, TIME-SIGNAL CONFIDENCE, all windows, dynamic-base weights, and WHY the time signal did/did not change the prediction |
| `src/components/revo/RevoPhysicsMotionPanel.tsx` | UI: DIRECTION … PREDICTED SECTOR, PHYSICS TOP-4, speed/deceleration profile, per-spin post-mortem (PHYSICS PREDICTION / ACTUAL RESULT / HIT-MISS / ANGLE ERROR / SECTOR ERROR / DIRECTION / SPEED PROFILE / DECELERATION PROFILE) |
| `src/components/revo/RevoDealerPanel.tsx` | UI: CURRENT DEALER, dealer distribution vs baseline (all 8 outcomes), A/B/C/D/E table, DEALER SIGNAL: ACTIVE / INSUFFICIENT / NON-SIGNIFICANT, and the CURRENT DEALER → PHYSICAL WHEEL → TIME WINDOW → FINAL TOP-4 chain |
| `src/components/revo/RevoSignalEnsemblePanel.tsx` | UI: feature-flag controls (refusing to enable without validation), channel table with weights, fused Top-4 + all-8 scores, integrity contract, A–J arms, WHY list |
| `src/components/revo/RevoSignalCollector.tsx` | Headless collector: records settled rounds, motion frames, dealer observations (before the lock) and one leakage-audited physics dossier per completed spin |
| `scripts/validate_signal_layers.ts` | Walk-forward validation runner over the real rounds in `scripts/data/` |
| `scripts/verify_signal_layers.ts` | 106 mechanism assertions (statistics, gating, leakage, determinism, integration) |
| `scripts/ts-resolve-loader.mjs`, `scripts/ts-resolve-register.mjs` | Node TS resolve hook so the new modules can be executed for verification without a bundler |

## 2. Files modified (3 — purely additive, 107 added lines, 0 removed lines)

`git diff --stat` → 3 files changed, 107 insertions(+), 0 deletions(−):

| File | Additive change |
|---|---|
| `src/components/revo/RevoVideoSensor.tsx` | New `DealerFrameSink` / `subscribeDealerFrames` / `sampleCoarseLumaGrid` helper and one guarded call after the existing `getImageData` (runs only when a sink is registered; failures are swallowed). The existing frame processing path is untouched. |
| `src/components/revo/RevoApp.tsx` | Imports + mounts `<RevoSignalCollector />` and the four new diagnostic panels next to the existing experimental panels. |
| `src/components/revo/RevoGame.tsx` | One `useEffect` that PUBLISHES the existing production prediction (Top-4 + per-outcome scores) to the signal store for passthrough/history use. It reads engine output; it never writes back. |

## 3. Existing files preserved

No existing component, API route, database field, validation, audit or safety mechanism was removed,
disabled, renamed, shortened or simplified. In particular the production scorer
(`decisionEngine.ts`), the fusion engine (`fusionEngine.ts`), the ML model (`mlModel.ts`), the video
physics history/predictor, the live-result bus, the shadow A/B experiment in `RevoGame.tsx`, the
existing panels and the Prisma schema are byte-for-byte unchanged. The only type errors reported by
`tsc` on the touched import graph are pre-existing ones in untouched files (`fusionEngine.ts`,
`RevoVideoSensor.tsx` diagnostics cast) that the repository already masks with
`typescript.ignoreBuildErrors: true`.

## 4. New data collected

Live collection (browser, real data only) now writes:

- every REAL settled round with its exact settlement timestamp (duplicates rejected),
- wheel telemetry frames (throttled to ≤10/s) for the physics layer,
- dealer observations identified BEFORE the round settles (public-UI name when the game shows one, plus a coarse 8-bin non-reversible appearance descriptor), attributed to the round before settlement,
- one physics dossier + one prediction record per completed spin, with `latestUsedTimestamp ≤ lockTimestamp < physicalStopTimestamp` enforced and shadow predictions explicitly labelled `shadow: true`.

The walk-forward validation itself uses the REAL rounds already in the repository (no new fake data):
500 benchmark rounds (`final_benchmark_rounds.jsonl`, 2026-09-13T23:39Z → 2026-09-14T07:10Z) and
1279 rounds from `pass179_history.json` (2026-09-10T16:35Z → 2026-09-11T13:48Z, 21.2 h).

## 5. Time-signal results (real data, walk-forward)

| Dataset | Rounds the time signal could act on | Regime statuses observed | Mean confidence | Primary window used |
|---|---|---|---|---|
| benchmark (500) | 468 / 500 | NO_REGIME 410, INSUFFICIENT_DATA 90 | 0.441 | rolling_50 (474), rolling_25 (15), rolling_10 (11) |
| ledger (1279) | 1247 / 1279 | NO_REGIME 1148, **CONFIRMED_REGIME 41**, INSUFFICIENT_DATA 90 | 0.457 | rolling_50 (1253), rolling_25 (15), rolling_10 (11) |

- Time-only arm accuracy: **80.77%** (benchmark, n=468, Wilson [76.95%, 84.08%]) and **83.64%** (ledger, n=1247, Wilson [81.48%, 85.59%]).
- Against the theoretical `[1,2,5,10]` baseline: **−1.07 pp** (benchmark, paired n=468, CI [−3.21, +0.85], McNemar p=0.424) and **−0.08 pp** (ledger, paired n=1247, CI [−1.04, +0.88], McNemar p=1.0).
- The regime detector fired at the strictest setting on the longer, quieter ledger data (41 CONFIRMED_REGIME rounds) and never on the short benchmark — i.e. it is not trivially trigger-happy, and the theoretical 54-sector base is never overwritten (the floor keeps ≥60% weight, or ≥30% only inside a confirmed regime, always with shrinkage).
- Verdict: the time signal is a usable *diagnostic* (it reports the current time window, sample size, observed vs theoretical base, base-rate shift and regime status without touching the model), but it does **not** improve out-of-sample prediction; **it must not be promoted**.

## 6. Dealer-signal results

- Dealers identified in the OFFLINE datasets: **0** (the stored round ledgers contain no video and no public dealer labels), therefore arms D/G that require the dealer channel are reported **UNAVAILABLE** — never fabricated.
- What is verified instead (mechanism level, 106/106 checks): identity-safety rejection of private-data keys, public-name sanitisation, coarse appearance matching that never forces an identity, session handling, pre-settlement-only attribution, A/B/C/D/E comparison machinery, and a regime gate requiring dealer n ≥ 40, baseline n ≥ 100, conclusive χ², p < 0.01, TVD ≥ 0.08 and ≥ 2 agreeing sessions.
- With no dealer identified the dealer signal returns the theoretical base and multipliers of exactly 1 — structurally incapable of influencing a prediction before validation.
- Verdict: **insufficient real data → diagnostic only, flag OFF**.

## 7. Physics / motion results

- Physics evidence in the OFFLINE datasets: **none** (no recorded video frames accompany the stored rounds), so arms E/H/I are reported **UNAVAILABLE**.
- What is verified: direction is measured from the video (LEFT/RIGHT/UNKNOWN with confidence, stability and change count — never hardcoded), 7-state motion classification, speed/acceleration/deceleration/time-to-stop measurement, vibration/abnormal-frame/tracking-confidence metrics, stop-angle projection with uncertainty, an 8-outcome evidence vector (all-zero, not theory, when the evidence is not valid), and a physics lock that is REFUSED at/after the physical stop.
- Verdict: **insufficient real data → diagnostic only, flag OFF**. The panel shows the physics dossier chain so real spins can accumulate evidence for a future validation.

## 8. Ensemble results (A–J, same chronological real rounds)

Primary dataset — `final_benchmark_rounds.jsonl`, 500 real rounds (production Top-4 locked live):

| Arm | n | Hit rate | Wilson 95% | Brier | ECE |
|---|---|---|---|---|---|
| A · theoretical [1,2,5,10] | 500 | **81.60%** | [77.97, 84.75] | 0.7798 | 0.0034 |
| B · existing production engine | 500 | 55.40% | [51.02, 59.70] | 0.9115 | 0.0472 |
| C · time-only | 468 | 80.77% | [76.95, 84.08] | 0.7789 | 0.0010 |
| D · dealer-only | 0 | — | — | — | — |
| E · physics-only | 0 | — | — | — | — |
| F · history + time | 468 | 73.29% | [69.10, 77.10] | 0.8412 | 0.0186 |
| G · history + dealer | 0 | — | — | — | — |
| H · history + physics | 0 | — | — | — | — |
| I · time + dealer + physics | 0 | — | — | — | — |
| J · full ensemble | 500 | 70.80% | [66.67, 74.61] | 0.8581 | 0.0277 |

Secondary dataset — `pass179_history.json`, 1279 real rounds: A 83.89%, C 83.64%, D/E/F/G/H/I/J unavailable (no dealer/physics/video data in that ledger).

## 9. Leakage result → **PASS**

- 500/500 rounds (benchmark) and 1279/1279 rounds (ledger) checked: `latestUsedTimestamp ≤ lockTimestamp < physicalStopTimestamp` for every evaluated prediction; **0 violations**.
- The harness only ever feeds a round's own outcome back after the prediction is frozen; the physics path filters frames to `timestamp ≤ lock` and the physics lock is refused at/after the physical stop; the ledger's strict append rejects `latestUsed > lock`, `lock ≥ physicalStop` and Top-4 sets that are not exactly 4.
- No API-result-arrival time, no post-stop frame, no future timestamp and no retrospective correction is allowed anywhere in the new code paths.

## 10. Duplicate result → **PASS**

- Duplicate audit: 0 duplicates on both datasets (unique `roundId`/`spinId`, monotonic settlement times).
- Live writers independently reject a repeated settlement (same `sector-time` key), a non-epoch timestamp and an unknown sector, so a stale or repeated result can never be counted twice.

## 11. Out-of-sample accuracy (real rounds, walk-forward)

- Theoretical `[1,2,5,10]`: **81.60%** (500 rounds) / **83.89%** (1279 rounds), Wilson lower bound 77.97% / 81.78%.
- Production engine (its own live locks): **55.40%** (500 rounds) — 26.20 pp *below* the theoretical baseline (CI [−31.00, −20.80], McNemar p < 1e-6).
- Time-only: 80.77% / 83.64%; history+time: 73.29%; full ensemble: 70.80%.
- Dealer-only and physics-only: **not measurable yet** (0 real observations).

## 12. Statistical significance

- Time-only vs theoretical: Δ = −1.07 pp (benchmark, CI [−3.21, +0.85], p = 0.424) and Δ = −0.08 pp (ledger, CI [−1.04, +0.88], p = 1.0) → **not significant, and not positive**.
- Time-only vs production: Δ = +26.07 pp (CI [21.15, 31.41], p < 1e-6) → significant, but that only restates that the production scorer is below the theoretical floor.
- Full ensemble vs theoretical: Δ = −10.80 pp (CI [−15.00, −6.80], p = 1e-6) → significantly WORSE.
- Paired comparisons require ≥200 paired rounds; the family-wise error rate is controlled with Benjamini–Hochberg across evaluated pairs; every reported effect carries its sample size, CI and a McNemar verdict (or an explicit `INCONCLUSIVE` when discordant pairs < 10).

## 13. Is any signal justified for production? → **NO**

| Signal | Flag (default OFF) | Gate verdict |
|---|---|---|
| TIME_SIGNAL | OFF | NOT PROMOTABLE — does not beat the theoretical `[1,2,5,10]` baseline (Δ = −1.07 pp over 468 paired rounds) |
| DEALER_SIGNAL | OFF | NOT PROMOTABLE — 0 real dealer observations; needs ≥200 paired rounds |
| PHYSICS_SIGNAL | OFF | NOT PROMOTABLE — 0 real physics observations; needs ≥200 paired rounds |
| FUSION | OFF | NOT PROMOTABLE — Δ = −10.80 pp vs the theoretical baseline over 500 paired rounds |

`setSignalFlag(flag, true)` is *refused* by the gate until a registered validation outcome shows
≥200 paired rounds, a positive CI-supported delta against BOTH the production engine and the
theoretical baseline, McNemar p < 0.05 and clean leakage/duplicate/timestamp audits
(`forceEnableSignalFlag` exists for local debugging only and records an explicit NOT-validated
override). Diagnostic data collection continues with every flag OFF, so real time/dealer/physics
evidence can accumulate for a future re-validation.

### Defects found and fixed by this work (not by loosening tests)

1. `chiSquareHomogeneity` pooled small-expected cells INTO neighbouring columns, which could collapse the
   contingency table to a single column and report an obvious distribution shift as `p = 1.0000`
   (inconclusive). It now pools them into one extra "other" column — this is what allowed the regime
   detector to report its first 41 CONFIRMED_REGIME rounds on the 1279-round ledger.
2. `computePhysicsEvidence` now re-normalises its 8-outcome vector (the 54 sector → 8 outcome mapping
   left a rounding remainder, e.g. 0.99997) so the ensemble always receives a true probability vector.

### Notes on identity safety

The dealer layer only ever stores: an internal `dealerId`, the public display name when the game UI
itself shows one, a table/game id when exposed, timestamps, session boundaries, and a coarse 8-bin
luminance descriptor that is explicitly NOT facial recognition. There is no external-database
lookup, no private-data scraping and no inference of sensitive personal attributes; unsafe keys are
rejected outright by `assertIdentitySafety`.
