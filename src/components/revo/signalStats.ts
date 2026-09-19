/**
 * SIGNAL STATISTICS KERNEL (ADDITIVE — new file, nothing existing touched)
 * =======================================================================
 *
 * Shared, dependency-free statistics used by the three new experimental
 * signal layers (TIME, DEALER, PHYSICS), the fusion layer, and the
 * walk-forward validation harness.
 *
 * Nothing in this file changes any existing engine behaviour. It is a pure
 * utility module: deterministic, side-effect free, and numerically guarded
 * (no NaN/Infinity leaks into scoring paths).
 *
 * HARD RULES ENCODED HERE:
 *   - No randomness that cannot be reproduced: `mulberry32` PRNG is seeded,
 *     so every bootstrap/permutation result is reproducible bit-for-bit.
 *   - No p-value is reported without its sample size (see `TestResult`).
 *   - Every test result carries an explicit `conclusive` flag: a p-value from
 *     a tiny sample is reported as INCONCLUSIVE, never as evidence.
 */

export const SIGNAL_STATS_VERSION = "signal-stats-v1.0";

// ============================================================
// 1. NORMAL DISTRIBUTION
// ============================================================

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf, ~1e-7 accuracy). */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Error function (Abramowitz & Stegun 7.1.26). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Two-sided p-value for a z statistic. */
export function zTwoSidedP(z: number): number {
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -8 : 8;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ============================================================
// 2. GAMMA / CHI-SQUARE
// ============================================================

const LANCZOS_G = 7;
const LANCZOS_P = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lnGamma(x: number): number {
  if (x < 0.5) {
    // reflection
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  const z = x - 1;
  let a = LANCZOS_P[0];
  const t = z + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_P.length; i++) a += LANCZOS_P[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized lower incomplete gamma P(a, x) via series/continued fraction. */
export function gammaP(a: number, x: number): number {
  if (!(a > 0) || x < 0) return 0;
  if (x === 0) return 0;
  if (x < a + 1) {
    // series
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // continued fraction for Q(a,x), then 1 - Q
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  return 1 - q;
}

/** Upper tail survival function of the chi-square distribution. */
export function chiSquareSurvival(x: number, df: number): number {
  if (!(df > 0)) return 1;
  if (!(x > 0)) return 1;
  return Math.max(0, Math.min(1, 1 - gammaP(df / 2, x / 2)));
}

// ============================================================
// 3. TEST RESULT ENVELOPE
// ============================================================

/**
 * Every statistical test in the new layers returns this envelope.
 * `conclusive` is FALSE when the sample is too small for the test to mean
 * anything — callers MUST NOT let an inconclusive test influence a
 * prediction. This is the structural guarantee against
 * "short sample looks different → treat as real".
 */
export interface TestResult {
  name: string;
  statistic: number;
  df: number | null;
  pValue: number;
  alpha: number;
  significant: boolean; // significant AND conclusive
  conclusive: boolean;
  sampleSize: number;
  effectSize: number; // interpretation depends on the test (TVD for distributions)
  note: string;
}

export function makeTestResult(args: {
  name: string;
  statistic: number;
  df?: number | null;
  pValue: number;
  alpha: number;
  conclusive: boolean;
  sampleSize: number;
  effectSize: number;
  note: string;
}): TestResult {
  const p = Number.isFinite(args.pValue) ? args.pValue : 1;
  return {
    name: args.name,
    statistic: Number.isFinite(args.statistic) ? args.statistic : 0,
    df: args.df ?? null,
    pValue: p,
    alpha: args.alpha,
    significant: args.conclusive && p < args.alpha,
    conclusive: args.conclusive,
    sampleSize: args.sampleSize,
    effectSize: Number.isFinite(args.effectSize) ? args.effectSize : 0,
    note: args.note,
  };
}

/** Non-conclusive result (insufficient sample). Never "significant". */
export function inconclusiveTest(name: string, sampleSize: number, note: string): TestResult {
  return makeTestResult({ name, statistic: 0, df: null, pValue: 1, alpha: 0.05, conclusive: false, sampleSize, effectSize: 0, note });
}

// ============================================================
// 4. PROPORTION INTERVALS
// ============================================================

export interface Interval {
  low: number;
  high: number;
  width: number;
  center: number;
}

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Wilson score interval for a binomial proportion (95% default). */
export function wilsonInterval(hits: number, n: number, z = 1.96): Interval {
  if (n <= 0) return { low: 0, high: 1, width: 1, center: 0.5 };
  const p = clamp01(hits / n);
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const low = Math.max(0, (center - margin) / denom);
  const high = Math.min(1, (center + margin) / denom);
  return { low, high, width: high - low, center: p };
}

/** Standard error of a proportion (used for uncertainty reporting). */
export function proportionStdError(p: number, n: number): number {
  if (n <= 0) return 0.5;
  return Math.sqrt(Math.max(0, p * (1 - p)) / n);
}

/** Agresti–Coull style posterior standard deviation (Dirichlet(0.5) prior). */
export function posteriorStdDev(count: number, n: number): number {
  const a = count + 0.5;
  const b = n - count + 0.5;
  const s = a + b;
  return Math.sqrt((a * b) / (s * s * (s + 1)));
}

// ============================================================
// 5. DISTRIBUTION TESTS
// ============================================================

export interface ChiSquareResult {
  test: TestResult;
  observed: number[];
  expected: number[];
  minExpected: number;
  pooledCells: number;
}

/**
 * Pearson chi-square goodness-of-fit with automatic pooling of cells whose
 * expected count is below `minExpected` (default 5). Pooling is applied to
 * the TAIL cells (ordered input) and the pooled cells are counted so callers
 * can report how much of the distribution was merged.
 */
export function chiSquareGoodnessOfFit(
  observed: number[],
  expectedProb: number[],
  opts: { alpha?: number; minExpected?: number; minSample?: number; name?: string } = {},
): ChiSquareResult {
  const alpha = opts.alpha ?? 0.05;
  const minExpected = opts.minExpected ?? 5;
  const name = opts.name ?? "chi-square goodness-of-fit";
  const n = observed.reduce((s, v) => s + v, 0);
  const minSample = opts.minSample ?? 0;

  // Pool small-expected tail cells (keep order stable).
  const obs: number[] = [];
  const exp: number[] = [];
  let pooledCells = 0;
  let accO = 0;
  let accE = 0;
  for (let i = 0; i < observed.length; i++) {
    const e = expectedProb[i] * n;
    if (e < minExpected) {
      accO += observed[i];
      accE += e;
      pooledCells++;
      continue;
    }
    // flush accumulated pool into this cell (keeps ordering deterministic)
    obs.push(observed[i] + accO);
    exp.push(e + accE);
    accO = 0;
    accE = 0;
  }
  if (accO > 0 || accE > 0) {
    if (obs.length === 0) {
      obs.push(accO);
      exp.push(accE);
    } else {
      obs[obs.length - 1] += accO;
      exp[exp.length - 1] += accE;
    }
  }

  let statistic = 0;
  for (let i = 0; i < obs.length; i++) {
    if (exp[i] > 0) statistic += ((obs[i] - exp[i]) ** 2) / exp[i];
  }
  const df = Math.max(1, obs.length - 1);
  const pValue = chiSquareSurvival(statistic, df);
  const tvd = totalVariationDistance(
    obs.map((v) => (n > 0 ? v / n : 0)),
    exp.map((v) => (n > 0 ? v / n : 0)),
  );
  const conclusive = n >= Math.max(minSample, 30) && obs.length >= 2;
  return {
    test: makeTestResult({
      name,
      statistic,
      df,
      pValue,
      alpha,
      conclusive,
      sampleSize: n,
      effectSize: tvd,
      note: conclusive
        ? `n=${n}, χ²(${df})=${statistic.toFixed(2)}, p=${pValue.toFixed(4)}, TVD=${tvd.toFixed(3)}${pooledCells > 0 ? `, ${pooledCells} pooled cell(s)` : ""}`
        : `INCONCLUSIVE — n=${n} (need ≥${Math.max(minSample, 30)}). No influence allowed.`,
    }),
    observed: obs,
    expected: exp,
    minExpected: exp.length > 0 ? Math.min(...exp) : 0,
    pooledCells,
  };
}

/**
 * Two-sample chi-square test of homogeneity for two count vectors over the
 * SAME ordered categories (used for regime change: recent window vs prior
 * window).
 */
export function chiSquareHomogeneity(
  countsA: number[],
  countsB: number[],
  opts: { alpha?: number; minExpected?: number; minSample?: number; name?: string } = {},
): ChiSquareResult {
  const alpha = opts.alpha ?? 0.05;
  const minExpected = opts.minExpected ?? 5;
  const name = opts.name ?? "chi-square homogeneity";
  const nA = countsA.reduce((s, v) => s + v, 0);
  const nB = countsB.reduce((s, v) => s + v, 0);
  const n = nA + nB;
  const minSample = opts.minSample ?? 0;

  // Small-expected categories are pooled into ONE EXTRA column ("other")
  // instead of being merged into a neighbouring kept column. Merging into a
  // neighbouring column can collapse the table to a single column and destroy
  // the very contrast the test is looking for (a real defect that reported a
  // large, obvious distribution shift as "p=1.0000, indistinguishable").
  const pooledObsA: number[] = [];
  const pooledObsB: number[] = [];
  let pooledCells = 0;
  let accA = 0;
  let accB = 0;
  for (let i = 0; i < countsA.length; i++) {
    const rowSum = countsA[i] + countsB[i];
    const eA = n > 0 ? (rowSum * nA) / n : 0;
    const eB = n > 0 ? (rowSum * nB) / n : 0;
    if (eA < minExpected || eB < minExpected) {
      accA += countsA[i];
      accB += countsB[i];
      pooledCells++;
      continue;
    }
    pooledObsA.push(countsA[i]);
    pooledObsB.push(countsB[i]);
  }
  if (accA > 0 || accB > 0) {
    pooledObsA.push(accA);
    pooledObsB.push(accB);
  }
  void pooledCells;

  let statistic = 0;
  const expectedA: number[] = [];
  const expectedB: number[] = [];
  for (let i = 0; i < pooledObsA.length; i++) {
    const rowSum = pooledObsA[i] + pooledObsB[i];
    const eA = n > 0 ? (rowSum * nA) / n : 0;
    const eB = n > 0 ? (rowSum * nB) / n : 0;
    expectedA.push(eA);
    expectedB.push(eB);
    if (eA > 0) statistic += ((pooledObsA[i] - eA) ** 2) / eA;
    if (eB > 0) statistic += ((pooledObsB[i] - eB) ** 2) / eB;
  }
  const df = Math.max(1, pooledObsA.length - 1);
  const pValue = chiSquareSurvival(statistic, df);
  const tvd = totalVariationDistance(
    pooledObsA.map((v) => (nA > 0 ? v / nA : 0)),
    pooledObsB.map((v) => (nB > 0 ? v / nB : 0)),
  );
  const minN = Math.min(nA, nB);
  const conclusive = minN >= Math.max(minSample, 30) && pooledObsA.length >= 2;
  return {
    test: makeTestResult({
      name,
      statistic,
      df,
      pValue,
      alpha,
      conclusive,
      sampleSize: n,
      effectSize: tvd,
      note: conclusive
        ? `nA=${nA}, nB=${nB}, χ²(${df})=${statistic.toFixed(2)}, p=${pValue.toFixed(4)}, TVD=${tvd.toFixed(3)}`
        : `INCONCLUSIVE — min window n=${minN} (need ≥${Math.max(minSample, 30)}). No influence allowed.`,
    }),
    observed: pooledObsA,
    expected: expectedA,
    minExpected: Math.min(...expectedA, ...expectedB),
    pooledCells,
  };
}

/** Total variation distance between two discrete distributions (0..1). */
export function totalVariationDistance(p: number[], q: number[]): number {
  const n = Math.max(p.length, q.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs((p[i] ?? 0) - (q[i] ?? 0));
  return s / 2;
}

/** Shannon entropy (nats) and normalized entropy of a distribution. */
export function entropy(p: number[]): number {
  let h = 0;
  for (const v of p) if (v > 0) h -= v * Math.log(v);
  return h;
}
export function normalizedEntropy(p: number[]): number {
  const k = p.filter((v) => v > 0).length;
  if (k <= 1) return 0;
  return entropy(p) / Math.log(k);
}

// ============================================================
// 6. PAIRED COMPARISONS (McNemar)
// ============================================================

export interface McNemarOutcome {
  r: number; // A hit, B miss
  s: number; // A miss, B hit
  discordant: number;
  statistic: number;
  pValue: number;
  significant: boolean;
  conclusive: boolean;
  note: string;
}

/**
 * Continuity-corrected McNemar test on paired HIT/MISS vectors.
 * Inconclusive (<10 discordant pairs) results are never called significant.
 */
export function mcnemarPaired(
  hitsA: boolean[],
  hitsB: boolean[],
  opts: { alpha?: number; minDiscordant?: number } = {},
): McNemarOutcome {
  const alpha = opts.alpha ?? 0.05;
  const minDiscordant = opts.minDiscordant ?? 10;
  const n = Math.min(hitsA.length, hitsB.length);
  let r = 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (hitsA[i] && !hitsB[i]) r++;
    else if (!hitsA[i] && hitsB[i]) s++;
  }
  const discordant = r + s;
  const statistic = discordant > 0 ? (Math.abs(r - s) - 1) ** 2 / discordant : 0;
  const pValue = discordant > 0 ? chiSquareSurvival(Math.max(0, statistic), 1) : 1;
  const conclusive = discordant >= minDiscordant;
  return {
    r,
    s,
    discordant,
    statistic,
    pValue,
    significant: conclusive && pValue < alpha,
    conclusive,
    note: conclusive
      ? `McNemar χ²(1)=${statistic.toFixed(3)}, p=${pValue.toFixed(4)} — ${pValue < alpha ? "SIGNIFICANT difference" : "no significant difference"} (r=${r} A-only hits, s=${s} B-only hits).`
      : `INCONCLUSIVE — only ${discordant} discordant pair(s), need ≥${minDiscordant}. No claim may be made.`,
  };
}

// ============================================================
// 7. CALIBRATION & SCORING RULES
// ============================================================

/** Brier score for a probabilistic prediction over the 8 outcomes. */
export function brierScore(probs: Record<string, number>, actual: string): number {
  let s = 0;
  for (const k of Object.keys(probs)) {
    const p = probs[k] ?? 0;
    const y = k === actual ? 1 : 0;
    s += (p - y) ** 2;
  }
  return s;
}

/** Multiclass log-loss with clamping (never -Infinity). */
export function logLoss(probs: Record<string, number>, actual: string, eps = 1e-6): number {
  const p = Math.min(1, Math.max(eps, probs[actual] ?? eps));
  return -Math.log(p);
}

export interface CalibrationBin {
  bucketIndex: number;
  lower: number;
  upper: number;
  n: number;
  meanPredicted: number;
  observedRate: number;
  gap: number;
}

/**
 * Reliability diagram data: bucket every (predicted probability, outcome)
 * pair. A calibrated model has gap≈0 in every populated bucket. Buckets are
 * reported with their sample size — empty buckets are omitted, never faked.
 */
export function calibrationBins(
  samples: { probs: Record<string, number>; actual: string }[],
  bucketCount = 5,
): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let b = 0; b < bucketCount; b++) {
    bins.push({ bucketIndex: b, lower: b / bucketCount, upper: (b + 1) / bucketCount, n: 0, meanPredicted: 0, observedRate: 0, gap: 0 });
  }
  for (const s of samples) {
    for (const k of Object.keys(s.probs)) {
      const p = clamp01(s.probs[k] ?? 0);
      const idx = Math.min(bucketCount - 1, Math.floor(p * bucketCount));
      const bin = bins[idx];
      bin.n++;
      bin.meanPredicted += p;
      bin.observedRate += k === s.actual ? 1 : 0;
    }
  }
  return bins
    .filter((b) => b.n > 0)
    .map((b) => {
      const meanPredicted = b.meanPredicted / b.n;
      const observedRate = b.observedRate / b.n;
      return { ...b, meanPredicted, observedRate, gap: observedRate - meanPredicted };
    });
}

/** Expected Calibration Error from populated bins (weighted by bin n). */
export function expectedCalibrationError(bins: CalibrationBin[]): number {
  const total = bins.reduce((s, b) => s + b.n, 0);
  if (total === 0) return 0;
  return bins.reduce((s, b) => s + (b.n / total) * Math.abs(b.gap), 0);
}

// ============================================================
// 8. MULTIPLE-COMPARISON CORRECTION
// ============================================================

/** Benjamini–Hochberg FDR-controlled significance flags (input order kept). */
export function benjaminiHochberg(pValues: number[], q = 0.05): boolean[] {
  const idx = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const flags = new Array(pValues.length).fill(false);
  let largestRank = -1;
  const m = pValues.length;
  for (let rank = 0; rank < idx.length; rank++) {
    if (idx[rank].p <= ((rank + 1) / m) * q) largestRank = rank;
  }
  for (let rank = 0; rank <= largestRank; rank++) flags[idx[rank].i] = true;
  return flags;
}

/** Bonferroni-corrected alpha for k simultaneous tests. */
export function bonferroniAlpha(k: number, alpha = 0.05): number {
  return k <= 0 ? alpha : alpha / k;
}

// ============================================================
// 9. DETERMINISTIC PRNG + BOOTSTRAP/PERMUTATION
// ============================================================

/** mulberry32 — small, fast, fully deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic string → 32-bit seed (FNV-1a). */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Percentile bootstrap CI for a statistic on a boolean vector. */
export function bootstrapRateCI(
  outcomes: boolean[],
  opts: { iterations?: number; seed?: number; level?: number } = {},
): Interval {
  const iterations = opts.iterations ?? 2000;
  const seed = opts.seed ?? 12345;
  const level = opts.level ?? 0.95;
  const n = outcomes.length;
  if (n === 0) return { low: 0, high: 1, width: 1, center: 0 };
  const rnd = mulberry32(seed);
  const rates: number[] = [];
  for (let it = 0; it < iterations; it++) {
    let hits = 0;
    for (let i = 0; i < n; i++) if (outcomes[(rnd() * n) | 0]) hits++;
    rates.push(hits / n);
  }
  rates.sort((a, b) => a - b);
  const lo = rates[Math.floor(((1 - level) / 2) * iterations)] ?? 0;
  const hi = rates[Math.min(iterations - 1, Math.floor((1 - (1 - level) / 2) * iterations))] ?? 1;
  const hitCount = outcomes.filter(Boolean).length;
  return { low: lo, high: hi, width: hi - lo, center: hitCount / n };
}

// ============================================================
// 10. NUMERIC GUARDS
// ============================================================

/** Safe division (0 when the denominator is 0 or non-finite). */
export function safeDiv(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return a / b;
}

/** Laplace-smoothed rate toward a prior distribution. */
export function smoothedRate(count: number, n: number, priorProbability: number, k: number): number {
  if (n <= 0) return priorProbability;
  const denom = n + k;
  if (denom <= 0) return priorProbability;
  return (count + k * priorProbability) / denom;
}

/** Round to n decimals with NaN safety. */
export function round(x: number, decimals = 4): number {
  if (!Number.isFinite(x)) return 0;
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}
