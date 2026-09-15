"use client";

import { useSyncExternalStore, useMemo } from "react";
import {
  getLiveSpins,
  getLiveSpinsVersion,
  subscribeLiveSpins,
} from "./liveSpinStore";
import {
  SEGMENT_NAMES,
  DISPLAY_NAMES,
  THEORETICAL_PROB,
  GAME_CARD_IMAGES,
  type SpinData,
} from "./aiStats";

// The theoretical Top-4 outcomes (highest probability).
const TOP4 = ["1", "2", "5", "10"];

// Color per outcome for the streak cells + radial.
const SEGMENT_COLOR: Record<string, string> = {
  "1": "#448AFF",
  "2": "#2ed573",
  "5": "#ffa502",
  "10": "#ff4757",
  CoinFlip: "#a78bfa",
  Pachinko: "#00d4ff",
  CashHunt: "#FFD700",
  CrazyTime: "#ff6b9d",
};

function useLiveSpinsVersion(): number {
  return useSyncExternalStore(subscribeLiveSpins, getLiveSpinsVersion, () => 0);
}

/**
 * RevoStreakTracker
 * ----------------
 * A live "performance cockpit" that turns the raw spin stream into three
 * at-a-glance visualisations — NO new API calls, pure client-side derivation
 * from the shared liveSpinStore:
 *
 *  1. Streak Bar  — last 30 results as colored cells (visual memory of the
 *                   wheel). Bonus rounds get a star icon; numbers show the
 *                   digit. Hovering reveals the timestamp.
 *  2. Rolling Hit-Rate — what fraction of the last N spins landed in the
 *                   theoretical Top-4 [1,2,5,10]? Sparkline of the rolling
 *                   value vs the theoretical 83.3% baseline.
 *  3. Hot/Cold Radial — 8 radial bars (one per outcome) whose length ∝
 *                   observed frequency / theoretical. Red = cold, green = hot.
 *                   Gives an instant read on which sectors are running
 *                   over/under their theoretical rate.
 *
 * This component does NOT influence the prediction engine — it is a
 * read-only visual layer for the user, powered by the same real data
 * RevoLiveResults already fetches.
 */
