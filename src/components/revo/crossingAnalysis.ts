/**
 * CROSSING NUMBER ANALYSIS
 * ========================
 *
 * For every settled result, calculates a Crossing/Alternative candidate set
 * using multiple evidence sources:
 *
 *   1. Wheel-geometry score (54-sector physical adjacency)
 *   2. Transition score (Markov P(next | last) from real history)
 *   3. Recent-window score (frequency in last N spins)
 *   4. Physics-projected score (from video physics if available)
 *   5. Time/dealer score (temporal patterns)
 *
 * The system DISCOVERS alternatives from actual data — no hardcoded mapping.
 *
 * "1 → always 1" is NOT a rule.
 * "1 → always X" is NOT a rule.
 *
 * The final Top-4 still comes from the complete 8-outcome ranking.
 * Crossing candidates are NOT automatically included.
 */

import {
  GAMES,
  BONUS_NAMES,
  THEORETICAL,
  type RoundResult,
} from "./decisionEngine";
import type { SpinData } from "./aiStats";
import {
  PHYSICAL_ORDER_54,
  SECTOR_WIDTH,
  sectorToOutcome,
  angleToSector,
} from "./videoPhysicsPredictor";

// ============================================================
// TYPES
// ============================================================

export interface CrossingCandidate {
  outcome: string;
  isPrimary: boolean;
  scores: {
    history: number;      // long-term frequency evidence
    recent: number;        // recent-window frequency
    transition: number;    // P(next=outcome | last=primary)
    geometry: number;      // 54-sector physical adjacency
    physics: number;       // video physics projection (0 if no video)
    time: number;           // temporal pattern
  };
  finalScore: number;
  evidence: string[];
  selected: boolean;       // whether it made it into the final Top-4
}

export interface CrossingAnalysis {
  lastResult: string;
  primaryOutcome: string;
  candidates: CrossingCandidate[];
  top4FromCrossing: string[];  // Top-4 from crossing analysis
  top4FromEngine: string[];   // Top-4 from main engine (for comparison)
  confidence: number;
  reason: string;
  modelVersion: string;
}

// ============================================================
// 54-SECTOR GEOMETRY
// ============================================================

/**
 * Get the sector indices for a given outcome.
 * E.g., "1" has 21 sectors, "2" has 13, etc.
 */
function getSectorsForOutcome(outcome: string): number[] {
  const sectors: number[] = [];
  for (let i = 0; i < 54; i++) {
    if (sectorToOutcome(i) === outcome) sectors.push(i);
  }
  return sectors;
}

/**
 * Calculate the minimum circular distance between any sector of
 * outcome A and any sector of outcome B on the 54-sector wheel.
 *
 * Returns distance in sectors (0 = same, 1 = adjacent, etc.)
 */
function sectorDistance(outcomeA: string, outcomeB: string): number {
  const sectorsA = getSectorsForOutcome(outcomeA);
  const sectorsB = getSectorsForOutcome(outcomeB);
  let minDist = 27; // max possible distance on 54-sector wheel
  for (const a of sectorsA) {
    for (const b of sectorsB) {
      const d = Math.abs(a - b);
      const circularD = Math.min(d, 54 - d);
      if (circularD < minDist) minDist = circularD;
    }
  }
  return minDist;
}

/**
 * Calculate geometry score: closer sectors on the wheel = higher score.
 * Distance 0 (same outcome) = 1.0
 * Distance 1 (adjacent) = 0.9
 * Distance 2 = 0.8
 * ...down to 0 at distance >= 10
 */
function geometryScore(primaryOutcome: string, candidateOutcome: string): number {
  if (primaryOutcome === candidateOutcome) return 1.0;
  const dist = sectorDistance(primaryOutcome, candidateOutcome);
  return Math.max(0, 1.0 - dist / 10);
}

// ============================================================
// TRANSITION SCORE (Markov P(next | last))
// ============================================================

/**
 * Calculate P(next=outcome | last=primary) from real history.
 * Returns 0..1.
 */
function transitionScore(
  history: RoundResult[],
  lastOutcome: string,
  candidateOutcome: string,
): number {
  let transitionsFromLast = 0;
  let transitionsToCandidate = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i - 1].actualResult.name === lastOutcome) {
      transitionsFromLast++;
      if (history[i].actualResult.name === candidateOutcome) {
        transitionsToCandidate++;
      }
    }
  }
  if (transitionsFromLast === 0) return 0;
  return transitionsToCandidate / transitionsFromLast;
}

// ============================================================
// RECENT-WINDOW SCORE
// ============================================================

/**
 * Calculate frequency of an outcome in the last N spins.
 * Returns 0..1 (normalized to theoretical).
 */
function recentScore(history: RoundResult[], outcome: string, windowSize = 10): number {
  const recent = history.slice(-windowSize);
  const count = recent.filter((r) => r.actualResult.name === outcome).length;
  const expected = (THEORETICAL[outcome] ?? 0.1) * windowSize;
  if (expected === 0) return 0;
  return Math.min(1.5, count / expected); // cap at 1.5× theoretical
}

