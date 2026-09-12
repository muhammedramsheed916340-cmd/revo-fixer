// Part 2: body content — sections 1–5
const S = []; // body children accumulator

// ================= 1. Executive Summary =================
S.push(h1("1. Executive Summary"));
S.push(body("This report is the mandatory pre-code diagnostic for the Top-4 coverage optimization program. It answers the eight required diagnostic questions using only the existing clean validation dataset, and it deliberately makes no changes to the prediction engine or to any production file. The engine repository drift anchor (git diff against commit 62214ee across src/) is empty, confirming an observation-only analysis. All quantitative findings below are reproducible from the stored round history and the persisted analysis scripts."));
S.push(body("On the same 178 unseen walk-forward rounds, the current dynamic baseline locked 118 hits (66.29%; 95% CI 59.3 to 73.2) while the fixed theoretical [1, 2, 5, 10] reference would have covered 153 (85.96%; CI 80.9 to 91.1). The deficit of 35 rounds (19.66 percentage points) is highly significant in a paired McNemar test (chi-squared 24.6 on 1 degree of freedom, p = 7.1e-07) and the two confidence intervals do not overlap, so the shortfall is a structural property of the current model rather than sampling noise. A random Top-4 baseline sits at 50.0 percent by construction, and the engine itself, replayed retrospectively in its experimental configuration, scores 70.22 percent, which still leaves it 28 rounds behind the theoretical reference."));
S.push(body("The dominant miss cause is unambiguous: bonuses occupied 253 of 712 Top-4 slots (35.5 percent) against a combined prior of 16.67 percent, and produced only 6 hits, a 2.37 percent slot efficiency. Forty-one of the 60 misses are rounds in which a number outcome was excluded while at least one bonus slot was occupied; the remaining 19 are bonus outcomes that no configuration short of buying additional bonus slots would have covered. Code audit attributes the over-inclusion to three mechanisms: a relative-deviation evidence score whose variance explodes for rare outcomes, a pattern-shift and anomaly pathway that overwrites the entire score with a last-10 recency deviation (active in 93 of 178 rounds), and a persistence penalty that punished the highest-prior outcome in 14 rounds. Wheel structure tests find no exploitable signal (chi-squared goodness of fit p = 0.986; bonus runs test p = 0.351; next-round dependence p = 0.548; lag-1 autocorrelation of the dominant outcome +0.011), so the statistically defensible ceiling is the prior-dominant policy near 83.3 percent expected coverage, with any upside requiring fresh walk-forward proof. Exact proposed changes and their risks are given in Sections 7 and 8."));
S.push(caption("Table 1: The eight mandated diagnostic questions, answered in one line each"));
S.push(tbl(
  ["#", "Required diagnostic item", "Answer (evidence section)"],
  [
    ["1", "Dominant cause of current MISSes", "Bonus over-inclusion: 41 of 60 misses are number actuals excluded while bonus slots were occupied; bonus slots ran at 2.37% efficiency (Sec. 4)"],
    ["2", "Why dynamic loses to [1,2,5,10]", "Every bonus slot displaces a number slot with 2 to 20 times higher hit efficiency; exchange rate realized 41 misses for 6 hits vs a breakeven of about 1 to 2 (Sec. 3, 4)"],
    ["3", "Most harmful displacement feature", "Pattern-shift / anomaly score overwrite: replaces all evidence with last-10 recency deviation; active 93/178 rounds (Sec. 5.2)"],
    ["4", "Is the optimizer mathematically correct?", "Consistent but vacuous: with mutually exclusive outcomes the argmax of summed normalized scores is always the top-4 by score, so the 70-combination loop adds no correction; failure is upstream in the probabilities (Sec. 5.4)"],
    ["5", "Are probabilities calibrated?", "No. Raw evidence scores are normalized into pseudo-probabilities that do not behave as probabilities; displayed confidence is a coverage estimate and runs 8.8 points pessimistic overall (Sec. 5.5)"],
    ["6", "Is rare-outcome reliability working?", "Not yet observable: the reliability layer has never run live (Shadow OFF for 282 consecutive checks); retrospective simulation gains only +4 of 35 rounds back (Sec. 5.6)"],
    ["7", "Exact proposed changes", "Seven changes: calibrated probability channel, continuous generic reliability, uncertainty shrinkage, uncertainty-penalized 70-combo optimizer, feature de-scoping, RCA extension, frozen walk-forward validation (Sec. 7)"],
    ["8", "Expected risk of each change", "Per-change risk register with likelihood, impact, mitigation and rollback path; dominant risk is over-shrinkage toward a static policy, which is acceptable and reversible (Sec. 8)"],
  ],
  [5, 33, 62], 20));

