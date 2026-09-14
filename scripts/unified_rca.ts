/**
 * UNIFIED ROOT-CAUSE ANALYSIS (READ-ONLY)
 * ========================================
 * Re-runs the C1-C9 engine (ALL_FLAGS_ON) per round with C6 ON to extract
 * the full 8-outcome state for every round, classifies every MISS into
 * categories A-H, and runs counterfactual simulations for candidate principles.
 *
 * Dataset: 200 frozen validation rounds (the original C1-C7 diagnostic set,
 * bit-for-bit verified: baseline 134, exp 165, theo 169).
 *
 * READ-ONLY — does NOT modify any source files.
 */
import { readFileSync, writeFileSync } from "fs";
import {
  buildInitial,
  ALL_FLAGS_OFF,
  MODEL_VERSION,
  BONUS_NAMES,
  THEORETICAL,
  GAMES,
  type FeatureFlags,
  type RoundResult,
  type LockedRcaRecord,
} from "../src/components/revo/decisionEngine";

const ACTUALS_FILE = "scripts/data/frozen_validation_actuals.json";
const REPORT_FILE = "scripts/data/unified_rca_report.json";

const ALL_FLAGS_ON: FeatureFlags = {
  c1_calibratedChannel: true, c2_genericReliability: true, c3_uncertaintyShrinkage: true,
  c4_realOptimizer: true, c5_deScopeHarmful: true, c6_rcaInstrumentation: true,
  c7_frozenWalkForward: true, c8_credibleLowerBound: false, c9_recencyExcludeLast: false,
};
const NUMBER_NAMES = ["1", "2", "5", "10"];
const gameByName = new Map(GAMES.map((g) => [g.name, g]));

function makeRound(actualName: string): RoundResult {
  const game = gameByName.get(actualName)!;
  return {
    prediction: NUMBER_NAMES.map((n) => ({ game: gameByName.get(n)!, confidence: 50, time: Date.now() })),
    actualResult: game, hit: NUMBER_NAMES.includes(actualName),
    time: Date.now(), confidence: 50, recalibrated: false,
  };
}

interface OutcomeState {
  name: string; rank: number; selected: boolean; rawScore: number;
  calibratedProbability?: number; calibratedProbabilityPosterior?: number;
  reliability?: number; uncertainty?: number; selectionScore?: number;
  priorProbability?: number; effectiveSampleSize?: number;
  lowerBoundProbability?: number; signals: string[];
}

interface RoundState {
  roundId: number; actual: string; top4: string[]; hit: boolean; theoHit: boolean;
  excludedFifth: string; allOutcomes: OutcomeState[];
  missCategory?: string; missReason?: string;
}

/** Run engine per round, capture full state with C6 ON. */
function captureStates(actualNames: string[], flags: FeatureFlags): RoundState[] {
  const history: RoundResult[] = [];
  const states: RoundState[] = [];
  for (let i = 0; i < actualNames.length; i++) {
    const actual = actualNames[i];
    const eng = buildInitial(history, [], "baseline", flags);
    const top4 = eng.predictions.map((p) => p.game.name);
    const hit = top4.includes(actual);
    const theoHit = NUMBER_NAMES.includes(actual);
    const allOutcomes: OutcomeState[] = eng.candidateScores.map((c) => ({
      name: c.game.name, rank: c.rank ?? 0, selected: top4.includes(c.game.name),
      rawScore: c.rawScore,
      calibratedProbability: (c as typeof c & { calibratedProbability?: number }).calibratedProbability,
      calibratedProbabilityPosterior: c.calibratedProbabilityPosterior,
      reliability: c.reliability, uncertainty: c.uncertainty,
      selectionScore: c.selectionScore, priorProbability: c.priorProbability,
      effectiveSampleSize: eng.lockedRca?.allOutcomes.find((o) => o.name === c.game.name)?.effectiveSampleSize,
      lowerBoundProbability: eng.lockedRca?.allOutcomes.find((o) => o.name === c.game.name)?.lowerBoundProbability,
      signals: c.signals,
    }));
    const state: RoundState = {
      roundId: i + 1, actual, top4, hit, theoHit,
      excludedFifth: eng.lockedRca?.excludedFifth ?? "",
      allOutcomes,
    };
    if (!hit) {
      const { category, reason } = classifyMiss(actual, top4, allOutcomes, theoHit);
      state.missCategory = category;
      state.missReason = reason;
    }
    states.push(state);
    history.push(makeRound(actual));
  }
  return states;
}