// ============================================================
// HISTORY SCORE (long-term frequency)
// ============================================================

/**
 * Calculate long-term frequency evidence.
 * Returns 0..1 (normalized to theoretical).
 */
function historyScore(history: RoundResult[], outcome: string): number {
  if (history.length === 0) return 0.5; // neutral
  const count = history.filter((r) => r.actualResult.name === outcome).length;
  const expected = (THEORETICAL[outcome] ?? 0.1) * history.length;
  if (expected === 0) return 0;
  return Math.min(1.5, count / expected);
}

// ============================================================
// TIME SCORE
// ============================================================

/**
 * Temporal pattern score: outcomes that appear in cycles.
 * Checks if the outcome tends to appear at regular intervals.
 */
function timeScore(history: RoundResult[], outcome: string): number {
  const intervals: number[] = [];
  let lastIdx = -1;
  for (let i = 0; i < history.length; i++) {
    if (history[i].actualResult.name === outcome) {
      if (lastIdx >= 0) intervals.push(i - lastIdx);
      lastIdx = i;
    }
  }
  if (intervals.length < 2) return 0.5; // insufficient data
  const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  const sinceLast = history.length - 1 - lastIdx;
  // If we're near the average interval, boost the score
  if (avgInterval === 0) return 0.5;
  const ratio = sinceLast / avgInterval;
  // Score peaks at ratio=1.0 (due for appearance)
  return Math.max(0, 1.0 - Math.abs(ratio - 1.0) * 0.5);
}

// ============================================================
// MAIN CROSSING ANALYSIS
// ============================================================

/**
 * Run crossing number analysis for the current state.
 *
 * @param history        Settled round history (oldest→newest)
 * @param liveSpins      Live casino spins
 * @param engineTop4     Top-4 from the main engine (for comparison)
 * @returns CrossingAnalysis with candidates and scores
 */
export function runCrossingAnalysis(
  history: RoundResult[],
  liveSpins: SpinData[],
  engineTop4: string[],
): CrossingAnalysis {
  const MODEL_VERSION = "crossing-v1";

  // Determine last result
  const lastRound = history[history.length - 1];
  const lastResult = lastRound?.actualResult.name ?? "1";
  const primaryOutcome = lastResult;

  // Build candidate list: ALL 8 outcomes
  const candidates: CrossingCandidate[] = GAMES.map((game) => {
    const outcome = game.name;
    const isPrimary = outcome === primaryOutcome;

    const hist = historyScore(history, outcome);
    const recent = recentScore(history, outcome, 10);
    const transition = transitionScore(history, lastResult, outcome);
    const geometry = geometryScore(primaryOutcome, outcome);
    const physics = 0; // no video physics in this context
    const time = timeScore(history, outcome);

    // Weighted final score
    // Geometry gets moderate weight — physical proximity matters but
    // isn't deterministic. Transition gets high weight if enough data.
    const hasTransitionData = history.filter((r) => r.actualResult.name === lastResult).length >= 3;
    const transitionWeight = hasTransitionData ? 0.25 : 0.05;
    const geometryWeight = 0.15;
    const historyWeight = 0.20;
    const recentWeight = 0.20;
    const timeWeight = 0.10;
    const physicsWeight = 0.05;
    // Normalize weights
    const totalWeight = transitionWeight + geometryWeight + historyWeight + recentWeight + timeWeight + physicsWeight;

    const finalScore = (
      transition * transitionWeight +
      geometry * geometryWeight +
      hist * historyWeight +
      recent * recentWeight +
      time * timeWeight +
      physics * physicsWeight
    ) / totalWeight;

    // Build evidence list
    const evidence: string[] = [];
    if (isPrimary) evidence.push("Primary (last result)");
    if (geometry > 0.7) evidence.push(`Geometry: ${sectorDistance(primaryOutcome, outcome)} sectors away (score ${geometry.toFixed(2)})`);
    if (transition > 0.15) evidence.push(`Transition: P(${outcome}|${lastResult})=${(transition * 100).toFixed(0)}%`);
    if (recent > 1.0) evidence.push(`Recent: ${(recent * 100).toFixed(0)}% above theoretical`);
    if (recent < 0.5 && !isPrimary) evidence.push(`Recent: ${(recent * 100).toFixed(0)}% below theoretical`);
    if (time > 0.7) evidence.push(`Timing: due for appearance (score ${time.toFixed(2)})`);
    if (hist > 1.0) evidence.push(`History: ${(hist * 100).toFixed(0)}% above theoretical`);

    return {
      outcome,
      isPrimary,
      scores: {
        history: hist,
        recent,
        transition,
        geometry,
        physics,
        time,
      },
      finalScore,
      evidence,
      selected: false, // will be set after ranking
    };
  });

  // Rank by final score
  const ranked = [...candidates].sort((a, b) => b.finalScore - a.finalScore);

  // Select Top-4 from crossing analysis
  const top4FromCrossing = ranked.slice(0, 4).map((c) => c.outcome);

  // Mark which candidates were selected
  for (const c of candidates) {
    c.selected = top4FromCrossing.includes(c.outcome);
  }

  // Confidence: how concentrated are the top scores?
  const top4Scores = ranked.slice(0, 4).map((c) => c.finalScore);
  const avgTop4 = top4Scores.reduce((s, v) => s + v, 0) / 4;
  const maxScore = ranked[0]?.finalScore ?? 0;
  const confidence = Math.min(1, avgTop4 * 0.7 + maxScore * 0.3);

  // Build reason
  const topCandidate = ranked[0];
  const reasonParts: string[] = [];
  if (topCandidate) {
    reasonParts.push(`Top: ${topCandidate.outcome} (${(topCandidate.finalScore * 100).toFixed(0)}%)`);
    reasonParts.push(...topCandidate.evidence.slice(0, 3));
  }
  reasonParts.push(`Last result: ${lastResult}`);
  reasonParts.push(`Engine Top-4: [${engineTop4.join(", ")}]`);
  reasonParts.push(`Crossing Top-4: [${top4FromCrossing.join(", ")}]`);

  return {
    lastResult,
    primaryOutcome,
    candidates: ranked, // sorted by finalScore
    top4FromCrossing,
    top4FromEngine: engineTop4,
    confidence,
    reason: reasonParts.join(" · "),
    modelVersion: MODEL_VERSION,
  };
}