// ================= 2. Scope, Data Sources & Integrity =================
S.push(h1("2. Scope, Data Sources and Integrity"));
S.push(h2("2.1 Data basis"));
S.push(body("The diagnostic uses the era-3 stored round history (scripts/data/pass282_history.json), which contains 178 complete walk-forward rounds captured at the 00:34 probe on 2026-09-13. Each entry stores the locked Top-4 prediction (four named outcomes with a shared confidence value), the actual result, the HIT/MISS settlement flag, a recalibration flag and a millisecond timestamp. This is the same dataset the live engine settled against, so no reconstruction or simulation is needed for the primary findings; the numbers in this report are the engine's own record."));
S.push(body("Three integrity checks were run before any analysis. First, settlement uniqueness: all 178 timestamps are strictly increasing with zero duplicates, confirming that exactly one settlement occurred per live result. Second, settlement consistency: the stored HIT flag matches the stored Top-4 membership of the actual outcome in all 178 rounds, with zero mismatches. Third, shape validity: every round carries exactly four predictions. The engine-side lifecycle additionally enforces the required order, settle the old locked prediction, append the result, recalculate on the updated history, lock the new prediction, and this order is verified at runtime by the on-page PIPELINE AUDIT panel with its proof footer."));
S.push(h2("2.2 Caveats and boundaries"));
S.push(body("Two caveats bound the interpretation. First, the experimental-mode figure of 125 hits (70.22 percent) comes from a retrospective replay of the engine over the same 178 actuals, not from live shadow rounds; the engine's own retrospective diagnostic output carries the same warning, and the replay baseline (121 hits) differs from the stored live record (118 hits) by three rounds because the replay cannot reconstruct the live external spin feed that the production engine blended into its priors. Second, era-1 history (1,406 rounds, final HIT rate 65.29 percent) is no longer available for per-round analysis after the earlier workspace rollback, so structure tests are bounded by n = 178; the direction and magnitude of every era-3 finding is nonetheless consistent with the era-1 aggregate."));
S.push(body("What was deliberately not done: no engine parameter was tuned, no code path was edited, and no model variant was fitted to the historical rounds. The analysis exists solely to diagnose, and every proposed change in Section 7 is specified so that it can be validated on genuinely new rounds under the frozen-model protocol of Section 9."));

// ================= 3. Benchmarks =================
S.push(h1("3. Benchmark Comparison on the Same 178 Rounds"));
S.push(body("All four benchmarks are evaluated on exactly the same 178 actuals. Benchmark A is the stored dynamic baseline as the live engine actually locked it. Benchmark B is the engine replayed retrospectively in its experimental configuration (k = 30 shrinkage plus the rare-outcome reliability layer); it is labeled a simulation and excluded from validation claims. Benchmark C is the fixed theoretical [1, 2, 5, 10] reference that the wheel geometry implies. Benchmark D is the uniform random Top-4, which covers 50 percent of rounds in expectation because each round's actual belongs to 4 of 8 equally likely slots."));
S.push(caption("Table 2: Benchmark results on the same 178 unseen rounds"));
S.push(tbl(
  ["Benchmark", "Configuration", "Hits / 178", "HIT rate", "95% CI"],
  [
    ["A", "Current dynamic baseline (stored locked sets)", "118", "66.29%", "59.3 - 73.2"],
    ["B", "Experimental layer, retrospective replay only", "125", "70.22%", "not a validation result"],
    ["C", "Theoretical [1, 2, 5, 10]", "153", "85.96%", "80.9 - 91.1"],
    ["D", "Uniform random Top-4", "89 expected", "50.00%", "analytical; simulated 49.93%"],
  ],
  [10, 42, 14, 14, 20], 20));
