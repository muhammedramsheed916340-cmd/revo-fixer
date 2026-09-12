// Part 3: sections 6–9, appendix ledger, assembly
const histData = JSON.parse(fs.readFileSync("scripts/data/pass282_history.json", "utf8"));
const rounds = typeof histData.data.result === "string" ? JSON.parse(histData.data.result) : histData.data.result;
const THEO = { "1": 21/54, "2": 13/54, "5": 7/54, "10": 4/54,
  "COIN FLIP": 4/54, "CASH HUNT": 2/54, "PACHINKO": 2/54, "CRAZY TIME": 1/54 };
const BONUS = new Set(["PACHINKO", "COIN FLIP", "CASH HUNT", "CRAZY TIME"]);
const ledger = [];
rounds.forEach((r, i) => {
  const act = r.actualResult.name;
  if (r.hit) return;
  const names = r.prediction.map(p => p.game.name);
  const bon = names.filter(n => BONUS.has(n));
  const cand = names.filter(n => THEO[n] <= THEO[act]);
  const disp = cand.length ? cand.reduce((a, b) => THEO[a] <= THEO[b] ? a : b) : "-";
  const cls = ["1","2","5","10"].includes(act) ? "Avoidable (baseline lock)" : "Structural (bonus uncovered)";
  ledger.push([String(i + 1), act, names.join(", "), String(bon.length), String(r.confidence), disp, cls]);
});

// ================= 6. Root-cause classification =================
S.push(h1("6. Root-Cause Classification"));
S.push(body("The mandated three-way separation of model failure, unavoidable randomness and data or pipeline failure comes out decisively lopsided. Model failure accounts for the entire 35-round deficit: 41 avoidable number-exclusion misses, partially offset by 6 bonus wins that a prior-dominant policy would not have bought. Unavoidable randomness accounts for the 19 structural bonus misses, which the fixed reference also misses; these are the cost of the 4-of-8 format itself, not of the model, and they set the realistic ceiling near 83 percent expected coverage under the i.i.d. null. Data or pipeline failure accounts for zero detected rounds in era-3: settlement uniqueness, settlement consistency and lifecycle ordering all verify cleanly, and the replay-versus-stored discrepancy of three rounds is attributable to the replay's absent external spin feed rather than to leakage or double settlement."));
S.push(caption("Table 6: Three-way root-cause classification with quantification"));
S.push(tbl(
  ["Class", "Quantification", "Rounds", "Share of deficit", "Correctable?"],
  [
    ["MODEL FAILURE", "Number actuals excluded while bonus slots occupied; recency overwrites 93/178; persistence penalty 23 states (14 on '1'); pseudo-probabilities", "41 avoidable misses vs 6 bonus buys (net -35)", "100% of the -19.66 pp gap", "Yes, by recalibrated probability channel (Sec. 7)"],
    ["UNAVOIDABLE RANDOM OUTCOME", "Bonus actuals not covered; wheel i.i.d.-consistent (GOF p=0.986, runs p=0.351, transition p=0.548, phi=+0.011)", "19 structural misses", "Defines the ~83.3% ceiling, not the gap", "Only by paying bonus slots, which is EV-negative under the null"],
    ["DATA / PIPELINE FAILURE", "Zero duplicate settlements, zero hit-flag mismatches, lifecycle order proven on-page; 3-round replay delta explained by missing spin feed", "0 detected in era-3", "0%", "n/a; keep integrity checks as permanent gates"],
  ],
  [22, 40, 13, 13, 12], 18));
S.push(body("One framing point matters for the program's stated 100 percent target. With eight outcomes, four slots and no exploitable dependence in 178 rounds, no selection policy can promise sustained 100 percent; a perfect per-round oracle would, but no measurable feature set in the current data approaches it. The honest development objective is therefore to stop paying the 41-round structural tax and converge to the 83 to 86 percent band, and then to keep an auditable gate through which any future evidence of genuine dependence could justify bonus slots. Any claim of a sustained 100 percent run should be treated as a leakage signal to investigate, not an achievement, exactly as the program's own guardrails anticipate."));

