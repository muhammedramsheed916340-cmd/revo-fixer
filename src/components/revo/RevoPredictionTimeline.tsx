"use client";

import { useSyncExternalStore, useMemo, useState } from "react";
import {
  getLiveSpins,
  getLiveSpinsVersion,
  subscribeLiveSpins,
} from "./liveSpinStore";
import { runFrozenWalkForward, ALL_FLAGS_OFF } from "./decisionEngine";
import {
  DISPLAY_NAMES,
  GAME_CARD_IMAGES,
} from "./aiStats";

// ---------------------------------------------------------------------------
// Mapping tables
// ---------------------------------------------------------------------------
// Live spin sector → engine game name
const SECTOR_TO_GAME: Record<string, string> = {
  "1": "1",
  "2": "2",
  "5": "5",
  "10": "10",
  CoinFlip: "COIN FLIP",
  Pachinko: "PACHINKO",
  CashHunt: "CASH HUNT",
  CrazyTime: "CRAZY TIME",
};

// Engine game name → image key (for GAME_CARD_IMAGES lookup)
const GAME_TO_IMAGE: Record<string, string> = {
  "1": "1",
  "2": "2",
  "5": "5",
  "10": "10",
  PACHINKO: "Pachinko",
  "COIN FLIP": "CoinFlip",
  "CASH HUNT": "CashHunt",
  "CRAZY TIME": "CrazyTime",
};

// Color per game name
const GAME_COLOR: Record<string, string> = {
  "1": "#448AFF",
  "2": "#2ed573",
  "5": "#ffa502",
  "10": "#ff4757",
  PACHINKO: "#00d4ff",
  "COIN FLIP": "#a78bfa",
  "CASH HUNT": "#FFD700",
  "CRAZY TIME": "#ff6b9d",
};

const MAX_ROUNDS = 12; // walk-forward window (keep small for performance)

function useLiveSpinsVersion(): number {
  return useSyncExternalStore(subscribeLiveSpins, getLiveSpinsVersion, () => 0);
}

interface BacktestRound {
  idx: number;
  actual: string;
  preds: string[];
  hit: boolean;
  theoHit: boolean;
}

interface BacktestResult {
  rounds: BacktestRound[];
  hits: number;
  misses: number;
  hitRate: number;
  theoreticalHitRate: number;
  totalRounds: number;
}

/**
 * RevoPredictionTimeline
 * ----------------------
 * A walk-forward backtest that closes the loop on prediction accuracy.
 *
 * For each of the last N live spins, the engine is re-run using ONLY the
 * history that was available BEFORE that spin (no data leakage). The
 * prediction (Top-4) is then compared to the actual result.
 *
 * This produces a visual timeline of:
 *  - What the engine predicted (4 outcome badges per round)
 *  - What actually happened (highlighted actual card)
 *  - Hit (green) or Miss (red)
 *  - Running hit-rate vs the theoretical 83.3% baseline
 *
 * IMPORTANT: This is a RETROSPECTIVE diagnostic — it shows what WOULD have
 * been predicted, not what was displayed in real-time. The engine is frozen
 * (ALL_FLAGS_OFF = production baseline) for the entire run.
 */