S.push(fig("scripts/data/fig1_benchmarks.png", 520, 1848, 924));
S.push(figCaption("Figure 1: Benchmark HIT rates. The dashed line marks the 83.33 percent expected coverage of the 54-segment wheel under the i.i.d. null."));
S.push(body("The paired structure of the comparison is what makes the deficit decisive. In 41 rounds the theoretical set covered the actual while the dynamic set missed it, and in only 6 rounds did the reverse happen (bonus actuals the dynamic set covered and the theoretical set missed). A McNemar test on this 41-versus-6 discordance yields chi-squared 24.6 with p = 7.1e-07. The dynamic model is not merely behind on aggregate; it is behind on the same rounds it was given every opportunity to cover, and its bonus wins are an order of magnitude too rare to pay for its number misses."));
S.push(body("For context, the all-time era-1 aggregate (918 hits in 1,406 rounds, 65.29 percent) sits in the same band as the current 66.29 percent, which indicates the deficit is a persistent property of the scoring design rather than a recent regression. The best fixed combination in hindsight on these 178 actuals is also [1, 2, 5, 10] at 153 hits; no other static combination does better, so the theoretical reference is not an artifact of the sample."));

// ================= 4. Miss anatomy =================
S.push(h1("4. Miss Anatomy and Root-Cause Quantification"));
S.push(h2("4.1 The 60 misses decompose into 41 avoidable and 19 structural"));
S.push(body("Every miss is classified by whether locking [1, 2, 5, 10] would have covered the actual. A number-actual miss is by construction a round in which at least one bonus occupied a Top-4 slot, because four slots and four number outcomes mean an all-number lock always covers any number. This yields 41 avoidable misses. The remaining 19 misses are bonus actuals the engine did not cover; the fixed reference misses all 19 as well, so they are structural to the 4-of-8 problem and only avoidable by buying bonus slots. Three of the 19 occurred with zero bonus slots locked (rounds 107, 129 and 134), meaning the engine chose all four numbers and still missed; nothing about those rounds is correctable by slot policy."));
S.push(caption("Table 3: Miss decomposition and per-number exclusion accounting"));
S.push(tbl(
  ["Excluded-when-actual", "Count", "Share of misses", "Times excluded at all", "Miss rate when excluded"],
  [
    ["'1' excluded", "12", "20.0%", "20 of 178 rounds", "60.0%"],
    ["'2' excluded", "13", "21.7%", "47 of 178 rounds", "27.7%"],
    ["'5' excluded", "8", "13.3%", "81 of 178 rounds", "9.9%"],
    ["'10' excluded", "8", "13.3%", "105 of 178 rounds", "7.6%"],
    ["Bonus actual not covered", "19", "31.7%", "n/a (25 bonus actuals, 6 covered)", "76.0%"],
    ["Total", "60", "100%", "-", "-"],
  ],
  [26, 10, 16, 30, 18], 20));
S.push(body("The '1' row deserves emphasis because it quantifies a self-inflicted wound: whenever the engine dropped the highest-prior outcome, six times out of ten that exclusion itself became the miss. Excluding '2' converted 28 percent of its exclusions into misses. The persistence penalty (Section 5.3) and the recency overwrites are the two mechanisms that pushed high-prior numbers out of the lock."));
S.push(h2("4.2 Bonus slot economics"));
S.push(body("Across the era the engine distributed 712 Top-4 slots. Numbers received 459 and delivered 112 covered actuals; bonuses received 253 and delivered 6. Slot efficiency falls monotonically from 39.2 percent for '1' down to 0.0 percent for CRAZY TIME, which was included in 59 rounds (17.9 times its 1.85 percent prior) and never once was the actual. Only 20 of 178 rounds were locked with an all-number set, and 87 rounds carried two or more bonus slots, including 8 rounds with three."));
S.push(caption("Table 4: Slot-efficiency league table (stored locked sets, n = 178)"));
S.push(tbl(
  ["Outcome", "Prior", "Slots", "Slot share", "Over-inclusion", "Hits", "Slot efficiency"],
  [
    ["1", "38.89%", "158", "88.8%", "2.3x", "62", "39.2%"],
    ["2", "24.07%", "131", "73.6%", "3.1x", "28", "21.4%"],
    ["5", "12.96%", "97", "54.5%", "4.2x", "16", "16.5%"],
    ["10", "7.41%", "73", "41.0%", "5.5x", "6", "8.2%"],
    ["COIN FLIP", "7.41%", "75", "42.1%", "5.7x", "3", "4.0%"],
    ["CASH HUNT", "3.70%", "70", "39.3%", "10.6x", "2", "2.9%"],
    ["PACHINKO", "3.70%", "49", "27.5%", "7.4x", "1", "2.0%"],
    ["CRAZY TIME", "1.85%", "59", "33.1%", "17.9x", "0", "0.0%"],
  ],
  [16, 10, 10, 13, 17, 10, 24], 20));