function classifyMiss(actual: string, top4: string[], outcomes: OutcomeState[], theoHit: boolean) {
  const isBonusActual = BONUS_NAMES.includes(actual);
  const actualEntry = outcomes.find((o) => o.name === actual);
  const rank = actualEntry?.rank ?? 0;
  const posterior = actualEntry?.calibratedProbabilityPosterior ?? 0;
  const reliability = actualEntry?.reliability ?? 1;
  const excludedFifth = outcomes.find((o) => o.rank === 5)?.name ?? "";

  // E. Cold-start (empty preds)
  if (top4.length === 0) {
    return { category: "E", reason: `Cold-start: empty predictions on round 1 (no history). Theoretical [1,2,5,10] always picks 4 → HIT. Actual=${actual} missed by experimental only.` };
  }

  if (isBonusActual) {
    // Bonus was the actual. Was it included?
    if (!top4.includes(actual)) {
      // Check if reliability was below gate
      if (reliability < 0.4) {
        return { category: "A", reason: `Unavoidable bonus miss. ${actual} (prior ${(THEORETICAL[actual]*100).toFixed(2)}%) was actual; reliability=${reliability.toFixed(2)} < gate 0.40. Both [1,2,5,10] and experimental missed. Irreducible bonus-actual floor.` };
      }
      return { category: "B", reason: `Bonus ${actual} excluded despite reliability=${reliability.toFixed(2)} ≥ gate. Posterior=${(posterior*100).toFixed(2)}%. Possible over-suppression by C4/C8.` };
    }
    return { category: "A", reason: `Unavoidable bonus miss. ${actual} WAS in Top-4 but a different bonus was actual. Irreducible.` };
  }

  // Normal number was actual but excluded. Why?
  const bonusesInTop4 = top4.filter((n) => BONUS_NAMES.includes(n));
  if (bonusesInTop4.length > 0) {
    // A bonus displaced the actual number
    return {
      category: "C",
      reason: `Normal-number displacement. Actual=${actual} (prior ${(THEORETICAL[actual]*100).toFixed(2)}%) was rank ${rank}, excluded by bonus(es) [${bonusesInTop4.join(",")}]. [1,2,5,10] would HIT. The displacing bonus(es) had insufficient evidence to justify displacing a number.`,
    };
  }

  // No bonuses in Top-4, but actual number was excluded (e.g., "10" excluded for another number)
  // Check if posterior was strong enough to warrant inclusion
  if (posterior > 0.05) {
    return {
      category: "D",
      reason: `Wrong ranking despite strong posterior. Actual=${actual} had posterior=${(posterior*100).toFixed(2)}% (rank ${rank}) but was excluded. The optimizer selected [${top4.join(",")}] instead. #5=${excludedFifth}.`,
    };
  }

  return { category: "H", reason: `Other: actual=${actual}, rank=${rank}, posterior=${(posterior*100).toFixed(2)}%, top4=[${top4.join(",")}]` };
}

/** Counterfactual: protect a strongly-supported normal number from weak bonus displacement.
 *  Rule: if a bonus's reliability < gate AND a number's posterior > bonus's posterior,
 *  exclude the bonus and include the number instead. */
function counterfactual_protectNumber(states: RoundState[], gateThreshold: number): { hits: number; changed: number; falsePositives: number } {
  let hits = 0; let changed = 0; let falsePositives = 0;
  for (const s of states) {
    let top4 = [...s.top4];
    // Find bonuses in top4 with reliability < gate
    const weakBonuses = top4.filter((n) => BONUS_NAMES.includes(n));
    let modified = false;
    for (const bonus of weakBonuses) {
      const bonusEntry = s.allOutcomes.find((o) => o.name === bonus)!;
      if ((bonusEntry.reliability ?? 1) < gateThreshold) {
        // Replace with the highest-posterior excluded number
        const excludedNumbers = s.allOutcomes
          .filter((o) => NUMBER_NAMES.includes(o.name) && !top4.includes(o.name))
          .sort((a, b) => (b.calibratedProbabilityPosterior ?? 0) - (a.calibratedProbabilityPosterior ?? 0));
        if (excludedNumbers.length > 0) {
          top4[top4.indexOf(bonus)] = excludedNumbers[0].name;
          modified = true;
        }
      }
    }
    if (modified) changed++;
    if (top4.includes(s.actual)) hits++;
    else if (modified) falsePositives++;
  }
  return { hits, changed, falsePositives };
}