// ================= 7. Proposed changes =================
S.push(h1("7. Exact Proposed Changes"));
S.push(body("Seven changes are proposed, each mapped to the corresponding section of the optimization specification. Nothing below has been implemented; the list is the contract for the next phase, and every item is designed to land behind a feature flag so the frozen baseline remains bit-for-bit reproducible until the validation protocol of Section 9 closes."));
S.push(caption("Table 7: Proposed changes, mechanisms and expected effects"));
S.push(tbl(
  ["#", "Change", "Mechanism", "Spec ref", "Expected effect"],
  [
    ["C1", "Calibrated probability channel", "Replace the evidence-deviation score with a Dirichlet-multinomial posterior per outcome: theoretical 54-segment prior as conjugate center, one recency kernel with a single fixed half-life, fixed precision weights; no overlapping frequency features", "Sec. 3", "Removes the heteroscedastic-deviation displacement engine and all double counting; per-outcome numbers behave as probabilities"],
    ["C2", "Continuous generic reliability", "Keep reliability = n/(n+K) as a Beta-binomial posterior shrinkage on each outcome's departure from prior, applied to both directions, same constant for all 8 outcomes, no hard cutoff", "Sec. 4, 6", "Rare outcomes need repeated evidence to enter; absent rare outcomes are never inflated"],
    ["C3", "Uncertainty-aware shrinkage", "Effective sample size drives automatic shrinkage toward the theoretical prior; weak evidence cannot produce strong scores; confidence derived from the posterior, not blended streaks", "Sec. 6", "Low-n rounds behave like the prior-dominant policy; no fake confidence"],
    ["C4", "True 70-combination optimizer with uncertainty penalty", "Utility U(C) = sum of posterior means minus lambda times summed posterior standard deviations (small fixed lambda); log all 70 utilities and the [1,2,5,10] counterfactual delta each round", "Sec. 5", "Gives the optimizer real work: penalizes unstable sets, leaves a full audit trail of every selection decision"],
    ["C5", "Feature de-scoping", "Disable the pattern-shift and anomaly score overwrites (demote to dashboard diagnostics); cap stacked multipliers; remove the persistence penalty from high-prior numbers pending walk-forward proof; keep overdue/gap as display-only", "Sec. 13", "Eliminates the two most harmful displacement paths measured in Sec. 5"],
    ["C6", "RCA extension", "Per miss, persist all 8 probabilities, optimizer utilities, displacer identity, avoidable flag (exists a combo containing the actual with utility within epsilon), and a displacement signature; alert only at 5+ repeats of one signature", "Sec. 8", "Makes every future miss attributable without one-miss overreactions"],
    ["C7", "Frozen walk-forward validation harness", "Freeze all of the above; run the live Shadow A/B flag for 100 to 200 genuinely new rounds; report benchmarks A/B/C/D per round with the validation record fields specified by the program", "Sec. 9, 10, 11", "Produces admissible evidence; nothing promotes without it"],
  ],
  [5, 17, 40, 8, 30], 18));

