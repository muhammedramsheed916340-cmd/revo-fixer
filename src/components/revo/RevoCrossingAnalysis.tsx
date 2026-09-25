"use client";

import { useSyncExternalStore, useMemo, useState } from "react";
import {
  getLiveSpins,
  getLiveSpinsVersion,
  subscribeLiveSpins,
} from "./liveSpinStore";
import {
  runCrossingAnalysis,
  validateCrossingAnalysis,
  type CrossingAnalysis,
  type CrossingValidationResult,
} from "./crossingAnalysis";
import {
  runFrozenWalkForward,
  ALL_FLAGS_OFF,
  type RoundResult,
} from "./decisionEngine";
import {
  GAME_CARD_IMAGES,
} from "./aiStats";

const SECTOR_TO_GAME: Record<string, string> = {
  "1": "1", "2": "2", "5": "5", "10": "10",
  CoinFlip: "COIN FLIP", Pachinko: "PACHINKO",
  CashHunt: "CASH HUNT", CrazyTime: "CRAZY TIME",
};

const GAME_COLOR: Record<string, string> = {
  "1": "#448AFF", "2": "#2ed573", "5": "#ffa502", "10": "#ff4757",
  PACHINKO: "#00d4ff", "COIN FLIP": "#a78bfa",
  "CASH HUNT": "#FFD700", "CRAZY TIME": "#ff6b9d",
};

const GAME_TO_IMAGE: Record<string, string> = {
  "1": "1", "2": "2", "5": "5", "10": "10",
  PACHINKO: "Pachinko", "COIN FLIP": "CoinFlip",
  "CASH HUNT": "CashHunt", "CRAZY TIME": "CrazyTime",
};

const MAX_ROUNDS = 12;

function useLiveSpinsVersion(): number {
  return useSyncExternalStore(subscribeLiveSpins, getLiveSpinsVersion, () => 0);
}

