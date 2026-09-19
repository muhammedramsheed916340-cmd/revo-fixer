# Signal Layers — Walk-Forward Validation Report

Generated: 2026-09-19T19:28:47.568Z
Harness version: signal-validation-v1.0
Dataset(s): final_benchmark_rounds.jsonl (500 rounds, production locks stored live)
Rounds evaluated: **500** real settled rounds
Window: 2026-09-13T23:39:26.841Z → 2026-09-14T07:10:36.940Z

## Arms (all evaluated on the SAME chronological rounds)

| Arm | Rounds | Hits | Hit rate | Wilson 95% | Bootstrap 95% | Brier | ECE | Bonus incl. |
|---|---|---|---|---|---|---|---|---|
| A · theoretical [1,2,5,10] | 500 | 408 | 81.60% | [77.97%, 84.75%] | [78.20%, 84.80%] | 0.7798 | 0.0034 | 0.00% |
| B · existing production history engine | 500 | 277 | 55.40% | [51.02%, 59.70%] | [51.20%, 59.60%] | 0.9115 | 0.0472 | 160.00% |
| C · time-only | 468 | 378 | 80.77% | [76.95%, 84.08%] | [76.92%, 84.19%] | 0.7789 | 0.0010 | 29.70% |
| D · dealer-only | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |
| E · physics-only | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |
| F · history + time | 468 | 343 | 73.29% | [69.10%, 77.10%] | [69.02%, 77.35%] | 0.8412 | 0.0186 | 121.15% |
| G · history + dealer | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |
| H · history + physics | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |
| I · time + dealer + physics | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |
| J · full ensemble | 500 | 354 | 70.80% | [66.67%, 74.61%] | [66.80%, 74.60%] | 0.8581 | 0.0277 | 129.00% |

**Arms without real data (NOT fabricated):**
- D · dealer-only: NO REAL DATA for dealer channel(s) — arm not evaluated (never fabricated).
- E · physics-only: NO REAL DATA for physics channel(s) — arm not evaluated (never fabricated).
- G · history + dealer: NO REAL DATA for dealer channel(s) — arm not evaluated (never fabricated).
- H · history + physics: NO REAL DATA for physics channel(s) — arm not evaluated (never fabricated).
- I · time + dealer + physics: NO REAL DATA for time, dealer, physics channel(s) — arm not evaluated (never fabricated).

## Paired comparisons (McNemar on discordant rounds)

| Comparison | Paired n | A-only | B-only | Δ (pp) | Bootstrap CI on Δ | McNemar p | Verdict |
|---|---|---|---|---|---|---|---|
| C (time-only) vs B (production) | 468 | 153 | 31 | 26.07 | [21.15, 31.41] | 0 | SIGNIFICANT |
| F (history+time) vs B (production) | 468 | 98 | 11 | 18.59 | [14.74, 22.65] | 0 | SIGNIFICANT |
| D (dealer-only) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| G (history+dealer) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| E (physics-only) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| H (history+physics) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| I (time+dealer+physics) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| J (full ensemble) vs B (production) | 500 | 88 | 11 | 15.40 | [11.80, 19.20] | 0 | SIGNIFICANT |
| J (full ensemble) vs F (history+time) | 468 | 0 | 10 | -2.14 | [-3.63, -0.85] | 0.004427 | SIGNIFICANT |
| C (time-only) vs A (theoretical) | 468 | 10 | 15 | -1.07 | [-3.21, 0.85] | 0.423711 | not significant |
| F (history+time) vs A (theoretical) | 468 | 28 | 68 | -8.55 | [-12.61, -4.49] | 0.000069 | SIGNIFICANT |
| D (dealer-only) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| G (history+dealer) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| E (physics-only) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| H (history+physics) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| I (time+dealer+physics) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| B (production) vs A (theoretical) | 500 | 33 | 164 | -26.20 | [-31.00, -20.80] | 0 | SIGNIFICANT |
| J (full ensemble) vs A (theoretical) | 500 | 30 | 84 | -10.80 | [-15.00, -6.80] | 0.000001 | SIGNIFICANT |

## Time-signal diagnostics during the walk-forward

- Regime status counts: {"INSUFFICIENT_DATA":90,"NO_REGIME":410}
- Rounds where the time signal was ACTIVE: 468/500
- Mean time-signal confidence: 44.1%
- Mean primary-window sample: 47.45
- Primary window usage: {"rolling_10":11,"rolling_25":15,"rolling_50":474}

## Audits

- Duplicate audit: PASS
- Timestamp audit: PASS (monotonic)
- Leakage audit: PASS — 500 rounds checked
- Overall integrity: PASS

## Promotion gate (feature flags stay OFF unless this passes)

- **TIME_SIGNAL**: NOT PROMOTABLE — does NOT beat the theoretical [1,2,5,10] baseline (Δ=-1.07 pp over 468 paired rounds)
- **DEALER_SIGNAL**: NOT PROMOTABLE — arm has no real data on this dataset; only 0 rounds (need ≥200); no paired comparison available vs B_history; no paired comparison available vs the theoretical [1,2,5,10] baseline
- **PHYSICS_SIGNAL**: NOT PROMOTABLE — arm has no real data on this dataset; only 0 rounds (need ≥200); no paired comparison available vs B_history; no paired comparison available vs the theoretical [1,2,5,10] baseline
- **FUSION**: NOT PROMOTABLE — does NOT beat the theoretical [1,2,5,10] baseline (Δ=-10.80 pp over 500 paired rounds)