// ================= 8. Risk register =================
S.push(h1("8. Risk Register"));
S.push(body("Each change carries identifiable risk; the register below states likelihood, impact and mitigation, with rollback always available through the feature flag. The dominant systemic risk is over-shrinkage: a heavily shrunk channel converges toward prior-dominant behavior and will rarely capture bonus rounds, capping upside near the theoretical band. That outcome is acceptable and explicitly preferred to the current 19.66-point deficit, and it is not a fixed composition in the prohibited sense because the policy still deviates whenever calibrated evidence genuinely supports it."));
S.push(caption("Table 8: Per-change risk assessment"));
S.push(tbl(
  ["Change", "Risk", "Likelihood", "Impact", "Mitigation and rollback"],
  [
    ["C1 probability channel", "Subtle coding divergence from intended posterior; window choices still arbitrary", "Medium", "High", "Unit tests against closed-form Dirichlet updates; freeze constants in config; shadow A/B against frozen baseline before promotion"],
    ["C2 reliability layer", "Damping too strong, rare outcomes never enter even with real evidence", "Medium", "Medium", "Single K for all outcomes; sensitivity sweep during shadow only; continuous form keeps large-evidence entry open"],
    ["C3 shrinkage", "Confidence now posterior-based, displayed numbers shift and look worse short-term", "High", "Low", "Document semantics change; calibration table (Sec. 5.5 style) published each validation batch"],
    ["C4 optimizer penalty", "Lambda mis-set distorts selection; 70-combo loop is then no longer equivalent to top-4", "Low", "Medium", "Fix lambda a priori at a small value; log all 70 utilities so any distortion is visible and reversible"],
    ["C5 de-scoping", "If the wheel feed ever carries real regime structure, overwrite removal forfeits it", "Low (structure tests null at n=178)", "Medium", "Keep pattern-shift as a monitored diagnostic; re-enable as blend weight only with fresh walk-forward proof"],
    ["C6 RCA extension", "Larger per-round records stress the localStorage ring buffer", "Medium", "Medium", "Append-only journal with checksum; cap ring with explicit eviction telemetry (REWIND counter already tracked)"],
    ["C7 validation harness", "Tuning pressure mid-validation; retrospective sim mistaken for validation", "Medium", "High", "Hard freeze with hash-pinned config; B-labeled simulation excluded from claims; 100-round minimum before any verdict"],
  ],
  [16, 30, 12, 10, 32], 18));

// ================= 9. Validation plan, success criteria, no-go compliance =================
S.push(h1("9. Validation Plan, Success Criteria and No-Go Compliance"));
S.push(h2("9.1 Protocol"));
S.push(body("The model that emerges from C1 through C6 is frozen, hash-pinned and untouchable for the duration of validation. The Shadow A/B flag is enabled so that both engines lock predictions at the same moment on the same live history, and at least 100 genuinely new rounds are collected, with 200 preferred. Each round records the round identifier, timestamp, prediction identifier, locked Top-4, actual result, HIT/MISS, all eight probabilities, expected coverage, actual-outcome rank, the winning optimizer combination with its utility, and feature contributions. The four benchmarks (frozen baseline, new model, theoretical reference, random) are reported on the same unseen rounds, and the retrospective simulation is reported only as a direction estimate, never as validation."));
S.push(h2("9.2 Success criteria and the 100 percent target"));
S.push(body("Primary development target: 100 percent Top-4 HIT with zero MISS. This remains a direction, not a claim: under the i.i.d. null with no exploitable dependence in 178 rounds, sustained 100 percent is not a defensible expectation, and even the observed best window of the theoretical reference is 86 percent. Observed-validation phrasing is mandatory for any result: a completed fresh run of N rounds with N hits and zero misses would be reported exactly as observed validation performance on that window, with no guarantee implied for future random outcomes. Secondary criteria are concrete and ranked: beat the frozen baseline by a statistically meaningful paired margin, reduce number-exclusion misses (41 in the reference window), reduce rare-outcome over-inclusion (253 bonus slots at 2.37 percent efficiency), keep genuine bonus coverage available through evidence rather than slots, bring per-outcome probabilities into bucket-calibration agreement, and hold the pipeline at zero integrity defects. Promotion requires the new model to be at or above the frozen baseline with its lower confidence interval not below the baseline point estimate; the theoretical reference remains the non-hidable yardstick throughout."));
S.push(h2("9.3 No-go compliance"));
S.push(caption("Table 9: The thirteen prohibited designs and how the proposal complies"));
S.push(tbl(
  ["Prohibited design", "Compliance status"],
  [
    ["Fixed [1,2,5,10] or fixed [1,2,5,PACHINKO]", "Not implemented: prior-dominance emerges from calibration, and any outcome can enter on calibrated evidence; the [1,2,5,10] delta is logged per round as a counterfactual, never enforced"],
    ["Fixed bonus slot / forced 1 / forced 2 / forced 5 / forced 10 / forced PACHINKO / forced CASH HUNT / forced COIN FLIP / forced CRAZY TIME", "No forced or permanent slots anywhere in C1-C7; all eight outcomes are scored every round and only the optimizer decides"],
    ["Last-result repetition or opposite", "No single-result carryover exists in the current engine and none is proposed; repeat handling remains a statistically estimated, capped effect"],
    ["Hot-number, overdue or gap guarantees", "Overdue and gap remain display-only diagnostics; no boost paths are proposed"],
    ["Streak prediction rule", "Persistence penalty removed from high-prior numbers; no streak-based selection rule is proposed"],
    ["Random Top-4", "The random benchmark exists only as a reference measurement, never as a policy"],
    ["Historical-result leakage", "Lifecycle order (settle, append, recalculate, lock) is already enforced and proven on-page; the validation harness asserts prediction timestamps strictly precede result timestamps"],
    ["Manual prediction override", "No override path is proposed; the lock remains the single source of truth"],
  ],
  [34, 66], 18));