export function RevoCrossingAnalysis() {
  useLiveSpinsVersion();
  const spins = getLiveSpins();
  const [showValidation, setShowValidation] = useState(false);

  const latestSettledAt = spins[0]?.settledAt ?? "";
  const spinCount = spins.length;
  const spinsKey = `${spinCount}-${latestSettledAt}`;

  // Run crossing analysis using live data
  const analysis = useMemo<CrossingAnalysis | null>(() => {
    if (spinCount < 3) return null;
    const currentSpins = getLiveSpins();
    // Build history from live spins (oldest→newest)
    const history: RoundResult[] = currentSpins.slice(0, MAX_ROUNDS).reverse().map((s) => ({
      prediction: [],
      actualResult: {
        name: SECTOR_TO_GAME[s.sector] ?? s.sector,
        imageKey: s.sector,
        confidenceRange: [50, 90] as [number, number],
        isBonus: !["1", "2", "5", "10"].includes(s.sector),
      },
      hit: false,
      time: new Date(s.settledAt).getTime(),
      confidence: 50,
      recalibrated: false,
    }));

    // Get engine Top-4 from walk-forward
    const actualNames = history.map((r) => r.actualResult.name);
    const fwfResult = runFrozenWalkForward(actualNames, ALL_FLAGS_OFF, currentSpins);
    const engineTop4 = fwfResult.baseline.rounds[fwfResult.baseline.rounds.length - 1]?.preds ?? ["1", "2", "5", "10"];

    return runCrossingAnalysis(history, currentSpins, engineTop4);
  }, [spinsKey]);

  // Run walk-forward validation
  const validation = useMemo<CrossingValidationResult | null>(() => {
    if (!showValidation || spinCount < 5) return null;
    const currentSpins = getLiveSpins();
    const recent = currentSpins.slice(0, MAX_ROUNDS).reverse();
    const actualNames = recent.map((s) => SECTOR_TO_GAME[s.sector] ?? s.sector);
    return validateCrossingAnalysis(actualNames);
  }, [showValidation, spinsKey]);

  return (
    <section
      id="crossing-analysis"
      className="scroll-mt-20 px-4 py-10 sm:px-6"
      aria-label="Crossing Number Analysis"
    >
      <div className="mx-auto max-w-5xl">
        {/* Heading */}
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#ffa502]">
            <i className="fas fa-arrows-cross" /> Crossing Number Analysis
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Alternative <span className="text-[#ffa502]">Crossing</span> Engine
          </h2>
          <p className="mt-1 text-sm text-[#8899cc]">
            Discovers crossing/alternative candidates from wheel geometry, transitions, timing, and recent evidence
          </p>
        </div>

        {!analysis ? (
          <div className="revo-card p-8 text-center text-sm text-[#5a6a99]">
            Need at least 3 live spins (currently {spinCount}). Waiting for data…
          </div>
        ) : (
          <>
            {/* Last result + Primary */}
            <div className="revo-card mb-4 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <i className="fas fa-arrows-cross text-[#ffa502]" /> Crossing Analysis
                </span>
                <span className="text-[10px] text-[#5a6a99]">{analysis.modelVersion}</span>
              </div>

              {/* Last result */}
              <div className="mb-3 flex items-center gap-3">
                <div className="text-[10px] uppercase tracking-wider text-[#5a6a99]">Last Result:</div>
                <div className="flex items-center gap-2">
                  <img
                    src={GAME_CARD_IMAGES[GAME_TO_IMAGE[analysis.lastResult] ?? ""]}
                    alt={analysis.lastResult}
                    className="h-7 w-7 rounded-md object-contain"
                    loading="lazy"
                  />
                  <span className="text-sm font-black" style={{ color: GAME_COLOR[analysis.lastResult] ?? "#8899cc" }}>
                    {analysis.lastResult}
                  </span>
                </div>
              </div>

              {/* Candidates */}
              <div className="space-y-2">
                {analysis.candidates.map((c, idx) => (
                  <CandidateRow key={c.outcome} candidate={c} rank={idx + 1} />
                ))}
              </div>
            </div>

            {/* Top-4 comparison */}
            <div className="revo-card mb-4 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-balance-scale text-[#a78bfa]" /> Top-4 Comparison
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#ffa502]/30 bg-[#ffa502]/5 p-3">
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#ffa502]">
                    Crossing Top-4
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.top4FromCrossing.map((name) => (
                      <span
                        key={name}
                        className="rounded-md px-2 py-1 text-[10px] font-bold"
                        style={{
                          background: `${GAME_COLOR[name] ?? "#8899cc"}20`,
                          color: GAME_COLOR[name] ?? "#8899cc",
                          border: `1px solid ${GAME_COLOR[name] ?? "#8899cc"}40`,
                        }}
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-[#448AFF]/30 bg-[#448AFF]/5 p-3">
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#448AFF]">
                    Engine Top-4
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.top4FromEngine.map((name) => (
                      <span
                        key={name}
                        className="rounded-md px-2 py-1 text-[10px] font-bold"
                        style={{
                          background: `${GAME_COLOR[name] ?? "#8899cc"}20`,
                          color: GAME_COLOR[name] ?? "#8899cc",
                          border: `1px solid ${GAME_COLOR[name] ?? "#8899cc"}40`,
                        }}
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-[#8899cc]">
                Confidence: <span className="font-bold text-white">{(analysis.confidence * 100).toFixed(0)}%</span>
                {" · "}Engine and Crossing Top-4 may differ — final selection uses the complete 8-outcome ranking.
              </div>
            </div>

            {/* Validation */}
            <div className="revo-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <i className="fas fa-flask text-[#2ed573]" /> Walk-Forward Validation
                </span>
                <button
                  onClick={() => setShowValidation(!showValidation)}
                  className="rounded-lg border border-[#1e2240] bg-[#141827] px-3 py-1 text-[10px] font-bold text-[#8899cc] transition hover:text-white"
                >
                  {showValidation ? "Hide" : "Run"} Validation
                </button>
              </div>
              {validation && (
                <div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="rounded-lg bg-[#0d1020] p-3 text-center">
                      <div className="text-[9px] text-[#5a6a99]">Crossing HIT</div>
                      <div className="text-lg font-black" style={{
                        color: validation.crossingHitRate >= 0.8 ? "#2ed573" : "#ffa502",
                      }}>
                        {(validation.crossingHitRate * 100).toFixed(1)}%
                      </div>
                      <div className="text-[9px] text-[#5a6a99]">{validation.crossingHits}/{validation.totalRounds}</div>
                    </div>
                    <div className="rounded-lg bg-[#0d1020] p-3 text-center">
                      <div className="text-[9px] text-[#5a6a99]">Engine HIT</div>
                      <div className="text-lg font-black text-[#448AFF]">
                        {(validation.engineHitRate * 100).toFixed(1)}%
                      </div>
                      <div className="text-[9px] text-[#5a6a99]">{validation.engineHits}/{validation.totalRounds}</div>
                    </div>
                    <div className="rounded-lg bg-[#0d1020] p-3 text-center">
                      <div className="text-[9px] text-[#5a6a99]">Improvement</div>
                      <div className="text-lg font-black" style={{
                        color: validation.improvement > 0 ? "#2ed573" : "#ff4757",
                      }}>
                        {validation.improvement >= 0 ? "+" : ""}{(validation.improvement * 100).toFixed(1)}pp
                      </div>
                      <div className="text-[9px] text-[#5a6a99]">crossing vs engine</div>
                    </div>
                  </div>
                  <div className={`mt-3 rounded-lg border p-3 text-center text-xs font-bold ${
                    validation.validated
                      ? "border-[#2ed573]/40 bg-[#2ed573]/10 text-[#2ed573]"
                      : "border-[#ffa502]/40 bg-[#ffa502]/10 text-[#ffa502]"
                  }`}>
                    <i className={`fas ${validation.validated ? "fa-check-circle" : "fa-hourglass-half"} mr-1`} />
                    {validation.validated
                      ? `VALIDATED — crossing improves Top-4 by ${(validation.improvement * 100).toFixed(1)}pp`
                      : `NOT VALIDATED — crossing does not improve out-of-sample (improvement: ${(validation.improvement * 100).toFixed(1)}pp)`}
                  </div>
                  {/* Round details */}
                  <div className="mt-3 max-h-48 overflow-y-auto revo-scroll">
                    {validation.rounds.map((r) => (
                      <div key={r.idx} className="mb-1 flex items-center justify-between text-[9px] border-b border-[#1e2240]/40 py-1">
                        <span className="text-[#5a6a99]">#{r.idx}</span>
                        <span className="text-[#8899cc]">last={r.lastResult} → actual={r.actual}</span>
                        <span className="text-[#5a6a99]">crossing=[{r.crossingTop4.join(",")}]</span>
                        <span className={r.crossingHit ? "text-[#2ed573]" : "text-[#ff4757]"}>
                          {r.crossingHit ? "HIT" : "MISS"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!validation && showValidation && (
                <div className="text-center text-[11px] text-[#5a6a99]">
                  Need at least 5 spins for validation (currently {spinCount}).
                </div>
              )}
              {!showValidation && (
                <div className="text-[10px] text-[#5a6a99]">
                  Click "Run Validation" to test crossing analysis with walk-forward backtest.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function CandidateRow({
  candidate,
  rank,
}: {
  candidate: CrossingAnalysis["candidates"][0];
  rank: number;
}) {
  const color = GAME_COLOR[candidate.outcome] ?? "#8899cc";
  const imgKey = GAME_TO_IMAGE[candidate.outcome] ?? "";

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${
        candidate.selected
          ? "border-[#2ed573]/40 bg-[#2ed573]/5"
          : "border-[#1e2240] bg-[#0d1020]/60"
      }`}
    >
      {/* Rank + image */}
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[#1e2240] text-[9px] font-black text-[#8899cc]">
          {rank}
        </span>
        {imgKey && (
          <img
            src={GAME_CARD_IMAGES[imgKey]}
            alt={candidate.outcome}
            className="h-7 w-7 rounded-md object-contain"
            loading="lazy"
          />
        )}
      </div>

      {/* Outcome name + badges */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black" style={{ color }}>
            {candidate.outcome}
          </span>
          {candidate.isPrimary && (
            <span className="rounded bg-[#448AFF]/15 px-1 py-0.5 text-[7px] font-bold uppercase text-[#448AFF]">
              PRIMARY
            </span>
          )}
          {candidate.selected && (
            <span className="rounded bg-[#2ed573]/15 px-1 py-0.5 text-[7px] font-bold uppercase text-[#2ed573]">
              IN TOP-4
            </span>
          )}
        </div>
        {/* Scores */}
        <div className="mt-1 flex flex-wrap gap-1.5 text-[8px]">
          <ScoreChip label="HIST" value={candidate.scores.history} />
          <ScoreChip label="RECENT" value={candidate.scores.recent} />
          <ScoreChip label="TRANS" value={candidate.scores.transition} />
          <ScoreChip label="GEO" value={candidate.scores.geometry} />
          <ScoreChip label="TIME" value={candidate.scores.time} />
        </div>
        {/* Evidence */}
        {candidate.evidence.length > 0 && (
          <div className="mt-1 text-[8px] text-[#5a6a99]">
            {candidate.evidence.join(" · ")}
          </div>
        )}
      </div>

      {/* Final score */}
      <div className="shrink-0 text-right">
        <div className="text-sm font-black text-white">
          {(candidate.finalScore * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  );
}

function ScoreChip({ label, value }: { label: string; value: number }) {
  const color = value >= 1.0 ? "#2ed573" : value >= 0.5 ? "#8899cc" : "#5a6a99";
  return (
    <span
      className="rounded px-1 py-0.5 font-bold"
      style={{ background: `${color}15`, color }}
    >
      {label}:{value.toFixed(2)}
    </span>
  );
}