> Evaluated 500 real settled rounds. Promotion requires ≥200 paired rounds with a positive, CI-supported out-of-sample delta and clean audits.

> 100% accuracy is a DEVELOPMENT TARGET, never a guarantee. Walk-forward results are out-of-sample for the model but come from a historical dataset; a genuine promotion additionally requires fresh live paired rounds. No signal is promoted on a small sample, and the production scorer is untouched until a promotion gate passes.


---

# Secondary dataset

Generated: 2026-09-19T19:28:49.693Z
Harness version: signal-validation-v1.0
Dataset(s): pass179_history.json (1279 rounds, live baseline ledger)
Rounds evaluated: **1279** real settled rounds
Window: 2026-09-10T16:35:12.914Z → 2026-09-11T13:48:42.048Z

## Arms (all evaluated on the SAME chronological rounds)

| Arm | Rounds | Hits | Hit rate | Wilson 95% | Bootstrap 95% | Brier | ECE | Bonus incl. |
|---|---|---|---|---|---|---|---|---|
| A · theoretical [1,2,5,10] | 1279 | 1073 | 83.89% | [81.78%, 85.81%] | [81.86%, 85.93%] | 0.7519 | 0.0062 | 0.00% |
| B · existing production history engine | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |
| C · time-only | 1247 | 1043 | 83.64% | [81.48%, 85.59%] | [81.72%, 85.65%] | 0.7529 | 0.0042 | 20.37% |
| D · dealer-only | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |
| E · physics-only | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |
| F · history + time | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |
| G · history + dealer | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |
| H · history + physics | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |
| I · time + dealer + physics | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |
| J · full ensemble | 0 | 0 | 0.00% | [0.00%, 100.00%] | [0.00%, 100.00%] | — | — | — |

**Arms without real data (NOT fabricated):**
- B · existing production history engine: NO REAL DATA for history channel(s) — arm not evaluated (never fabricated).
- D · dealer-only: NO REAL DATA for dealer channel(s) — arm not evaluated (never fabricated).
- E · physics-only: NO REAL DATA for physics channel(s) — arm not evaluated (never fabricated).
- F · history + time: NO REAL DATA for history, time channel(s) — arm not evaluated (never fabricated).
- G · history + dealer: NO REAL DATA for history, dealer channel(s) — arm not evaluated (never fabricated).
- H · history + physics: NO REAL DATA for history, physics channel(s) — arm not evaluated (never fabricated).
- I · time + dealer + physics: NO REAL DATA for time, dealer, physics channel(s) — arm not evaluated (never fabricated).
- J · full ensemble: NO REAL DATA for history channel(s) — arm not evaluated (never fabricated).

## Paired comparisons (McNemar on discordant rounds)

| Comparison | Paired n | A-only | B-only | Δ (pp) | Bootstrap CI on Δ | McNemar p | Verdict |
|---|---|---|---|---|---|---|---|
| C (time-only) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| F (history+time) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| D (dealer-only) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| G (history+dealer) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| E (physics-only) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| H (history+physics) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| I (time+dealer+physics) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| J (full ensemble) vs B (production) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| J (full ensemble) vs F (history+time) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| C (time-only) vs A (theoretical) | 1247 | 19 | 20 | -0.08 | [-1.04, 0.88] | 1 | not significant |
| F (history+time) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| D (dealer-only) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| G (history+dealer) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| E (physics-only) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| H (history+physics) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| I (time+dealer+physics) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| B (production) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |
| J (full ensemble) vs A (theoretical) | 0 | 0 | 0 | 0.00 | [0.00, 0.00] | 1 | NOT EVALUATED |

## Time-signal diagnostics during the walk-forward

- Regime status counts: {"INSUFFICIENT_DATA":90,"NO_REGIME":1148,"CONFIRMED_REGIME":41}
- Rounds where the time signal was ACTIVE: 1247/1279
- Mean time-signal confidence: 45.7%
- Mean primary-window sample: 49
- Primary window usage: {"rolling_10":11,"rolling_25":15,"rolling_50":1253}

## Audits

- Duplicate audit: PASS
- Timestamp audit: PASS (monotonic)
- Leakage audit: PASS — 1279 rounds checked
- Overall integrity: PASS

## Promotion gate (feature flags stay OFF unless this passes)

- **TIME_SIGNAL**: NOT PROMOTABLE — no paired comparison available vs B_history; does NOT beat the theoretical [1,2,5,10] baseline (Δ=-0.08 pp over 1247 paired rounds)
- **DEALER_SIGNAL**: NOT PROMOTABLE — arm has no real data on this dataset; only 0 rounds (need ≥200); no paired comparison available vs B_history; no paired comparison available vs the theoretical [1,2,5,10] baseline
- **PHYSICS_SIGNAL**: NOT PROMOTABLE — arm has no real data on this dataset; only 0 rounds (need ≥200); no paired comparison available vs B_history; no paired comparison available vs the theoretical [1,2,5,10] baseline
- **FUSION**: NOT PROMOTABLE — arm has no real data on this dataset; only 0 rounds (need ≥200); no paired comparison available vs B_history; no paired comparison available vs the theoretical [1,2,5,10] baseline

> Evaluated 1279 real settled rounds. Promotion requires ≥200 paired rounds with a positive, CI-supported out-of-sample delta and clean audits.

> 100% accuracy is a DEVELOPMENT TARGET, never a guarantee. Walk-forward results are out-of-sample for the model but come from a historical dataset; a genuine promotion additionally requires fresh live paired rounds. No signal is promoted on a small sample, and the production scorer is untouched until a promotion gate passes.