S.push(body("With this diagnostic complete, the gate condition of the optimization program is satisfied: the dominant miss causes are quantified, the responsible mechanisms are identified in code, the optimizer and calibration are audited, the reliability layer status is established, and the proposed changes carry explicit risks and a validation path. Implementation may proceed in a separate change set behind flags, with the frozen-baseline replay retained as the permanent reference."));

// ================= Appendix A =================
S.push(h1("Appendix A. Per-Miss Ledger (60 rounds)"));
S.push(body("The table lists every miss in the 178-round window with its displacement attribution. Displacer is the lowest-prior member of the locked set, i.e. the outcome that would have been exchanged for the actual under a one-slot correction. Classification: Avoidable means the actual was a number and a baseline lock would have covered it; Structural means the actual was a bonus that the lock did not contain."));
S.push(caption("Table 10: Full per-miss ledger with displacement attribution"));
S.push(tbl(
  ["Round", "Actual", "Locked Top-4", "kB", "Conf", "Displacer", "Classification"],
  ledger,
  [8, 13, 32, 5, 7, 13, 22], 16));

// ================= Assembly =================
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  styles: { default: { document: {
    run: { font: { ascii: "Times New Roman", eastAsia: "SimSun" }, size: 24, color: BODY },
    paragraph: { spacing: { line: 312 } },
  }}},
  features: { updateFields: true },
  sections: [
    { // Section 1: cover — margin 0, no footer/header
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: "Top-4 Coverage Engine — Diagnostic Report",
        subtitle: "Pre-code root-cause analysis: why the dynamic Top-4 loses the theoretical [1, 2, 5, 10] baseline",
        englishLabel: "ENGINEERING RCA",
        metaLines: [
          "Dataset: 178 stored walk-forward rounds (era-3 clean validation)",
          "Mode: observation-only — zero production code modified",
          "Benchmarks: dynamic 66.29% vs theoretical 85.96% vs random 50.00%",
          "Prepared for: Top-4 Coverage Optimization Program",
          "Date: 2026-09-13",
        ],
        footerLeft: "Prediction Engine Development — Phase 1",
        footerRight: "Confidential — internal working document",
        palette: PAL,
      }),
    },
    { // Section 2: TOC — Roman numerals
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: pageNumFooter() },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "Table of Contents", bold: true, size: 32, color: PRIMARY,
            font: { ascii: "Times New Roman", eastAsia: "SimHei" } })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "Note: This Table of Contents is generated via field codes. To ensure page number accuracy after editing, please right-click the TOC and select \"Update Field.\"",
            italics: true, size: 18, color: "888888", font: { ascii: "Times New Roman" } })],
        }),
        // No trailing PageBreak here: the body is a separate NEXT_PAGE section,
        // so a PageBreak would create a blank page (SKILL.md blank-page rule 1).
      ],
    },
    { // Section 3: body — Arabic from 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: bodyHeader() },
      footers: { default: pageNumFooter() },
      children: S,
    },
  ],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("download/Top4_Coverage_Diagnostic_Report.docx", buf);
  console.log("WROTE download/Top4_Coverage_Diagnostic_Report.docx (" + buf.length + " bytes)");
});