export function RevoPredictionTimeline() {
  useLiveSpinsVersion();
  const spins = getLiveSpins();

  // Track whether we've already computed (for loading indicator)
  const [computing, setComputing] = useState(false);

  // Memoize the walk-forward backtest — only re-compute when the latest
  // spin's timestamp changes (i.e., a genuinely new spin arrived).
  const latestSettledAt = spins[0]?.settledAt ?? "";
  const spinCount = spins.length;

  const backtest = useMemo<BacktestResult | null>(() => {
    if (spinCount < 5) return null;

    setComputing(true);
    try {
      // Take last MAX_ROUNDS spins, reverse to oldest→newest for the engine
      const recent = spins.slice(0, MAX_ROUNDS).reverse();
      const actualNames = recent.map(
        (s) => SECTOR_TO_GAME[s.sector] ?? s.sector,
      );

      const result = runFrozenWalkForward(
        actualNames,
        ALL_FLAGS_OFF,
        spins,
      );

      return {
        rounds: result.baseline.rounds,
        hits: result.baseline.hits,
        misses: result.baseline.misses,
        hitRate: result.baseline.hitRate,
        theoreticalHitRate: result.theoretical.hitRate,
        totalRounds: result.baseline.totalRounds,
      };
    } catch {
      return null;
    } finally {
      setComputing(false);
    }
  }, [spinCount, latestSettledAt]);

  // Derived stats — SINGLE SOURCE OF TRUTH: roundByRoundResults
  // Do NOT use backtest.hits or backtest.totalRounds (they may be calculated
  // differently). Instead, count directly from the rounds array.
  const roundByRoundResults = backtest?.rounds ?? [];
  const roundByRoundHits = roundByRoundResults.filter((r) => r.hit).length;
  const roundByRoundTotal = roundByRoundResults.length;
  const roundByRoundHitRate = roundByRoundTotal > 0 ? roundByRoundHits / roundByRoundTotal : 0;

  const hits = roundByRoundHits;
  const total = roundByRoundTotal;
  const hitRate = roundByRoundHitRate;
  const theoRate = backtest?.theoreticalHitRate ?? 0;
  const delta = hitRate - theoRate;

  // Consistency assertion: verify main matches round-by-round
  const fwfHits = backtest?.hits ?? 0;
  const fwfTotal = backtest?.totalRounds ?? 0;
  const fwfHitRate = backtest?.hitRate ?? 0;
  const consistencyMismatch =
    fwfHits !== roundByRoundHits ||
    fwfTotal !== roundByRoundTotal ||
    Math.abs(fwfHitRate - roundByRoundHitRate) > 0.001;

  // Current streak (most recent consecutive hits or misses)
  // Derived from the SAME roundByRoundResults (single source of truth)
  const currentStreak = useMemo(() => {
    if (roundByRoundResults.length === 0) return { type: "none", count: 0 };
    const rounds = roundByRoundResults;
    const last = rounds[rounds.length - 1];
    let count = 1;
    for (let i = rounds.length - 2; i >= 0; i--) {
      if (rounds[i].hit === last.hit) count++;
      else break;
    }
    return { type: last.hit ? "hit" : "miss", count };
  }, [roundByRoundResults]);

  return (
    <section
      id="prediction-timeline"
      className="scroll-mt-20 px-4 py-10 sm:px-6"
      aria-label="Prediction vs actual timeline"
    >
      <div className="mx-auto max-w-5xl">
        {/* Heading */}
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#448AFF]">
            <i className="fas fa-bullseye" /> Accuracy Backtest
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Prediction vs{" "}
            <span className="text-[#448AFF]">Actual Timeline</span>
          </h2>
          <p className="mt-1 text-sm text-[#8899cc]">
            Walk-forward backtest of the last {MAX_ROUNDS} live rounds — what
            the engine predicted vs what actually hit. No data leakage.
          </p>
        </div>

        {/* === Consistency assertion warning === */}
        {consistencyMismatch && (
          <div className="mb-3 rounded-lg border border-[#ff4757]/40 bg-[#ff4757]/10 px-3 py-2 text-[10px] text-[#ff4757]">
            <i className="fas fa-triangle-exclamation mr-1" />
            <b>DEV WARNING:</b> Main summary mismatch! roundByRound: {roundByRoundHits}/{roundByRoundTotal}
            ({(roundByRoundHitRate * 100).toFixed(1)}%) vs FWF: {fwfHits}/{fwfTotal}
            ({(fwfHitRate * 100).toFixed(1)}%). Using roundByRound as source of truth.
          </div>
        )}

        {/* === Summary KPIs === */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile
            label="Engine Hit-Rate"
            value={`${(hitRate * 100).toFixed(1)}%`}
            sub={`${hits}/${total} rounds`}
            color={hitRate >= theoRate ? "#2ed573" : "#ffa502"}
            icon="fa-bullseye"
          />
          <SummaryTile
            label="Theoretical [1,2,5,10]"
            value={`${(theoRate * 100).toFixed(1)}%`}
            sub="baseline benchmark"
            color="#448AFF"
            icon="fa-calculator"
          />
          <SummaryTile
            label="Delta vs Theory"
            value={`${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp`}
            sub={delta >= 0 ? "beating theory" : "below theory"}
            color={delta >= 0 ? "#2ed573" : "#ff4757"}
            icon="fa-arrow-trend-up"
          />
          <SummaryTile
            label="Current Streak"
            value={
              currentStreak.type === "none"
                ? "—"
                : `${currentStreak.count}× ${currentStreak.type === "hit" ? "HIT" : "MISS"}`
            }
            sub={
              currentStreak.type === "hit"
                ? "hot streak 🔥"
                : currentStreak.type === "miss"
                  ? "cold streak ❄️"
                  : "waiting…"
            }
            color={
              currentStreak.type === "hit"
                ? "#2ed573"
                : currentStreak.type === "miss"
                  ? "#ff4757"
                  : "#8899cc"
            }
            icon="fa-fire"
          />
        </div>

        {/* === Timeline === */}
        <div className="revo-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#448AFF]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-timeline text-[#448AFF]" /> Round-by-Round
              Backtest
            </span>
            <span className="text-[10px] text-[#5a6a99]">
              oldest → newest · scroll horizontally
            </span>
          </div>

          <div className="p-4">
            {!backtest ? (
              <div className="flex h-32 items-center justify-center text-sm text-[#5a6a99]">
                {computing ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2" /> Running
                    walk-forward backtest…
                  </>
                ) : spinCount < 5 ? (
                  `Need at least 5 live spins (currently ${spinCount}). Waiting for data…`
                ) : (
                  "No backtest data available."
                )}
              </div>
            ) : (
              <>
                {/* Horizontal scrollable timeline */}
                <div className="flex gap-2.5 overflow-x-auto revo-scroll pb-2">
                  {backtest.rounds.map((round, i) => (
                    <RoundCard
                      key={round.idx}
                      round={round}
                      isLatest={i === backtest.rounds.length - 1}
                    />
                  ))}
                </div>

                {/* Legend */}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[#1e2240]/60 pt-3 text-[9px]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded border-2 border-[#2ed573] bg-[#2ed573]/10" />
                    <span className="font-semibold text-[#2ed573]">HIT</span>
                    <span className="text-[#5a6a99]">
                      — actual was in Top-4
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded border-2 border-[#ff4757] bg-[#ff4757]/10" />
                    <span className="font-semibold text-[#ff4757]">MISS</span>
                    <span className="text-[#5a6a99]">
                      — actual was NOT in Top-4
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <i className="fas fa-star text-[#FFD700]" />
                    <span className="text-[#5a6a99]">
                      = bonus round (always a MISS vs [1,2,5,10])
                    </span>
                  </span>
                  <span className="ml-auto text-[#5a6a99]">
                    <i className="fas fa-circle-info mr-1" />
                    Retrospective · frozen flags · no leakage
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* === Info banner === */}
        <div className="mt-3 rounded-xl border border-[#448AFF]/20 bg-[#448AFF]/5 px-4 py-2.5 text-[11px] text-[#8899cc]">
          <i className="fas fa-circle-info mr-1.5 text-[#448AFF]" />
          <b className="text-[#448AFF]">How this works:</b> For each round, the
          engine is re-run using ONLY the history available before that spin
          (walk-forward, no data leakage). The Top-4 prediction is then compared
          to the actual result. This is a <b>retrospective diagnostic</b> — it
          shows what would have been predicted, not a fresh validation claim.
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryTile({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  icon: string;
}) {
  return (
    <div className="revo-card group p-3 transition hover:ring-1 hover:ring-white/10">
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="grid h-7 w-7 place-items-center rounded-lg text-[11px] transition-transform group-hover:scale-110"
          style={{ background: `${color}24`, color }}
        >
          <i className={`fas ${icon}`} />
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wider text-[#8899cc]">
          {label}
        </span>
      </div>
      <div className="text-lg font-black text-white sm:text-xl">{value}</div>
      <div className="text-[10px] text-[#5a6a99]">{sub}</div>
    </div>
  );
}

function RoundCard({
  round,
  isLatest,
}: {
  round: BacktestRound;
  isLatest: boolean;
}) {
  const hit = round.hit;
  const borderColor = hit ? "#2ed573" : "#ff4757";
  const actualColor = GAME_COLOR[round.actual] ?? "#8899cc";
  const actualImageKey = GAME_TO_IMAGE[round.actual] ?? "";
  const isBonus = !["1", "2", "5", "10"].includes(round.actual);

  return (
    <div
      className={`shrink-0 rounded-xl border-2 bg-[#0d1020]/80 p-2.5 transition-all ${isLatest ? "ring-2 ring-white/30" : ""}`}
      style={{
        borderColor: `${borderColor}60`,
        boxShadow: isLatest
          ? `0 0 16px -4px ${borderColor}`
          : `0 2px 8px -4px ${borderColor}40`,
      }}
    >
      {/* Round # + HIT/MISS badge */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-wider text-[#5a6a99]">
          #{round.idx}
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase"
          style={{
            background: `${borderColor}20`,
            color: borderColor,
          }}
        >
          {hit ? "✓ HIT" : "✗ MISS"}
        </span>
      </div>

      {/* Predicted Top-4 (mini badges) */}
      <div className="mb-2">
        <div className="mb-1 text-[8px] font-bold uppercase tracking-wider text-[#5a6a99]">
          Predicted
        </div>
        <div className="flex flex-wrap gap-1">
          {round.preds.map((pred, i) => {
            const isMatch = hit && pred === round.actual;
            const predColor = GAME_COLOR[pred] ?? "#8899cc";
            return (
              <span
                key={i}
                className="rounded-md px-1.5 py-0.5 text-[9px] font-bold transition-all"
                style={{
                  background: isMatch ? `${predColor}40` : `${predColor}20`,
                  color: isMatch ? "#ffffff" : predColor,
                  border: isMatch
                    ? `2px solid ${predColor}`
                    : `1px solid ${predColor}40`,
                  boxShadow: isMatch ? `0 0 8px -2px ${predColor}` : "none",
                }}
              >
                {pred}
                {isMatch && <i className="fas fa-check ml-0.5 text-[7px]" />}
              </span>
            );
          })}
        </div>
      </div>

      {/* Actual result (large) */}
      <div className="border-t border-[#1e2240]/60 pt-2">
        <div className="mb-1 text-[8px] font-bold uppercase tracking-wider text-[#5a6a99]">
          Actual
        </div>
        <div className="flex items-center gap-1.5">
          {actualImageKey && (
            <img
              src={GAME_CARD_IMAGES[actualImageKey]}
              alt={round.actual}
              className="h-7 w-7 rounded-md object-contain"
              loading="lazy"
            />
          )}
          <span
            className="text-xs font-black"
            style={{ color: actualColor }}
          >
            {round.actual}
            {isBonus && <i className="fas fa-star ml-1 text-[8px] text-[#FFD700]" />}
          </span>
        </div>
      </div>
    </div>
  );
}
