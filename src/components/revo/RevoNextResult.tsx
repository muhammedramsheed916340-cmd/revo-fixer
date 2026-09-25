"use client";

import { useSyncExternalStore, useMemo, useState } from "react";
import {
  getLiveSpins,
  getLiveSpinsVersion,
  subscribeLiveSpins,
} from "./liveSpinStore";
import {
  predictNextResult,
  validateNextResult,
  settlePrediction,
  type NextResultPrediction,
  type NextResultValidation,
  type SettlementResult,
} from "./nextResultPredictor";
import { type RoundResult } from "./decisionEngine";
import { GAME_CARD_IMAGES } from "./aiStats";

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

export function RevoNextResult() {
  useLiveSpinsVersion();
  const spins = getLiveSpins();
  const [showValidation, setShowValidation] = useState(false);
  const [showAll8, setShowAll8] = useState(false);
  const [settlements, setSettlements] = useState<SettlementResult[]>([]);

  const latestSettledAt = spins[0]?.settledAt ?? "";
  const spinCount = spins.length;
  const spinsKey = `${spinCount}-${latestSettledAt}`;

  // Generate the single next-result prediction
  const prediction = useMemo<NextResultPrediction | null>(() => {
    if (spinCount < 1) return null;
    const currentSpins = getLiveSpins();
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
    return predictNextResult(history, currentSpins);
  }, [spinsKey]);

  // Walk-forward validation
  const validation = useMemo<NextResultValidation | null>(() => {
    if (!showValidation || spinCount < 5) return null;
    const currentSpins = getLiveSpins();
    const recent = currentSpins.slice(0, MAX_ROUNDS).reverse();
    const actualNames = recent.map((s) => SECTOR_TO_GAME[s.sector] ?? s.sector);
    return validateNextResult(actualNames, currentSpins);
  }, [showValidation, spinsKey]);

  // Auto-settle: check if the latest result matches our last prediction
  const lastSettlement = settlements[settlements.length - 1];
  const lastResult = spins[0] ? SECTOR_TO_GAME[spins[0].sector] : null;

  // Auto-settle when a new result arrives
  const lastSettledTime = lastSettlement?.settledAt ?? 0;
  const latestResultTime = spins[0] ? new Date(spins[0].settledAt).getTime() : 0;
  if (prediction && lastResult && latestResultTime > lastSettledTime && latestResultTime > 0) {
    const settlement = settlePrediction(prediction, lastResult);
    // Use queueMicrotask to defer state update
    queueMicrotask(() => {
      setSettlements((prev) => [...prev, settlement].slice(-20));
    });
  }

  if (!prediction) {
    return (
      <section id="next-result" className="scroll-mt-20 px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <div className="revo-card p-8 text-sm text-[#5a6a99]">
            Waiting for live spins (currently {spinCount})…
          </div>
        </div>
      </section>
    );
  }

  const predictedColor = GAME_COLOR[prediction.predictedOutcome] ?? "#8899cc";
  const predictedImgKey = GAME_TO_IMAGE[prediction.predictedOutcome] ?? "";

  // Recent settlements
  const recentHits = settlements.filter((s) => s.hit).length;
  const totalSettled = settlements.length;

  return (
    <section id="next-result" className="scroll-mt-20 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        {/* === NEXT RESULT (single prediction) === */}
        <div
          className="revo-card overflow-hidden"
          style={{
            borderColor: `${predictedColor}40`,
            boxShadow: `0 0 40px -10px ${predictedColor}40`,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ background: `linear-gradient(90deg, ${predictedColor}15, transparent)` }}
          >
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-bullseye" style={{ color: predictedColor }} />
              Next Result
            </span>
            <span className="flex items-center gap-2 text-[10px]">
              <span className="flex items-center gap-1 rounded-full bg-[#2ed573]/15 px-2 py-0.5 font-bold text-[#2ed573]">
                <i className="fas fa-bolt" /> LIVE
              </span>
              <span className="text-[#5a6a99]">
                {new Date(prediction.lockTimestamp).toLocaleTimeString()}
              </span>
            </span>
          </div>

          {/* === THE PREDICTION (single outcome) === */}
          <div className="p-6 text-center">
            <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[#5a6a99]">
              🎯 Next Result
            </div>
            <div className="my-4 flex flex-col items-center gap-2">
              {predictedImgKey && (
                <img
                  src={GAME_CARD_IMAGES[predictedImgKey]}
                  alt={prediction.predictedOutcome}
                  className="h-20 w-20 rounded-xl object-contain"
                  style={{ filter: `drop-shadow(0 0 12px ${predictedColor}40)` }}
                />
              )}
              <div
                className="text-3xl font-black sm:text-4xl"
                style={{ color: predictedColor }}
              >
                {prediction.predictedOutcome}
              </div>
            </div>
            <div className="text-sm text-[#8899cc]">
              Confidence:{" "}
              <span className="font-bold text-white">
                {(prediction.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          {/* === WHY THIS RESULT? === */}
          <div className="border-t border-[#1e2240] p-4">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
              Why this result?
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <SignalDisplay
                label="History"
                state={prediction.signalStates.history}
                score={prediction.scores[0].scores.history}
              />
              <SignalDisplay
                label="Time"
                state={prediction.signalStates.time}
                score={prediction.scores[0].scores.time}
              />
              <SignalDisplay
                label="Dealer"
                state={prediction.signalStates.dealer}
                score={prediction.scores[0].scores.dealer}
              />
              <SignalDisplay
                label="Physics"
                state={prediction.signalStates.physics}
                score={prediction.scores[0].scores.physics}
              />
              <SignalDisplay
                label="ML"
                state={prediction.signalStates.ml}
                score={prediction.scores[0].scores.ml}
              />
              <SignalDisplay
                label="Crossing"
                state={prediction.signalStates.crossing}
                score={prediction.scores[0].scores.crossing}
              />
            </div>
            <div className="mt-2 text-center text-[10px] text-[#5a6a99]">
              Final evidence:{" "}
              <span className="font-bold text-white">
                {(prediction.scores[0].finalScore * 100).toFixed(1)}%
              </span>
              {" · "}Prediction ID:{" "}
              <span className="font-mono">{prediction.predictionId.slice(0, 16)}…</span>
            </div>
          </div>

          {/* === ALL 8 DIAGNOSTIC (optional) === */}
          <div className="border-t border-[#1e2240] p-4">
            <button
              onClick={() => setShowAll8(!showAll8)}
              className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#5a6a99] transition hover:text-white"
            >
              <i className={`fas ${showAll8 ? "fa-chevron-down" : "fa-chevron-right"}`} />
              All 8 Evidence
            </button>
            {showAll8 && (
              <div className="mt-2 space-y-1">
                {prediction.scores.map((s, idx) => (
                  <div
                    key={s.outcome}
                    className="flex items-center justify-between rounded-lg bg-[#0d1020]/60 px-3 py-1.5 text-[10px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#5a6a99]">#{idx + 1}</span>
                      <span
                        className="font-bold"
                        style={{ color: GAME_COLOR[s.outcome] ?? "#8899cc" }}
                      >
                        {s.outcome}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-[#5a6a99]">
                        H:{s.scores.history.toFixed(2)}
                      </span>
                      <span className="text-[#5a6a99]">
                        T:{s.scores.time.toFixed(2)}
                      </span>
                      <span className="text-[#5a6a99]">
                        C:{s.scores.crossing.toFixed(2)}
                      </span>
                      <span className="font-bold text-white">
                        {(s.finalScore * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
                <div className="mt-1 text-[8px] text-[#5a6a99]">
                  Diagnostic only — NOT additional predictions. Only #1 is the prediction.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* === SETTLEMENT TRACKER === */}
        {totalSettled > 0 && (
          <div className="revo-card mt-4 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-check-circle text-[#2ed573]" /> Settlement Tracker
              </span>
              <span className="text-[10px] text-[#5a6a99]">
                Top-1: {recentHits}/{totalSettled} = {((recentHits / totalSettled) * 100).toFixed(0)}%
              </span>
            </div>
            <div className="max-h-32 overflow-y-auto revo-scroll">
              {settlements.slice(-10).reverse().map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between border-b border-[#1e2240]/40 py-1.5 text-[10px]"
                >
                  <span className="text-[#8899cc]">
                    Predicted: <span style={{ color: GAME_COLOR[s.predictedOutcome] }}>{s.predictedOutcome}</span>
                    {" → "}Actual: <span style={{ color: GAME_COLOR[s.actualOutcome] }}>{s.actualOutcome}</span>
                  </span>
                  <span className={s.hit ? "text-[#2ed573]" : "text-[#ff4757]"}>
                    {s.hit ? "✓ HIT" : "✗ MISS"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === WALK-FORWARD VALIDATION === */}
        <div className="revo-card mt-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-flask text-[#2ed573]" /> Walk-Forward Validation
            </span>
            <button
              onClick={() => setShowValidation(!showValidation)}
              className="rounded-lg border border-[#1e2240] bg-[#141827] px-3 py-1 text-[10px] font-bold text-[#8899cc] transition hover:text-white"
            >
              {showValidation ? "Hide" : "Run"}
            </button>
          </div>
          {validation && (
            <div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg bg-[#0d1020] p-3 text-center">
                  <div className="text-[9px] text-[#5a6a99]">Top-1 HIT</div>
                  <div className="text-lg font-black" style={{
                    color: validation.top1HitRate >= 0.3 ? "#2ed573" : "#ff4757",
                  }}>
                    {(validation.top1HitRate * 100).toFixed(1)}%
                  </div>
                  <div className="text-[9px] text-[#5a6a99]">{validation.hits}/{validation.totalRounds}</div>
                </div>
                <div className="rounded-lg bg-[#0d1020] p-3 text-center">
                  <div className="text-[9px] text-[#5a6a99]">Log-Loss</div>
                  <div className="text-lg font-black text-white">{validation.logLoss.toFixed(3)}</div>
                </div>
                <div className="rounded-lg bg-[#0d1020] p-3 text-center">
                  <div className="text-[9px] text-[#5a6a99]">Brier</div>
                  <div className="text-lg font-black text-white">{validation.brierScore.toFixed(3)}</div>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-[#5a6a99]">
                Bonus capture: {validation.bonusHits}/{validation.bonusTotal} = {(validation.bonusCaptureRate * 100).toFixed(0)}%
              </div>
              {/* Round details */}
              <div className="mt-3 max-h-40 overflow-y-auto revo-scroll">
                {validation.rounds.map((r) => (
                  <div key={r.idx} className="mb-1 flex items-center justify-between text-[9px] border-b border-[#1e2240]/40 py-1">
                    <span className="text-[#5a6a99]">#{r.idx}</span>
                    <span className="text-[#8899cc]">
                      predicted: <span style={{ color: GAME_COLOR[r.predicted] }}>{r.predicted}</span>
                      {" → "}actual: <span style={{ color: GAME_COLOR[r.actual] }}>{r.actual}</span>
                    </span>
                    <span className={r.hit ? "text-[#2ed573]" : "text-[#ff4757]"}>
                      {r.hit ? "HIT" : "MISS"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!validation && showValidation && (
            <div className="text-center text-[11px] text-[#5a6a99]">
              Need at least 5 spins (currently {spinCount}).
            </div>
          )}
          {!showValidation && (
            <div className="text-[10px] text-[#5a6a99]">
              Primary metric: Top-1 HIT RATE (not Top-4 coverage).
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function SignalDisplay({
  label,
  state,
  score,
}: {
  label: string;
  state: string;
  score: number;
}) {
  const stateColor =
    state === "READY" ? "#2ed573" :
    state === "INSUFFICIENT" ? "#ffa502" :
    state === "STALE" ? "#8899cc" : "#5a6a99";

  return (
    <div className="rounded-lg bg-[#0d1020] p-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">{label}</span>
        <span className="text-[8px] font-bold" style={{ color: stateColor }}>{state}</span>
      </div>
      <div className="text-sm font-black text-white">{score.toFixed(2)}</div>
    </div>
  );
}
