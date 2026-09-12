// Top-4 Coverage Engine — Diagnostic Report generator (Part 1: setup/helpers/cover/TOC)
// Observation-only diagnostic. No engine code is modified by this script.
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, PageBreak, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  SectionType, TableLayoutType, TableOfContents,
} = require("docx");
const fs = require("fs");

// ---------------- Palette: DM-1 Deep Cyan (AI / tech) ----------------
const PAL = {
  bg: "162235", accent: "37DCF2",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "1B6B7A", headerText: "FFFFFF", accentLine: "1B6B7A", innerLine: "C8DDE2", surface: "EDF3F5" },
};
const PRIMARY = "162235";      // headings
const BODY = "000000";          // body text (Profile A pure black)
const SECONDARY = "505A66";

const noBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
};
const allNoBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
  insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
};

// ---------------- Cover layout helpers (design-system.md) ----------------
// Latin-adapted calcTitleLayout: average Latin glyph width ~= pt * 11 twips
// (CJK version uses pt * 20; structure and guarantees are preserved:
//  dynamic size, <= 3 lines, no 1-2 char orphan lines).
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."-_/ \t", ..."\u2014\u2013\u00B7,;:"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) breakAt = charsPerLine;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 11; // Latin adaptation
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}
function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const safeRemaining = Math.max(usableHeight - contentHeight, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

// ---------------- Recipe R1: Pure Paragraph Cover (left-aligned) ----------------
function buildCoverR1(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "),
        size: 18, color: P.accent, font: { ascii: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true,
        color: P.cover.titleColor, font: { eastAsia: "SimHei", ascii: "Arial" } })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 800, line: 340, lineRule: "atLeast" },
      children: [new TextRun({ text: config.subtitle, size: 24, color: P.cover.subtitleColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 24, color: P.cover.metaColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.cover.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: P.cover.footerColor, font: { ascii: "Arial" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        children,
      })],
    })],
  })];
}

// ---------------- Body content helpers ----------------
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, color: PRIMARY,
      font: { ascii: "Times New Roman", eastAsia: "SimHei" } })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120, line: 312 },
    children: [new TextRun({ text, bold: true, size: 28, color: PRIMARY,
      font: { ascii: "Times New Roman", eastAsia: "SimHei" } })],
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: 120 },
    children: [new TextRun({ text, size: 24, color: BODY, font: { ascii: "Times New Roman" } })],
  });
}
function bodyRuns(runs) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: 120 },
    children: runs.map(r => new TextRun({ size: 24, color: BODY, font: { ascii: "Times New Roman" }, ...r })),
  });
}
function caption(text) {
  return new Paragraph({
    keepNext: true, alignment: AlignmentType.LEFT,
    spacing: { before: 160, after: 80, line: 312 },
    children: [new TextRun({ text, bold: true, size: 21, color: SECONDARY, font: { ascii: "Times New Roman" } })],
  });
}
function figCaption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 60, after: 160, line: 312 },
    children: [new TextRun({ text, size: 21, color: SECONDARY, font: { ascii: "Times New Roman" } })],
  });
}
function fig(path, displayWidth, origW, origH) {
  const displayHeight = Math.round(displayWidth * origH / origW);
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 120 },
    children: [new ImageRun({ data: fs.readFileSync(path), type: "png",
      transformation: { width: displayWidth, height: displayHeight } })],
  });
}
// Generic table builder: headers[], rows[][], widths[] (percentages)
function tbl(headers, rows, widths, fontSize = 20) {
  const mk = (text, bold, fill, color, w) => new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: AlignmentType.LEFT, spacing: { line: 276 },
      children: [new TextRun({ text: String(text), bold, size: fontSize, color,
        font: { ascii: "Times New Roman" } })],
    })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: PAL.table.innerLine },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headers.map((t, i) => mk(t, true, PAL.table.headerBg, PAL.table.headerText, widths[i])),
      }),
      ...rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: r.map((t, i) => mk(t, false, ri % 2 === 1 ? PAL.table.surface : undefined, BODY, widths[i])),
      })),
    ],
  });
}
function pageNumFooter() {
  return new Footer({ children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: { ascii: "Times New Roman" } })],
  })] });
}
function bodyHeader() {
  return new Header({ children: [new Paragraph({
    alignment: AlignmentType.RIGHT,
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "C8DDE2", space: 4 } },
    children: [new TextRun({ text: "Top-4 Coverage Engine — Diagnostic Report (Pre-Code RCA)", size: 18, color: "808080", font: { ascii: "Times New Roman" } })],
  })] });
}
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
