# DIAGNOSTIC REPORT — Top-4 Coverage Optimization (Pre-Code)

**Status:** Diagnostic complete. **No production code modified.** (Per spec §14.)
**Validation dataset:** `scripts/data/pass282_history.json` — **178 walk-forward rounds** (baseline-mode, the LIVE engine's actual locked predictions vs actuals; no data leakage in the settlement lifecycle).
**Date:** 2026-09-13
**Monitoring cron 369099:** DELETED (surveillance stopped per directive).

---

## 0. Headline result

| Benchmark | HIT | Rate | vs Theoretical |
|---|---|---|---|
| **A. Current dynamic (baseline, LIVE)** | 118/178 | **66.29 %** | **−19.66 pp** |
| **B. Experimental (reliability layer ON, replay)** | 125/178 | **70.22 %** | −15.73 pp |
| **C. Theoretical [1,2,5,10]** | 153/178 | **85.96 %** | — (bar) |
| **D. Random Top-4 (analytical)** | — | 50.00 % | −35.96 pp |

The current dynamic model **loses to the trivial theoretical baseline by ~20 percentage points** and barely beats random selection. The experimental reliability layer (B) recovers only **4 of 60 misses** — it exists in code but is **OFF in production** (Shadow A/B disabled for 281+ consecutive monitoring passes) and, even when forced ON, is structurally insufficient.

### Dynamic × Theoretical contingency (the clean separation)

| | Theo HIT | Theo MISS |
|---|---|---|
| **Dyn HIT** | 112 | 6 (covered a bonus [1,2,5,10] missed) |
| **Dyn MISS** | **41 — AVOIDABLE model failure** | 19 — unavoidable bonus-actual |

- **60 dynamic misses = 41 avoidable + 19 unavoidable.**
- **41 misses** = a NUMBER (1/2/5/10) was the actual result but was excluded from Top-4 — [1,2,5,10] would have HIT. Pure model failure.
- **19 misses** = a bonus was the actual and neither model covered it — unavoidable on a 4-slot budget (you cannot cover all 4 bonuses).
- The engine trades **41 guaranteed number-hits for 6 bonus-hits**. Net −35 vs theoretical.

### Realistic ceiling (honesty check)

On these 178 rounds, 19 misses are an unavoidable floor (10.7 %) because covering every bonus-actual would require predicting the exact bonus each spin. **The realistic, honestly-claimable ceiling ≈ 86 %** (matching theoretical [1,2,5,10], plus a small edge if bonus timing were genuinely predictable — which the data shows it is NOT). **100 % is not mathematically achievable on random rounds**; it remains a development *direction*, not a guaranteed outcome (per §12). Any future claim of improvement must come from a frozen walk-forward run of 100-200 *fresh* rounds (§11), never from retrospective replay.

---

## 1. Dominant cause of current MISSes

**Rare/bonus outcomes are over-included in Top-4 and displace higher-prior numbers.**

Per-outcome inclusion vs actual coverage (baseline, stored 178 rounds):

| Outcome | Incl | Actual | Covered | Incl% | Theo% | Miss-when-actual | Wasted slots |
|---|---|---|---|---|---|---|---|
| 1 | 158 | 74 | 62 | 88.8% | 38.89% | **12** | 96 |
| 2 | 131 | 41 | 28 | 73.6% | 24.07% | **13** | 103 |
| 5 | 97 | 24 | 16 | 54.5% | 12.96% | 8 | 81 |
| 10 | 73 | 14 | 6 | 41.0% | 7.41% | 8 | 67 |
| COIN FLIP | 75 | 12 | 3 | 42.1% | 7.41% | 9 | 72 |
| PACHINKO | 49 | 5 | 1 | 27.5% | 3.70% | 4 | 48 |
| CASH HUNT | 70 | 5 | 2 | 39.3% | 3.70% | 3 | 68 |
| CRAZY TIME | 59 | 3 | 0 | 33.1% | 1.85% | 3 | 59 |

- **CRAZY TIME** (1.85 % prior, 3 actuals, **0 covered**) was included in Top-4 **59 times**.
- **Bonus slots total = 253; bonus HITs = 6; wasted = 247.** Bonus inclusion efficiency **2.4 %** vs 16.66 % combined-bonus prior.
- **"1" excluded → MISS 12/12** (every time "1" was dropped, it was the actual).
- Displacer breakdown (lowest-prior selected outcome in each miss): **CRAZY TIME 21, PACHINKO 17, CASH HUNT 14, 10/COIN FLIP 1 each.**

### Miss attribution (quantified per §1 list)

| Category | Count |
|---|---|
| "1" exclusion misses | 12 |
| "2" exclusion misses | 13 |
| "5" exclusion misses | 8 |
| "10" exclusion misses | 8 |
| **Total number-exclusion misses** | **41** |
| PACHINKO displacement incidents | 15 |
| CASH HUNT displacement incidents | 29 |
| COIN FLIP displacement incidents | 23 |
| CRAZY TIME displacement incidents | 16 |
| Unnecessary bonus inclusions (wasted) | 247 of 253 |
| Rare-outcome overreaction | **YES** — CRAZY TIME in 33% of rounds (prior 1.85%) |

---

## 2. Why dynamic Top-4 loses to [1,2,5,10]

Four compounding defects:

**(a) The LIVE prediction path runs in BASELINE mode — the reliability layer is OFF.**
`buildInitial`/`recalibrate` default `mode="baseline"` (RevoGame.tsx:526,582,687,748,752). The experimental reliability layer only runs under the `experimentalEnabled` shadow flag (RevoGame.tsx:599,694,811,812), which has been **OFF for 281+ passes**. In baseline mode, `reliableDeviation === cappedDeviation` (identity) — **no sample-size dampening at all**. A single rare-outcome appearance inflates its score above a high-prior number:

> CRAZY TIME appears 1× in ~30 rounds → Laplace-smoothed freq ≈ 2.59 % → **dev = +40 %** → `evidenceScore = 1.40` → `score = 0.5·1.40 + 0.5·0.0185 = 0.709` **> "1"'s neutral 0.694**. One appearance beats the 38.89 % outcome.

**(b) The 50 % evidence / 50 % prior blend compresses the prior advantage.**
`score = evidenceScore·0.50 + theo·0.50` (decisionEngine.ts:1406). At *neutral* evidence (dev=0):
- "1"=0.694, "2"=0.620, "5"=0.565, **"10"=0.537, COIN FLIP=0.537 (TIE)**, PACHINKO/CASH HUNT=0.519, CRAZY TIME=0.509.
Any positive deviation — even Laplace noise — lets a 7.41 %-prior bonus beat "10" or "5". The prior term is only half-weighted, so the natural ranking advantage of numbers is halved.

**(c) The 70-combination optimizer is a mathematical no-op.**
`selectTopByEvidence` (line 1685) sets `calibratedProbability = rawScore/ΣrawScore`, then over all 70 combos maximizes `Σ calibratedProbability` = `ΣrawScore/ΣrawScore` → **maximizing ΣrawScore** → identical to greedy top-4-by-score. The code's own debug log prints `Optimizer matches top-4-by-score: YES (same set)`. It adds **no** combination-level calibration, reliability, uncertainty, or overreaction term. §5 is entirely unmet.

**(d) Even with the reliability layer ON, only 4/60 misses recover.**
Replay B = 70.22 % (vs A 67.98 %). Reasons:
- The reliability factor only dampens the `evidenceScore` deviation term; it does nothing about the 50 % prior compression (root cause).
- The signal multipliers **bypass reliability** (see §3): `recent-active` (+10 %), `anomaly-weighted` (overrides score), `shift-adaptive` (overrides score) all use **raw recent frequency**, re-injecting the small-sample rare-outcome inflation the layer was meant to suppress.
- Reliability is computed on **cumulative** count but deviations/signals fire on **recent windows** → mismatch: a bonus can have low cumulative count yet high recent freq, triggering the bypass signals.

---

## 3. Which feature causes the most harmful displacement

**Primary — the base scoring formula itself: `score = 0.5·(1+reliableDeviation) + 0.5·theo`** (decisionEngine.ts:1406).
The 50 % prior weight is the root defect: it halves the prior ranking advantage so low-prior outcomes need only trivial deviation to enter Top-4.

**Secondary — the raw-recent-frequency signal factors that BYPASS the reliability layer:**
- `recent-active` (line 1413): `if (recFreq > livePrior*0.8 …) score *= 1.10` — uses raw recent freq.
- `anomaly-weighted` (lines 1557-1562): **overrides** `score = (1+cappedAnomalyDev*1.5)·0.5 + theo·0.5`, where `cappedAnomalyDev = (recFreq-livePrior)/livePrior` — raw recent, **not reliability-dampened**.
- `shift-adaptive` (lines 1565-1572): same override pattern with raw recent freq.

These three re-introduce exactly the rare-outcome overreaction the reliability layer was designed to prevent. They are why experimental mode still includes CRAZY TIME 33×, PACHINKO 31×, COIN FLIP 81×.

**Tertiary — the no-op optimizer** (cannot correct any of the above at the combination level).

---

## 4. Is the current optimizer selecting the mathematically correct combination?

**No.** Proof:

`calibratedProbability_i = rawScore_i / ΣrawScore`. The optimizer maximizes over 4-subsets S:
`Σ_{i∈S} calibratedProbability_i = (Σ_{i∈S} rawScore_i) / ΣrawScore`.

Since `ΣrawScore` is constant for a given round, maximizing this is equivalent to maximizing `Σ_{i∈S} rawScore_i` — i.e. picking the 4 highest rawScores. The 70-combination loop is therefore **provably identical to greedy top-4-by-score** and adds zero information. There is no combination-level objective (calibration quality, evidence reliability, uncertainty penalty, overreaction penalty). The §5 requirement (evaluate all 70, optimize a real combination objective) is **not implemented** — only the loop exists, optimizing the wrong (degenerate) quantity.

---

## 5. Are probabilities calibrated?

**No.**
- `calibratedProbability` (line 1690) is a **normalized score share** (`rawScore/ΣrawScore`), not a calibrated probability. It bears no validated relationship to the true landing frequency.
- There is **no calibration step** — no isotonic/Platt regression, no predicted-probability-vs-empirical-frequency comparison anywhere in the pipeline.
- `honestConfidence` (line 1792) is a sample-size-capped Wilson-lower-bound blend of the *HIT rate* — it is a confidence in the historical hit rate, **not** a per-outcome probability, and is not validated against outcome frequency.
- Concrete symptom: COIN FLIP's `calibratedProbability` floats next to "10"'s purely from the prior-half term, unrelated to its true 7.41 % landing probability.
- §6 (uncertainty awareness) is **partially** present (Wilson bounds, sample-size tier caps) but is **not connected** to per-outcome probability or to combination selection.

---

## 6. Is rare-outcome reliability working?

**The mechanism is sound in principle but is (a) OFF in production, (b) structurally insufficient.**

Design merits (decisionEngine.ts:123-184): continuous, generic, monotonic, converges to 1, applies to all outcomes, positive-deviation-only — compliant with §4.

Failures:
1. **OFF in production.** `experimentalEnabled=false`; Shadow A/B disabled 281+ consecutive passes. The experimental model has **never been validated on a single live round.** The 178-round history is pure baseline.
2. **Insufficient even when ON** — recovers 4/60 (67.98 % → 70.22 %):
   - Dampens only the `evidenceScore` deviation term; root cause (50 % prior compression) untouched.
   - Bypassed by raw-recent signal factors (§3).
   - Cumulative-count reliability vs recent-window deviation mismatch.
3. **No bonus-specific overreaction guard** for the cases where cumulative count is moderate (COIN FLIP, count 12 → reliability 0.55) but the outcome still shouldn't displace a number.

---

## 7. Exact proposed changes (NOT yet implemented — awaiting approval)

Ordered by leverage / risk. All are consistent with §13 (no fixed slots, no forcing, no leakage, no randomness).

| # | Change | Leverage | Risk | Mitigation |
|---|---|---|---|---|
| **P1** | **Promote experimental mode to the LIVE path** (or auto-enable when `sampleN ≥ threshold`). | Recovers ~4 misses immediately; flipsToMiss=0 in replay. | LOW (code exists & A/B-shadowed). Need to confirm why it was disabled. | Keep shadow ledger recording both; one-click rollback via flag. |
| **P2** | **Replace the 0.5/0.5 heuristic with a true calibrated per-outcome probability model**: Bayesian posterior = `Prior(theo) × Likelihood(observed freq, sample-size-shrunk)`, normalized over 8 outcomes. Prior weight adapts to sample size (shrink to prior when n small → §6 uncertainty awareness). | Eliminates root cause (prior compression); produces real probabilities for P4/P5. | MED-HIGH (core rewrite). | Walk-forward replay parity test (must beat baseline on the 178 set AND held-out); freeze before live. |
| **P3** | **Route ALL evidence features through the shrinkage/reliability layer** — remove the raw-recent `recent-active`/`anomaly`/`shift` overrides (or feed them shrinkage-dampened deviations). | Closes the bypass leak; makes reliability actually bind. | MED (changes signal behavior). | Per-signal A/B in shadow; keep raw signals for display only. |
| **P4** | **Replace the no-op optimizer with a real combination objective**: for each of 70 combos score = `expected coverage (Σ calibrated prob) + calibration-quality bonus − uncertainty penalty (entropy/variance of the 4 probs) − overreaction penalty (penalize a bonus whose reliability < τ)`. Select max. | Makes §5 real; lets the optimizer reject low-reliability bonus combos. | MED (selection changes). Assert optimizer never hardcodes; benchmark vs greedy. | Shadow A/B; rollback flag. |
| **P5** | **Calibration instrumentation**: per round record all 8 probabilities + locked Top-4 + actual + feature contributions (§11 schema); add a calibration monitor (prob deciles vs empirical hit). | Enables honest claims; required by §11/§12. | LOW (additive). | Ring buffer (pattern already used). |
| **P6** | **Per-MISS RCA record** (§8): actual, locked Top-4, excluded-actual rank, P(actual), displacer, feature contributions, optimizer decision, avoidable flag. Detect repeated patterns → only then propose model change. | Systematizes this diagnostic; prevents 1-miss overreaction. | LOW (additive). | — |
| **P7** | **Walk-forward validation harness + 4-benchmark dashboard** (A dynamic / B experimental / C theoretical / D random) on 100-200 *fresh* rounds, model FROZEN during validation (§9, §11). | The only honest proof path. | LOW (read-only replay). | — |

**Expected combined effect (modeled):** P1+P2+P3 together should recover the bulk of the 41 avoidable misses (push dynamic from ~66 % toward the ~86 % theoretical ceiling). P4-P7 do not raise hit-rate directly but make any gain *honest* and *measurable*. None of these alone reaches 100 % (19 unavoidable bonus misses remain).

---

## 8. Expected risk of each change

- **P1 (enable experimental live):** LOW. Code already exists; replay shows net +4, 0 regressions. Residual risk: it was disabled for a (to-be-confirmed) reason — must verify no past regression before flipping the default. Rollback = flip flag.
- **P2 (true probability model):** MED-HIGH. Core scoring rewrite. Risks: (i) regression below 66 % if calibration is off; (ii) overfitting if hyperparameters are tuned to the 178-round history (explicitly forbidden by §1 — must NOT tune to replay). Mitigation: walk-forward replay parity gate + frozen live validation; never tune to historical HIT count.
- **P3 (route signals through reliability):** MED. May dampen legitimate trend detection. Mitigation: per-signal shadow A/B; display-only raw signals.
- **P4 (real optimizer):** MED. May converge selection toward [1,2,5,10] — this is **acceptable** (it is the evidence-optimal set on a fair wheel) as long as it is *derived*, not hardcoded (§13 only forbids hardcoding/forcing, not converging). Risk: optimizer over-penalizes a genuinely-evidenced bonus and misses a real bonus-actual. Mitigation: continuous reliability (no hard cutoff); benchmark vs greedy.
- **P5/P6 (instrumentation):** LOW (additive logging). Minor storage/perf — use ring buffers.
- **P7 (validation harness):** LOW (read-only).

---

## 9. Separation: MODEL FAILURE vs UNAVOIDABLE RANDOM vs DATA/PIPELINE FAILURE

- **MODEL FAILURE — 41 misses (69 % of all misses).** Number-actual displaced by a bonus. Avoidable by P1+P2+P3.
- **UNAVOIDABLE RANDOM — 19 misses (31 %).** Bonus-actual rounds where the included bonus (if any) was not the actual. With a 4-slot budget and 4 low-prior bonuses, selecting the correct bonus is luck; [1,2,5,10] misses all 25 bonus-actuals. This is the irreducible floor (~10.7 % on this data).
- **DATA/PIPELINE FAILURE — none found in settlement, but two operational gaps:**
  1. **No data leakage.** The live settlement lifecycle is correct (old lock → result → settle → append → `runEngine(updated)` → new lock; the new prediction uses history *including* the just-settled round to predict the *next* round — correct, no same-round leakage). The 178-round set is a valid walk-forward validation.
  2. **The experimental shadow flag is OFF → benchmark B was never collected live.** Operational gap, not a data error.
  3. **`calibratedProbability` is mislabeled** as a probability (semantics defect) — it is a score share. Not a crash, but it misleads any downstream consumer (and any future "calibration" claim).

---

## 10. What I did NOT do (per §14)

- Did **not** modify `decisionEngine.ts`, `RevoGame.tsx`, or any production code.
- Did **not** tune any parameter to replay historical results (§1).
- Did **not** create or restart any monitoring cron (deleted 369099).
- Did **not** run the dev server or agent-browser (no surveillance; pure offline RCA on existing clean data).

## 11. Artifacts produced (read-only)

- `scripts/rca_top4_diagnostic.py` — RCA over the 178-round set (benchmarks, per-outcome, miss attribution, contingency).
- `scripts/replay_top4.ts` — engine's own `runRetrospectiveDiagnostic` replay (baseline vs experimental, no leakage).
- `scripts/data/replay_top4_result.json` — replay output (per-outcome inclusion/coverage, exclusion rates, flips).
- This report: `DIAGNOSTIC_REPORT.md`.

---

## 12. Recommendation (next step, awaiting approval)

Proceed in this order, each gated by a walk-forward replay parity test:
1. **P1** — enable experimental live (lowest risk, immediate +4).
2. **P2 + P3** together — true calibrated probability model + route signals through shrinkage (the root-cause fix).
3. **P4** — real combination optimizer.
4. **P5 + P6 + P7** — instrumentation, RCA logging, frozen 100-200-round live validation.

Only after P7 produces a frozen, fresh, walk-forward result with N/N HIT and 0 MISS may "100 %" be mentioned — and only as *observed validation performance*, never a guarantee.