/** Counterfactual: require stronger evidence (higher reliability gate) for ALL bonus entry. */
function counterfactual_strongerBonusGate(states: RoundState[], gate: number): { hits: number; changed: number } {
  let hits = 0; let changed = 0;
  for (const s of states) {
    let top4 = [...s.top4];
    let modified = false;
    for (const bonus of [...top4]) {
      if (BONUS_NAMES.includes(bonus)) {
        const entry = s.allOutcomes.find((o) => o.name === bonus)!;
        if ((entry.reliability ?? 1) < gate) {
          // Remove bonus, add next-best number
          const excludedNumbers = s.allOutcomes
            .filter((o) => NUMBER_NAMES.includes(o.name) && !top4.includes(o.name))
            .sort((a, b) => (b.calibratedProbabilityPosterior ?? 0) - (a.calibratedProbabilityPosterior ?? 0));
          if (excludedNumbers.length > 0) {
            top4[top4.indexOf(bonus)] = excludedNumbers[0].name;
            modified = true;
          }
        }
      }
    }
    if (modified) changed++;
    if (top4.includes(s.actual)) hits++;
  }
  return { hits, changed };
}

/** Counterfactual: posterior margin — only include a bonus if its posterior exceeds the 4th-ranked number's by a margin. */
function counterfactual_posteriorMargin(states: RoundState[], margin: number): { hits: number; changed: number } {
  let hits = 0; let changed = 0;
  for (const s of states) {
    let top4 = [...s.top4];
    let modified = false;
    // For each bonus in top4, check if its posterior exceeds the best excluded number by `margin`
    for (const bonus of [...top4]) {
      if (BONUS_NAMES.includes(bonus)) {
        const bonusPost = s.allOutcomes.find((o) => o.name === bonus)?.calibratedProbabilityPosterior ?? 0;
        const bestExcludedNumber = s.allOutcomes
          .filter((o) => NUMBER_NAMES.includes(o.name) && !top4.includes(o.name))
          .sort((a, b) => (b.calibratedProbabilityPosterior ?? 0) - (a.calibratedProbabilityPosterior ?? 0))[0];
        if (bestExcludedNumber) {
          const numPost = bestExcludedNumber.calibratedProbabilityPosterior ?? 0;
          if (bonusPost - numPost < margin) {
            // Bonus doesn't have enough margin → replace with the number
            top4[top4.indexOf(bonus)] = bestExcludedNumber.name;
            modified = true;
          }
        }
      }
    }
    if (modified) changed++;
    if (top4.includes(s.actual)) hits++;
  }
  return { hits, changed };
}

/** Counterfactual: uncertainty-aware bonus entry — require LB > threshold (C8 with different gate). */
function counterfactual_uncertaintyBonus(states: RoundState[], lbThreshold: number): { hits: number; changed: number } {
  let hits = 0; let changed = 0;
  for (const s of states) {
    let top4 = [...s.top4];
    let modified = false;
    for (const bonus of [...top4]) {
      if (BONUS_NAMES.includes(bonus)) {
        const entry = s.allOutcomes.find((o) => o.name === bonus)!;
        const rel = entry.reliability ?? 1;
        const nEff = rel >= 1 ? 1e9 : (rel > 0 ? 10 * rel / (1 - rel) : 0);
        const post = entry.calibratedProbabilityPosterior ?? 0;
        const se = nEff > 0 ? Math.sqrt((post * (1 - post)) / nEff) : 1;
        const lb = Math.max(0, post - 1.96 * se);
        if (lb < lbThreshold) {
          const excludedNumbers = s.allOutcomes
            .filter((o) => NUMBER_NAMES.includes(o.name) && !top4.includes(o.name))
            .sort((a, b) => (b.calibratedProbabilityPosterior ?? 0) - (a.calibratedProbabilityPosterior ?? 0));
          if (excludedNumbers.length > 0) {
            top4[top4.indexOf(bonus)] = excludedNumbers[0].name;
            modified = true;
          }
        }
      }
    }
    if (modified) changed++;
    if (top4.includes(s.actual)) hits++;
  }
  return { hits, changed };
}