S.push(fig("scripts/data/fig2_slots.png", 520, 1848, 968));
S.push(figCaption("Figure 2: Top-4 inclusion rate versus actual occurrence and theoretical prior, per outcome."));
S.push(body("The requested displacement quantifications are as follows. Counting bonus-presence inside the 41 avoidable-miss rounds, the incident totals are: CASH HUNT present in 29, COIN FLIP in 23, CRAZY TIME in 16 and PACHINKO in 15 (a round can contain more than one bonus). Attributing each avoidable miss to the single lowest-prior member of the locked set, the displacer of record is CRAZY TIME 21 times, PACHINKO 18, CASH HUNT 13 and COIN FLIP once. Unnecessary bonus inclusions, meaning rounds where a bonus held a slot while a number actual went uncovered, total 41 rounds and 247 wasted bonus slots. The exchange rate is stark: 41 number misses bought 6 bonus hits, roughly 6.8 to 1, whereas breakeven for the least harmful swap (COIN FLIP replacing '10') is about 1 to 1 and for the most harmful (CRAZY TIME replacing '10') about 4 to 1 against the engine."));

// ================= 5. Mechanism audit =================
S.push(h1("5. Mechanism Audit: Why the Engine Does This"));
S.push(h2("5.1 The evidence score is heteroscedastic by construction"));
S.push(body("The core score is computed as score = 0.5 x (1 + deviation) + 0.5 x prior, where deviation is the relative departure of a Laplace-smoothed frequency (k = 30) from the theoretical prior, capped to the interval [-0.6, +2.0]. Because the deviation is relative, its sampling variance scales inversely with the prior: two extra appearances of a 1.85 percent outcome in a 30-round window produce roughly a +200 percent deviation that saturates the cap, while the same absolute event moves a 38.89 percent outcome by a few percent at most. In other words, the bonus score is mostly noise with a large amplitude, and the number score is mostly signal with a small amplitude. The engine's own documentation example shows CRAZY TIME reaching a score of 1.614 against 0.702 for '1' after three appearances in thirty rounds; that is the displacement mechanism in one line, and the cap at +200 percent guarantees it recurs whenever any bonus enjoys a short lucky window."));
S.push(h2("5.2 Recency multipliers and the pattern-shift overwrite"));
S.push(body("On top of the base score, up to seven multiplicative signals can stack: recent-active up to +10 percent, trend alignment up to +12 percent, pattern stability +6 percent, a Wilson-lower-bound verification boost up to +25 percent, per-bonus cluster boosts of +8 and +5 percent, number-side bonus-phase damping of -3 percent, and the persistence penalty of -3 to -15 percent. Individually mild, their product can exceed a factor of 1.8. The decisive damage, however, comes from two overwrite paths: when the rolling chi-squared anomaly test fires, or when the total-variation pattern-shift test fires (last-10 distribution more than 0.6 away from the long-run), the accumulated score is discarded entirely and replaced by 0.5 x (1 + 1.5 or 1.3 times the last-10 recency deviation) + 0.5 x prior. Reconstructed deterministically from the stored history, the pattern-shift overwrite was active in 93 of 178 rounds (52.2 percent) and the anomaly overwrite in 3 more. For over half the era, the engine's ranking was effectively a last-10 frequency chase with the theoretical prior as a partial anchor, which is exactly the regime in which bonus epochs (PACHINKO rank-1, CRAZY TIME rank-1, CASH HUNT rank-1) appeared in the monitoring record."));
S.push(h2("5.3 Persistence penalty misfire on high-prior outcomes"));
S.push(body("The persistence penalty reduces the score of any outcome that sat in the previous prediction during a running miss streak of two or more, by 3 percent per consecutive miss up to 15 percent. Because '1' was inside the previous prediction in nearly every round, the penalty functionally taxes the highest-prior outcome precisely when the model is in trouble. Reconstruction shows the penalty was active in 23 of 178 scoring states and landed on '1' 14 times. The 12 rounds where '1' was the excluded actual are the direct cost; during the era's record 9-miss streak the penalty was simultaneously maximal, which weakened the set's anchor exactly when stability mattered most."));
S.push(h2("5.4 Optimizer verdict: consistent but vacuous"));
S.push(body("The 70-combination optimizer evaluates every C(8,4) subset and maximizes the sum of member probabilities, which is the correct objective for mutually exclusive outcomes. But because the calibrated probability is just the raw score normalized to sum to one, the combination that maximizes the summed share is always the four largest raw scores; the engine's own debug log records that the optimizer's answer matches the top-4-by-score in every evaluation. The optimizer is therefore mathematically consistent with its inputs yet adds zero selection correction: no uncertainty penalty, no combination-level calibration, no counterfactual guard. It is not the cause of the losses, but it is also not a safeguard; all failure is upstream in the probability estimates it inherits."));
S.push(h2("5.5 Calibration verdict: pseudo-probabilities and a pessimistic confidence display"));
S.push(body("Two different numbers are called confidence in the system, and both need clarification. The per-round displayed value is an honest coverage estimate: a Wilson lower bound of the historical Top-4 hit rate, blended with the recent-5 rate under sample-size tier caps. Against its intended meaning, it performs reasonably and is systematically conservative: overall mean 57.5 displayed versus 66.29 percent realized, with the top bucket (65 to 76) nearly exact at 69.0 displayed versus 69.5 realized. The deeper problem is the per-outcome layer: the normalized raw scores that feed the optimizer are not probabilities in any operational sense, since a bonus with a saturated evidence score can be assigned a normalized share several times its true occurrence rate. Reliability by bucket, per outcome, cannot be computed retroactively because per-round all-8 scores were not persisted; a per-round probability dump is part of the proposed validation record (Section 9) and will make calibration directly auditable going forward."));
S.push(caption("Table 5: Displayed confidence versus realized Top-4 coverage"));
S.push(tbl(
  ["Displayed confidence bucket", "Rounds", "Mean displayed", "Realized coverage", "Gap"],
  [
    ["30 - 44", "23", "38.5", "52.2%", "+13.7 pp"],
    ["45 - 54", "26", "50.9", "53.8%", "+3.0 pp"],
    ["55 - 64", "65", "58.9", "70.8%", "+11.9 pp"],
    ["65 - 75", "59", "69.0", "69.5%", "+0.5 pp"],
    ["Overall", "178", "57.5", "66.29%", "+8.8 pp"],
  ],
  [30, 12, 18, 20, 20], 20));
S.push(h2("5.6 Rare-outcome reliability layer: designed correctly, never tested live"));
S.push(body("The experimental layer is a continuous, generic sample-size factor, reliability = n / (n + 10), applied only to the positive deviation of any outcome, with negative deviations passing through unchanged. The design satisfies the stated principles: it is continuous, outcome-agnostic, monotonic in evidence, and it never inflates an absent rare outcome. However, it has accumulated zero live evidence because the Shadow A/B flag has remained OFF for 282 consecutive monitoring checks. The retrospective replay shows it would have recovered only 4 of the 35 deficit rounds (flipping 4 misses to hits and none in reverse), because it moderates CASH HUNT and CRAZY TIME inclusions but leaves PACHINKO inclusion unchanged at 31 with zero covered actuals. The mechanism is worth keeping, but it is a damping term on a miscalibrated score, not a fix for the score itself, and it remains unvalidated until the shadow protocol of Section 9 runs."));