// ============================================================
// WALK-FORWARD VALIDATION
// ============================================================

export interface CrossingValidationResult {
  totalRounds: number;
  crossingHits: number;
  crossingMisses: number;
  crossingHitRate: number;
  engineHits: number;
  engineHitRate: number;
  theoreticalHits: number;
  theoreticalHitRate: number;
  improvement: number; // crossingHitRate - engineHitRate
  validated: boolean;
  rounds: Array<{
    idx: number;
    actual: string;
    lastResult: string;
    crossingTop4: string[];
    engineTop4: string[];
    crossingHit: boolean;
    engineHit: boolean;
    primaryIncluded: boolean;
  }>;
}

/**
 * Validate the crossing feature using walk-forward testing.
 *
 * For each round, runs crossing analysis using ONLY history before that round,
 * then checks if the actual result was in the crossing Top-4.
 *
 * If the crossing feature does NOT improve out-of-sample performance,
 * marks it as NOT VALIDATED.
 */
export function validateCrossingAnalysis(
  actualNames: string[],
): CrossingValidationResult {
  const rounds: CrossingValidationResult["rounds"] = [];
  let crossingHits = 0;
  let engineHits = 0;
  let theoreticalHits = 0;

  // Build walk-forward history
  const history: RoundResult[] = [];

  for (let i = 0; i < actualNames.length; i++) {
    const actualName = actualNames[i];
    const actualGame = GAMES.find((g) => g.name === actualName) ?? GAMES[0];

    // Get last result
    const lastResult = history.length > 0
      ? history[history.length - 1].actualResult.name
      : "1";

    // Run crossing analysis using ONLY pre-round history
    const analysis = runCrossingAnalysis(history, [], []);

    // Check if actual is in crossing Top-4
    const crossingHit = analysis.top4FromCrossing.includes(actualName);

    // For engine Top-4, use the crossing analysis candidates ranked by score
    // (this is a simplified version — the real engine uses buildInitial)
    const engineTop4 = analysis.top4FromEngine.length > 0
      ? analysis.top4FromEngine
      : analysis.top4FromCrossing;
    const engineHit = engineTop4.includes(actualName);

    // Theoretical [1,2,5,10]
    const theoHit = ["1", "2", "5", "10"].includes(actualName);

    // Check if primary (last result) was in the crossing Top-4
    const primaryIncluded = analysis.top4FromCrossing.includes(lastResult);

    rounds.push({
      idx: i + 1,
      actual: actualName,
      lastResult,
      crossingTop4: analysis.top4FromCrossing,
      engineTop4,
      crossingHit,
      engineHit,
      primaryIncluded,
    });

    if (crossingHit) crossingHits++;
    if (engineHit) engineHits++;
    if (theoHit) theoreticalHits++;

    // Settle round
    history.push({
      prediction: [],
      actualResult: actualGame,
      hit: crossingHit,
      time: Date.now() + i,
      confidence: 50,
      recalibrated: false,
    });
  }

  const total = actualNames.length;
  const crossingHitRate = total > 0 ? crossingHits / total : 0;
  const engineHitRate = total > 0 ? engineHits / total : 0;
  const theoreticalHitRate = total > 0 ? theoreticalHits / total : 0;
  const improvement = crossingHitRate - engineHitRate;

  // Validated only if crossing improves over engine AND over theoretical
  const validated = total >= 10 && improvement > 0.02 && crossingHitRate > theoreticalHitRate;

  return {
    totalRounds: total,
    crossingHits,
    crossingMisses: total - crossingHits,
    crossingHitRate,
    engineHits,
    engineHitRate,
    theoreticalHits,
    theoreticalHitRate,
    improvement,
    validated,
    rounds,
  };
}