function main() {
  const actualNames: string[] = JSON.parse(readFileSync(ACTUALS_FILE, "utf-8"));
  console.log("=".repeat(70));
  console.log("UNIFIED ROOT-CAUSE ANALYSIS (READ-ONLY)");
  console.log("=".repeat(70));
  console.log(`Dataset: ${actualNames.length} frozen rounds (C1-C7 diagnostic, verified 134/165/169)`);
  console.log(`Engine: ${MODEL_VERSION} with C1-C7 ON (C8/C9 OFF — matches the validation config)`);
  console.log("");

  // Capture full per-round state
  console.log("Capturing per-round state (200 rounds, C6 ON)...");
  const states = captureStates(actualNames, ALL_FLAGS_ON);

  // ===== MISS CLASSIFICATION =====
  const misses = states.filter((s) => !s.hit);
  const theoMisses = states.filter((s) => !s.theoHit);
  const dynamicOnlyMisses = misses.filter((s) => s.theoHit); // theo HIT, exp MISS
  const bonusActualMisses = misses.filter((s) => BONUS_NAMES.includes(s.actual));

  const cats: Record<string, number> = {};
  for (const m of misses) { const c = m.missCategory ?? "H"; cats[c] = (cats[c] ?? 0) + 1; }

  console.log("");
  console.log("=".repeat(70));
  console.log("1. EXACT MISS RCA");
  console.log("=".repeat(70));
  console.log(`Total misses: ${misses.length}/200`);
  console.log(`Theoretical-baseline misses: ${theoMisses.length}/200`);
  console.log(`Dynamic-only misses (theo HIT, exp MISS): ${dynamicOnlyMisses.length}`);
  console.log(`Bonus-actual misses: ${bonusActualMisses.length}`);
  console.log("");
  console.log("Category breakdown:");
  const catNames: Record<string, string> = {
    A: "Unavoidable bonus miss", B: "Unnecessary bonus inclusion",
    C: "Normal-number displacement", D: "Wrong ranking despite strong posterior",
    E: "Cold-start artifact", F: "Feature/optimizer conflict",
    G: "Data/history issue", H: "Other",
  };
  for (const cat of Object.keys(cats).sort()) {
    console.log(`  ${cat}. ${catNames[cat] ?? "Unknown"}: ${cats[cat]} (${(cats[cat]/misses.length*100).toFixed(1)}%)`);
  }

  // ===== DYNAMIC-ONLY MISS DETAIL =====
  console.log("");
  console.log("=".repeat(70));
  console.log("2. DYNAMIC-ONLY MISS DETAIL (theo HIT, exp MISS)");
  console.log("=".repeat(70));
  for (const m of dynamicOnlyMisses) {
    const actualEntry = m.allOutcomes.find((o) => o.name === m.actual)!;
    const displacer = m.top4.filter((n) => BONUS_NAMES.includes(n)).join(",") || m.excludedFifth;
    console.log(`  R${m.roundId}: actual=${m.actual.padEnd(10)} rank=${actualEntry?.rank} post=${((actualEntry?.calibratedProbabilityPosterior ?? 0)*100).toFixed(2)}% top4=[${m.top4.join(",")}] #5=${m.excludedFifth} cat=${m.missCategory}`);
    console.log(`    Reason: ${m.missReason}`);
  }

  // ===== OUTCOME-SPECIFIC ERROR RATES =====
  console.log("");
  console.log("=".repeat(70));
  console.log("3. OUTCOME-SPECIFIC ERROR RATES");
  console.log("=".repeat(70));
  for (const name of [...NUMBER_NAMES, ...BONUS_NAMES]) {
    const appeared = states.filter((s) => s.actual === name).length;
    const missed = states.filter((s) => s.actual === name && !s.hit).length;
    if (appeared > 0) {
      console.log(`  ${name.padEnd(12)} actual ${appeared}× → missed ${missed}× (${(missed/appeared*100).toFixed(1)}% miss rate)`);
    }
  }

  // ===== COUNTERFACTUALS =====
  console.log("");
  console.log("=".repeat(70));
  console.log("5. COUNTERFACTUAL SIMULATIONS");
  console.log("=".repeat(70));
  const baseHits = states.filter((s) => s.hit).length;
  const theoHits = states.filter((s) => s.theoHit).length;
  console.log(`Baseline: experimental ${baseHits}/200, theoretical ${theoHits}/200`);
  console.log("");

  console.log("Candidate 1: Protect strongly-supported normal number from weak bonus displacement");
  for (const gate of [0.3, 0.4, 0.5, 0.6]) {
    const r = counterfactual_protectNumber(states, gate);
    console.log(`  gate=${gate}: ${r.hits}/200 (${(r.hits/200*100).toFixed(2)}%) changed=${r.changed} falsePos=${r.falsePositives} delta=${r.hits - baseHits > 0 ? "+" : ""}${r.hits - baseHits}`);
  }

  console.log("");
  console.log("Candidate 2: Require stronger evidence (higher reliability gate) for ALL bonus entry");
  for (const gate of [0.3, 0.4, 0.5, 0.55, 0.6]) {
    const r = counterfactual_strongerBonusGate(states, gate);
    console.log(`  gate=${gate}: ${r.hits}/200 (${(r.hits/200*100).toFixed(2)}%) changed=${r.changed} delta=${r.hits - baseHits > 0 ? "+" : ""}${r.hits - baseHits}`);
  }

  console.log("");
  console.log("Candidate 3: Posterior margin — only include bonus if its posterior exceeds 4th number by margin");
  for (const margin of [0.00, 0.01, 0.02, 0.03, 0.05]) {
    const r = counterfactual_posteriorMargin(states, margin);
    console.log(`  margin=${margin}: ${r.hits}/200 (${(r.hits/200*100).toFixed(2)}%) changed=${r.changed} delta=${r.hits - baseHits > 0 ? "+" : ""}${r.hits - baseHits}`);
  }

  console.log("");
  console.log("Candidate 4: Uncertainty-aware bonus entry (LB threshold)");
  for (const lb of [0.0, 0.005, 0.01, 0.02]) {
    const r = counterfactual_uncertaintyBonus(states, lb);
    console.log(`  lbThreshold=${lb}: ${r.hits}/200 (${(r.hits/200*100).toFixed(2)}%) changed=${r.changed} delta=${r.hits - baseHits > 0 ? "+" : ""}${r.hits - baseHits}`);
  }

  // ===== TOP CAUSES =====
  console.log("");
  console.log("=".repeat(70));
  console.log("4. TOP CAUSES RANKED BY IMPACT");
  console.log("=".repeat(70));
  const sortedCats = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedCats) {
    console.log(`  ${cat}. ${catNames[cat] ?? "Unknown"}: ${count} misses (${(count/misses.length*100).toFixed(1)}%)`);
  }

  // ===== WRITE JSON =====
  const report = {
    meta: { dataset: "200 frozen rounds", modelVersion: MODEL_VERSION, analysisDate: new Date().toISOString(), readOnly: true },
    headline: { baseline: "134/200=67%", experimental: "165/200=82.5%", theoretical: "169/200=84.5%" },
    missRca: misses.map((m) => ({
      roundId: m.roundId, actual: m.actual, top4: m.top4, theoHit: m.theoHit,
      actualRank: m.allOutcomes.find((o) => o.name === m.actual)?.rank,
      excludedFifth: m.excludedFifth, missCategory: m.missCategory, missReason: m.missReason,
      allOutcomes: m.allOutcomes.map((o) => ({
        name: o.name, rank: o.rank, selected: o.selected, rawScore: o.rawScore,
        posterior: o.calibratedProbabilityPosterior, reliability: o.reliability,
        uncertainty: o.uncertainty, selectionScore: o.selectionScore, prior: o.priorProbability,
      })),
    })),
    missCategories: cats,
    dynamicOnlyMisses: dynamicOnlyMisses.length,
    counterfactuals: {
      protectNumber: [0.3, 0.4, 0.5, 0.6].map((g) => ({ gate: g, ...counterfactual_protectNumber(states, g) })),
      strongerBonusGate: [0.3, 0.4, 0.5, 0.55, 0.6].map((g) => ({ gate: g, ...counterfactual_strongerBonusGate(states, g) })),
      posteriorMargin: [0.00, 0.01, 0.02, 0.03, 0.05].map((m) => ({ margin: m, ...counterfactual_posteriorMargin(states, m) })),
      uncertaintyBonus: [0.0, 0.005, 0.01, 0.02].map((lb) => ({ lb, ...counterfactual_uncertaintyBonus(states, lb) })),
    },
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log("");
  console.log(`Full report → ${REPORT_FILE}`);
  console.log("");
  console.log("=".repeat(70));
  console.log("RCA COMPLETE — READ-ONLY. No source changes. No commits. No live validation.");
  console.log("=".repeat(70));
}

main();