export function RevoStreakTracker() {
  useLiveSpinsVersion(); // re-render when the spin store changes
  const spins = getLiveSpins();

  // Slice the most recent 30 (store is newest-first).
  const recent = useMemo(() => spins.slice(0, 30), [spins]);

  // Rolling hit-rate of Top-4 over the last 20 spins.
  const rollingData = useMemo(() => {
    const window = 20;
    const reversed = [...spins].reverse(); // oldest → newest
    const points: { idx: number; rate: number }[] = [];
    for (let i = 0; i < reversed.length; i++) {
      const start = Math.max(0, i - window + 1);
      const slice = reversed.slice(start, i + 1);
      const hits = slice.filter((s) => TOP4.includes(s.sector)).length;
      points.push({ idx: i, rate: slice.length ? hits / slice.length : 0 });
    }
    return points.slice(-40); // last 40 windows
  }, [spins]);

  // Per-sector observed frequency (last 50 spins).
  const sectorFreq = useMemo(() => {
    const sample = spins.slice(0, 50);
    const counts: Record<string, number> = {};
    for (const s of SEGMENT_NAMES) counts[s] = 0;
    for (const spin of sample) {
      if (counts[spin.sector] !== undefined) counts[spin.sector]++;
    }
    const total = sample.length || 1;
    return SEGMENT_NAMES.map((seg) => ({
      segment: seg,
      display: DISPLAY_NAMES[seg],
      observed: counts[seg] / total,
      theoretical: THEORETICAL_PROB[seg] ?? 0,
      ratio: (counts[seg] / total) / (THEORETICAL_PROB[seg] ?? 0.01),
      count: counts[seg],
    }));
  }, [spins]);

  const currentRate =
    rollingData.length > 0 ? rollingData[rollingData.length - 1].rate : 0;
  const theoreticalRate = TOP4.reduce(
    (s, seg) => s + (THEORETICAL_PROB[seg] ?? 0),
    0,
  ); // ≈ 0.833

  const totalSpins = spins.length;
  const recentStreakLabel = useMemo(() => {
    if (recent.length === 0) return "—";
    const last = recent[0];
    let len = 1;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].sector === last.sector) len++;
      else break;
    }
    return `${len}× ${DISPLAY_NAMES[last.sector] ?? last.sector}`;
  }, [recent]);

  return (
    <section
      id="streak-tracker"
      className="scroll-mt-20 px-4 py-10 sm:px-6"
      aria-label="Prediction streak tracker"
    >
      <div className="mx-auto max-w-5xl">
        {/* Heading */}
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#2ed573]">
            <i className="fas fa-chart-line" /> Performance Cockpit
          </div>
          <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
            Live <span className="text-[#2ed573]">Streak Tracker</span>
          </h2>
          <p className="mt-1 text-sm text-[#8899cc]">
            Rolling hit-rate · recent outcome streak · hot/cold sector radar —
            all derived from {totalSpins} live spins.
          </p>
        </div>

        {/* === Top row: KPI tiles === */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile
            label="Rolling Top-4 Hit-Rate"
            value={`${(currentRate * 100).toFixed(1)}%`}
            sub={`vs ${(theoreticalRate * 100).toFixed(1)}% theoretical`}
            color={currentRate >= theoreticalRate ? "#2ed573" : "#ffa502"}
            icon="fa-bullseye"
          />
          <KpiTile
            label="Last Result"
            value={recent[0] ? DISPLAY_NAMES[recent[0].sector] ?? recent[0].sector : "—"}
            sub={recent[0] ? timeAgoShort(recent[0].settledAt) : "waiting…"}
            color={SEGMENT_COLOR[recent[0]?.sector ?? ""] ?? "#8899cc"}
            icon="fa-circle-dot"
          />
          <KpiTile
            label="Current Streak"
            value={recentStreakLabel}
            sub="consecutive repeats"
            color="#a78bfa"
            icon="fa-fire"
          />
          <KpiTile
            label="Spins Tracked"
            value={String(totalSpins)}
            sub="live rounds"
            color="#00d4ff"
            icon="fa-database"
          />
        </div>

        {/* === Main grid: streak bar + sparkline === */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Streak Bar (spans 2 cols on desktop) */}
          <div className="revo-card overflow-hidden lg:col-span-2">
            <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#448AFF]/10 to-transparent px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-grip-vertical text-[#448AFF]" /> Recent
                Outcomes (last 30)
              </span>
              <span className="text-[10px] text-[#5a6a99]">
                newest → oldest
              </span>
            </div>
            <div className="p-4">
              {recent.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-sm text-[#5a6a99]">
                  <i className="fas fa-spinner fa-spin mr-2" /> Waiting for live
                  spins…
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {recent.map((spin, i) => {
                    const isBonus = !TOP4.includes(spin.sector);
                    const color = SEGMENT_COLOR[spin.sector] ?? "#8899cc";
                    const isLatest = i === 0;
                    return (
                      <div
                        key={`${spin.settledAt}-${i}`}
                        title={`${DISPLAY_NAMES[spin.sector] ?? spin.sector} · ${timeAgoShort(spin.settledAt)}`}
                        className={`group relative grid h-10 w-10 place-items-center rounded-lg font-black text-white transition-transform hover:scale-110 hover:z-10 ${isLatest ? "ring-2 ring-white/50" : ""}`}
                        style={{
                          background: `${color}`,
                          boxShadow: isLatest
                            ? `0 0 14px -2px ${color}`
                            : `0 2px 6px -2px ${color}80`,
                        }}
                      >
                        {isBonus ? (
                          <i className="fas fa-star text-xs" />
                        ) : (
                          <span className="text-sm">{spin.sector}</span>
                        )}
                        {/* multiplier badge */}
                        {spin.multiplier && spin.multiplier > 1 && (
                          <span className="absolute -bottom-1 -right-1 rounded-full bg-[#FFD700] px-1 text-[8px] font-black text-black">
                            ×{spin.multiplier}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Legend */}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#1e2240]/60 pt-3 text-[9px]">
                {SEGMENT_NAMES.map((seg) => (
                  <span key={seg} className="flex items-center gap-1">
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ background: SEGMENT_COLOR[seg] }}
                    />
                    <span className="font-semibold text-[#8899cc]">
                      {DISPLAY_NAMES[seg]}
                    </span>
                  </span>
                ))}
                <span className="ml-auto flex items-center gap-1 text-[#FFD700]">
                  <i className="fas fa-star text-[9px]" /> = bonus round
                </span>
              </div>
            </div>
          </div>

          {/* Rolling Hit-Rate Sparkline */}
          <div className="revo-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#2ed573]/10 to-transparent px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <i className="fas fa-wave-square text-[#2ed573]" /> Rolling Top-4
                Hit-Rate
              </span>
            </div>
            <div className="p-4">
              {rollingData.length < 2 ? (
                <div className="flex h-40 items-center justify-center text-sm text-[#5a6a99]">
                  Need more spins…
                </div>
              ) : (
                <RollingSparkline
                  points={rollingData.map((p) => p.rate)}
                  baseline={theoreticalRate}
                />
              )}
              <div className="mt-2 flex items-center justify-between text-[10px]">
                <span className="text-[#8899cc]">
                  Last {rollingData.length} windows (n=20)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#2ed573]" />
                  <span className="text-[#2ed573]">actual</span>
                  <span className="mx-1 text-[#5a6a99]">·</span>
                  <span className="h-2 w-2 rounded-full bg-[#448AFF]/40" />
                  <span className="text-[#448AFF]">
                    {(theoreticalRate * 100).toFixed(0)}% baseline
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* === Hot/Cold Sector Radar === */}
        <div className="revo-card mt-4 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e2240] bg-gradient-to-r from-[#ffa502]/10 to-transparent px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
              <i className="fas fa-temperature-three-quarters text-[#ffa502]" />{" "}
              Hot / Cold Sector Radar
            </span>
            <span className="text-[10px] text-[#5a6a99]">
              observed / theoretical · last 50 spins
            </span>
          </div>
          <div className="p-4 sm:p-5">
            {totalSpins === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-[#5a6a99]">
                Waiting for live data…
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {sectorFreq.map((s) => {
                  const ratio = s.ratio;
                  // ratio < 1 = cold (red), > 1 = hot (green), 1 = neutral
                  const barColor =
                    ratio >= 1.25
                      ? "#2ed573"
                      : ratio >= 1.0
                        ? "#8899cc"
                        : ratio >= 0.75
                          ? "#ffa502"
                          : "#ff4757";
                  const barWidth = Math.min(100, ratio * 50); // 1.0 → 50%, 2.0 → 100%
                  return (
                    <div
                      key={s.segment}
                      className="rounded-xl border border-[#1e2240] bg-[#0d1020]/60 p-3"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <img
                          src={GAME_CARD_IMAGES[s.segment]}
                          alt={s.display}
                          className="h-7 w-7 rounded-md object-contain"
                          loading="lazy"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-white">
                            {s.display}
                          </div>
                          <div className="text-[9px] text-[#5a6a99]">
                            {s.count}× · {(s.observed * 100).toFixed(1)}% obs
                          </div>
                        </div>
                      </div>
                      {/* Bar with theoretical marker */}
                      <div className="relative h-2.5 overflow-hidden rounded-full bg-[#1e2240]">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${barWidth}%`,
                            background: `linear-gradient(90deg, ${barColor}80, ${barColor})`,
                          }}
                        />
                        {/* Theoretical marker at 50% (ratio=1.0) */}
                        <div
                          className="absolute top-0 h-full w-0.5 bg-white/40"
                          style={{ left: "50%" }}
                          title={`Theoretical: ${(s.theoretical * 100).toFixed(1)}%`}
                        />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[9px]">
                        <span
                          className="font-bold"
                          style={{ color: barColor }}
                        >
                          {ratio >= 1.25
                            ? "🔥 HOT"
                            : ratio >= 1.0
                              ? "On par"
                              : ratio >= 0.75
                                ? "Cool"
                                : "❄️ COLD"}
                        </span>
                        <span className="text-[#5a6a99]">
                          {(s.theoretical * 100).toFixed(1)}% theo
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-3 border-t border-[#1e2240]/60 pt-2 text-[9px] text-[#5a6a99]">
              <i className="fas fa-circle-info mr-1 text-[#448AFF]" />
              Bar fills to 50% when observed = theoretical. White tick = the
              theoretical baseline. Past 50 spins is a tiny sample — these
              are <b>INFO only</b> and do NOT affect the prediction engine.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiTile({
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

/**
 * Lightweight inline SVG sparkline — no chart library dependency.
 * Draws the rolling hit-rate as a smooth area + line, with a dashed baseline.
 */
function RollingSparkline({
  points,
  baseline,
}: {
  points: number[];
  baseline: number;
}) {
  const W = 240;
  const H = 100;
  const pad = 6;
  const n = points.length;
  if (n < 2) return null;

  const x = (i: number) => pad + (i / (n - 1)) * (W - pad * 2);
  // Y: 0% at bottom, 100% at top — but clamp the view to [0.5, 1.0] so
  // variation is visible (Top-4 hit-rate rarely drops below 50%).
  const yMin = 0.5;
  const yMax = 1.0;
  const y = (v: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, v));
    return H - pad - ((clamped - yMin) / (yMax - yMin)) * (H - pad * 2);
  };

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`)
    .join(" ");

  const areaPath =
    `M ${x(0).toFixed(1)} ${(H - pad).toFixed(1)} ` +
    points.map((p, i) => `L ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(" ") +
    ` L ${x(n - 1).toFixed(1)} ${(H - pad).toFixed(1)} Z`;

  const baselineY = y(baseline);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-32 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Rolling Top-4 hit-rate sparkline"
    >
      <defs>
        <linearGradient id="sparkArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2ed573" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#2ed573" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* baseline */}
      <line
        x1={pad}
        y1={baselineY}
        x2={W - pad}
        y2={baselineY}
        stroke="#448AFF"
        strokeWidth="1"
        strokeDasharray="3 3"
        opacity="0.5"
      />
      {/* area */}
      <path d={areaPath} fill="url(#sparkArea)" />
      {/* line */}
      <path
        d={linePath}
        fill="none"
        stroke="#2ed573"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* last point */}
      <circle
        cx={x(n - 1)}
        cy={y(points[n - 1])}
        r="3"
        fill="#2ed573"
        stroke="#0d1020"
        strokeWidth="1.5"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgoShort(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
