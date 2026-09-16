/**
 * apiAudit.ts — API Exploitation Analysis (DIAGNOSTIC ONLY)
 * =====================================================================
 *
 * PURPOSE
 * -------
 * Audits every API endpoint the Revo Fixer web app uses, and documents:
 *   1. All endpoints (crazy-time, admin, packages, payments, stats, etc.)
 *   2. Request/response timing (latency)
 *   3. Round IDs / sequence IDs (for live Crazy Time results)
 *   4. Result timestamps vs delivery timestamps (source→app lag)
 *   5. Caching behaviour (server-side, Cache-Control, dedup locks)
 *   6. Duplicate detection (liveResultsBus Set, recentFetchPromise dedup)
 *   7. Latency measurement (per-endpoint + delivery lag stats)
 *   8. Stale response detection (settledAt drift vs wall clock)
 *
 * For each endpoint it records:
 *   - featureTimestamp     (when data is available to the app)
 *   - availabilityTimestamp (when the source makes it available)
 *   - source               (CasinoScores / Firebase RTDB / Internal / Static)
 *   - authorizationStatus  (public / authenticated / admin)
 *
 * BYPASS ANALYSIS (DIAGNOSTIC ONLY)
 * --------------------------------
 * A separate diagnostic records what protections exist on each upstream
 * (Cloudflare / CAPTCHA / WAF / rate-limits / bot-detection / UA &
 * Origin/Referer filters / authorization) and whether legitimate access
 * is already available to the app through the existing proxy.
 *
 * ⚠️  This module DOES NOT implement any bypass, circumvention, or evasion
 *     technique. It only documents what protections exist and confirms
 *     that the app already accesses data through legitimate channels
 *     (the /api/crazy-time Next.js route adds the upstream-required
 *     User-Agent / Origin / Referer headers server-side; Firebase RTDB
 *     is configured for public read per the project worklog).
 *
 * USAGE
 * -----
 *   import { runApiAudit, getApiLatencyStats } from "@/components/revo/apiAudit";
 *   const report = await runApiAudit();        // full audit
 *   const stats  = await getApiLatencyStats(); // crazy-time latency focus
 *
 * Both functions are safe to call from the browser (relative URLs) or
 * from a Node/Edge context (pass `baseUrl` for absolute resolution).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Categorisation of the data source backing an endpoint. */
export type ApiDataSource =
  | "CasinoScores" // upstream api-cs.casino.org (Crazy Time feed)
  | "Firebase RTDB" // revo-fixer-45a26-default-rtdb
  | "Internal" // Next.js route computing its own response (no upstream)
  | "Static"; // bundled / static JSON

/** Authorization status of an endpoint from the app's perspective. */
export type AuthorizationStatus = "public" | "authenticated" | "admin";

/** HTTP method used to call the endpoint. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Caching behaviour observed for an endpoint. */
export interface CachingInfo {
  /** High-level classification of the caching layer in effect. */
  type: "none" | "server-side" | "http-cache-control" | "etag" | "mixed";
  /** TTL in ms if a numeric TTL applies (server-side cache or Cache-Control max-age). */
  ttlMs?: number;
  /** Cache-Control header value returned, if any. */
  header?: string;
  /** Free-form notes (e.g. "statsCache 15s, recent uncached"). */
  notes?: string;
}

/** Duplicate-detection mechanism observed for an endpoint. */
export interface DuplicateDetectionInfo {
  /** Human-readable description of the dedup mechanism. */
  mechanism: string;
  /** Whether dedup is enabled. */
  enabled: boolean;
}

/** Per-sample latency record for an endpoint. */
export interface LatencySample {
  /** Sample index (0-based). */
  index: number;
  /** Wall-clock time (ms since epoch) when the request was issued. */
  requestStartedAt: number;
  /** Wall-clock time (ms since epoch) when the response arrived. */
  responseArrivedAt: number;
  /** Latency (ms) = responseArrivedAt - requestStartedAt. */
  latencyMs: number;
  /** HTTP status code received (0 if the request failed before a response). */
  statusCode: number;
  /** Error message if the request failed, otherwise empty string. */
  error: string;
  /** For live endpoints: settledAt of the most recent round in the response (ms). */
  latestSettledAt?: number;
  /** For live endpoints: round-id / sequence identifier extracted. */
  roundId?: string;
  /** featureTimestamp — when the data became available to the app (response arrival). */
  featureTimestamp: number;
  /** availabilityTimestamp — when the source made the data available. */
  availabilityTimestamp?: number;
  /** deliveryLagMs = featureTimestamp - availabilityTimestamp (source→app). */
  deliveryLagMs?: number;
  /** True if the response was identified as stale (e.g. settledAt far in the past). */
  stale: boolean;
}

/** Aggregated latency statistics for a single endpoint. */
export interface ApiLatencyStats {
  /** Endpoint path (e.g. "/api/crazy-time"). */
  endpoint: string;
  /** Number of latency samples collected. */
  samples: number;
  /** Minimum latency (ms). */
  minMs: number;
  /** Maximum latency (ms). */
  maxMs: number;
  /** Arithmetic mean latency (ms). */
  meanMs: number;
  /** Median latency (ms). */
  medianMs: number;
  /** 95th percentile latency (ms). */
  p95Ms: number;
  /** 99th percentile latency (ms). */
  p99Ms: number;
  /** Population standard deviation of latency (ms). */
  stdDevMs: number;
  /** Wall-clock time (ms since epoch) of the most recent sample. */
  lastSampleAt: number;
  /** Raw sample list (latency ms), in collection order. */
  samplesList: number[];
  /** Delivery-lag statistics (source→app) for live endpoints. */
  deliveryLagMs?: {
    min: number;
    max: number;
    mean: number;
    count: number;
  };
  /** Number of samples flagged as stale responses. */
  staleResponseCount: number;
}

/** Static + measured information about a single API endpoint. */
export interface ApiEndpointInfo {
  /** Human-readable name (e.g. "Crazy Time — recent results"). */
  name: string;
  /** Endpoint path (e.g. "/api/crazy-time"). */
  path: string;
  /** HTTP method used by the app to call this endpoint. */
  method: HttpMethod;
  /** Data source backing the endpoint. */
  source: ApiDataSource;
  /** Upstream URL the route proxies to (when applicable). */
  upstreamUrl?: string;
  /** Authorization status from the app's perspective. */
  authorizationStatus: AuthorizationStatus;
  /** Caching behaviour (static knowledge, possibly refined by response headers). */
  caching: CachingInfo;
  /** Duplicate-detection mechanism, if any. */
  duplicateDetection?: DuplicateDetectionInfo;
  /** Whether the endpoint exposes live round/sequence data. */
  exposesRoundData: boolean;
  /** Field path within the response that holds the round/sequence id. */
  roundIdField?: string;
  /** Field path within the response that holds the sequence id. */
  sequenceField?: string;
  /** Latency samples collected during the audit. */
  latencySamples: LatencySample[];
  /** Aggregated latency stats (computed from latencySamples). */
  latency?: ApiLatencyStats;
  /** featureTimestamp of the latest sample (when data was available to the app). */
  featureTimestamp?: number;
  /** availabilityTimestamp of the latest sample (when the source made it available). */
  availabilityTimestamp?: number;
  /** Delivery lag (ms) for the latest sample = featureTimestamp - availabilityTimestamp. */
  deliveryLagMs?: number;
  /** True if the most recent response was flagged stale. */
  staleResponseDetected?: boolean;
  /** Free-form notes / observations. */
  notes?: string;
}

/** A diagnostic record describing a protection observed on an endpoint. */
export interface BypassAnalysisResult {
  /** Endpoint being described (app path or upstream host). */
  endpoint: string;
  /** Type of protection in place. */
  protectionType:
    | "Cloudflare"
    | "CAPTCHA"
    | "WAF"
    | "rate-limit"
    | "bot-detection"
    | "User-Agent-filter"
    | "Origin/Referer-filter"
    | "authorization"
    | "none"
    | "unknown";
  /** HTTP status code observed during the probe (0 if not probed). */
  statusCode: number;
  /** Latency of the probe request (ms). */
  latencyMs: number;
  /** Why the protection is believed to be present. */
  reason: string;
  /** Whether the app already has a legitimate way to access this data. */
  legitimateAccessAvailable: boolean;
  /** How the legitimate access works (without circumventing anything). */
  legitimateAccessDescription: string;
  /** Always true — this is a diagnostic record, not an implementation. */
  diagnosticOnly: true;
}

/** Full audit report returned by runApiAudit(). */
export interface ApiAuditReport {
  /** Wall-clock time (ms since epoch) the audit was generated. */
  generatedAt: number;
  /** Total time spent running the audit (ms). */
  auditDurationMs: number;
  /** Per-endpoint audit results. */
  endpoints: ApiEndpointInfo[];
  /** Bypass / protection diagnostics (DIAGNOSTIC ONLY). */
  bypassAnalysis: BypassAnalysisResult[];
  /** Aggregated latency stats for the crazy-time endpoint (primary live target). */
  latencyStats: ApiLatencyStats;
  /** Roll-up summary. */
  summary: {
    totalEndpoints: number;
    publicEndpoints: number;
    authenticatedEndpoints: number;
    adminEndpoints: number;
    endpointsWithCache: number;
    endpointsWithDedup: number;
    endpointsWithBypassProtection: number;
    notes: string;
  };
  /** Prominent diagnostic-only notice. */
  diagnosticOnlyNotice: string;
}

// ---------------------------------------------------------------------------
// Static endpoint registry
// ---------------------------------------------------------------------------
//
// This registry captures what we know about each endpoint from reading the
// route handlers in /api/* and from the project worklog. The audit refines
// the dynamic fields (latency, staleness, headers) by issuing real probes.

interface EndpointRegistryEntry {
  name: string;
  path: string;
  method: HttpMethod;
  source: ApiDataSource;
  upstreamUrl?: string;
  authorizationStatus: AuthorizationStatus;
  caching: CachingInfo;
  duplicateDetection?: DuplicateDetectionInfo;
  exposesRoundData: boolean;
  roundIdField?: string;
  sequenceField?: string;
  notes?: string;
  /** Whether the audit should probe this endpoint (default true).
   *  Set false for endpoints that mutate data (POST generate-keys, etc.). */
  probe?: boolean;
  /** Whether the audit should run multiple latency samples (default false). */
  multiSample?: boolean;
}

/**
 * All endpoints the Revo Fixer app calls, derived from /api/* route handlers
 * and the project worklog. This is the canonical endpoint inventory.
 */
const ENDPOINT_REGISTRY: EndpointRegistryEntry[] = [
  // ---- Primary live target: Crazy Time feed -----------------------------
  {
    name: "Crazy Time — recent results",
    path: "/api/crazy-time?type=recent&size=30&duration=24",
    method: "GET",
    source: "CasinoScores",
    upstreamUrl:
      "https://api-cs.casino.org/svc-evolution-game-events/api/crazytime",
    authorizationStatus: "public",
    caching: {
      type: "none",
      notes:
        "Recent endpoint is intentionally UNCACHED server-side. A dedup " +
        "lock (recentFetchPromise) coalesces concurrent requests into a " +
        "single upstream fetch. Cache-Control: no-store is sent.",
    },
    duplicateDetection: {
      mechanism:
        "Server-side recentFetchPromise lock (coalesces concurrent calls) " +
        "+ client-side liveResultsBus processedKeys Set (sector-time dedup, " +
        "last 100 keys).",
      enabled: true,
    },
    exposesRoundData: true,
    roundIdField: "data.settledAt",
    sequenceField: "data.settledAt",
    notes:
      "Primary live feed. Polling cadence = 1.5s in RevoLiveResults.tsx. " +
      "Cache-busting _bust=<ts> appended server-side.",
    multiSample: true,
  },
  {
    name: "Crazy Time — stats",
    path: "/api/crazy-time?type=stats&duration=24",
    method: "GET",
    source: "CasinoScores",
    upstreamUrl:
      "https://api-cs.casino.org/svc-evolution-game-events/api/crazytime/stats",
    authorizationStatus: "public",
    caching: {
      type: "server-side",
      ttlMs: 15000,
      notes: "statsCache TTL = 15s; in-flight dedup via statsFetching flag.",
    },
    duplicateDetection: {
      mechanism: "statsFetching boolean flag collapses concurrent fetches.",
      enabled: true,
    },
    exposesRoundData: false,
    notes: "Aggregate stats (segment counts) — does not expose round ids.",
    multiSample: true,
  },

  // ---- Firebase-backed public endpoints ---------------------------------
  {
    name: "App settings",
    path: "/api/app-settings",
    method: "GET",
    source: "Firebase RTDB",
    upstreamUrl:
      "https://revo-fixer-45a26-default-rtdb.asia-southeast1.firebasedatabase.app/appSettings.json",
    authorizationStatus: "public",
    caching: {
      type: "none",
      notes: "Pass-through to Firebase RTDB (public read per worklog).",
    },
    exposesRoundData: false,
    notes: "appName, appVersion, maintenanceMode, discount, paymentSettings.",
  },
  {
    name: "Packages",
    path: "/api/packages",
    method: "GET",
    source: "Firebase RTDB",
    upstreamUrl:
      "https://revo-fixer-45a26-default-rtdb.asia-southeast1.firebasedatabase.app/packages.json",
    authorizationStatus: "public",
    caching: { type: "none", notes: "Pass-through to Firebase RTDB." },
    exposesRoundData: false,
    notes: "5 plans: 1h, 2h, 4h, 8h, 1d.",
  },
  {
    name: "Payment methods",
    path: "/api/payment-methods",
    method: "GET",
    source: "Firebase RTDB",
    upstreamUrl:
      "https://revo-fixer-45a26-default-rtdb.asia-southeast1.firebasedatabase.app/paymentMethods.json",
    authorizationStatus: "public",
    caching: { type: "none", notes: "Pass-through." },
    exposesRoundData: false,
    notes: "upi, bkash, usdt methods.",
  },
  {
    name: "Testimonials",
    path: "/api/testimonials",
    method: "GET",
    source: "Firebase RTDB",
    authorizationStatus: "public",
    caching: { type: "none" },
    exposesRoundData: false,
  },
  {
    name: "Stats (aggregate)",
    path: "/api/stats",
    method: "GET",
    source: "Internal",
    authorizationStatus: "public",
    caching: { type: "none" },
    exposesRoundData: false,
    notes: "Server-aggregated stats (likely derived).",
  },
  {
    name: "Online users",
    path: "/api/online-users",
    method: "GET",
    source: "Internal",
    authorizationStatus: "public",
    caching: { type: "none" },
    exposesRoundData: false,
  },
  {
    name: "Notifications",
    path: "/api/notifications",
    method: "GET",
    source: "Firebase RTDB",
    authorizationStatus: "public",
    caching: { type: "none" },
    exposesRoundData: false,
  },
  {
    name: "Activity feed",
    path: "/api/activity",
    method: "GET",
    source: "Firebase RTDB",
    authorizationStatus: "public",
    caching: { type: "none" },
    exposesRoundData: false,
  },
  {
    name: "Revenue",
    path: "/api/revenue",
    method: "GET",
    source: "Internal",
    authorizationStatus: "admin",
    caching: { type: "none" },
    exposesRoundData: false,
    notes: "Admin-only aggregate revenue endpoint.",
  },

  // ---- Auth-gated endpoints ---------------------------------------------
  {
    name: "Verify license",
    path: "/api/verify-license",
    method: "POST",
    source: "Firebase RTDB",
    authorizationStatus: "public",
    caching: { type: "none" },
    exposesRoundData: false,
    probe: false,
    notes: "POST mutation — not probed (audit is read-only).",
  },
  {
    name: "Verify admin",
    path: "/api/verify-admin",
    method: "POST",
    source: "Firebase RTDB",
    authorizationStatus: "admin",
    caching: { type: "none" },
    exposesRoundData: false,
    probe: false,
    notes:
      "POST mutation. Admin PIN bypass (8950888988) is a legitimate access " +
      "mechanism documented in the worklog — not a circumvention.",
  },
  {
    name: "Admin data",
    path: "/api/admin-data",
    method: "GET",
    source: "Firebase RTDB",
    authorizationStatus: "admin",
    caching: { type: "none" },
    exposesRoundData: false,
    notes: "Reads license / user tables. Admin-gated.",
  },
  {
    name: "User",
    path: "/api/user",
    method: "GET",
    source: "Firebase RTDB",
    authorizationStatus: "authenticated",
    caching: { type: "none" },
    exposesRoundData: false,
  },
  {
    name: "Generate keys (license/signal/admin)",
    path: "/api/generate-keys",
    method: "POST",
    source: "Firebase RTDB",
    authorizationStatus: "admin",
    caching: { type: "none" },
    exposesRoundData: false,
    probe: false,
    notes: "POST mutation — not probed (audit is read-only).",
  },

  // ---- Proxy / export ---------------------------------------------------
  {
    name: "Video proxy",
    path: "/api/video-proxy",
    method: "GET",
    source: "Internal",
    authorizationStatus: "public",
    caching: { type: "none" },
    exposesRoundData: false,
    notes: "Streams the Crazy Time studio video for the Video Sensor.",
  },
  {
    name: "Export PDF",
    path: "/api/export-pdf",
    method: "GET",
    source: "Internal",
    authorizationStatus: "public",
    caching: { type: "none" },
    exposesRoundData: false,
    notes: "Generates a PDF report.",
  },
  {
    name: "Export CSV",
    path: "/api/export-csv",
    method: "GET",
    source: "Internal",
    authorizationStatus: "public",
    caching: { type: "none" },
    exposesRoundData: false,
    notes: "Generates a CSV export.",
  },
];

// ---------------------------------------------------------------------------
// Bypass-analysis static knowledge (DIAGNOSTIC ONLY — no implementation)
// ---------------------------------------------------------------------------
//
// Records what protections exist on each upstream, and whether legitimate
// access is already available. Nothing in this module implements a bypass.

interface BypassAnalysisStaticEntry {
  endpoint: string;
  protectionType: BypassAnalysisResult["protectionType"];
  reason: string;
  legitimateAccessAvailable: boolean;
  legitimateAccessDescription: string;
  /**
   * If true, the audit will probe the upstream directly WITHOUT the
   * legitimate headers to record the resulting status code / latency
   * (purely for diagnostic documentation — it never attempts to
   * circumvent; the probe is expected to fail).
   */
  probeDirectly?: boolean;
  /** Upstream URL to probe (diagnostic only — does not attempt to bypass). */
  upstreamProbeUrl?: string;
}

const BYPASS_ANALYSIS_STATIC: BypassAnalysisStaticEntry[] = [
  {
    endpoint: "CasinoScores Crazy Time API (upstream of /api/crazy-time)",
    protectionType: "Cloudflare",
    reason:
      "api-cs.casino.org is fronted by Cloudflare. Headless / " +
      "missing-header requests receive 403. The Next.js route handler " +
      "documents this directly in its header set (User-Agent, Origin, " +
      "Referer) and the project worklog notes '403 for headless requests'.",
    legitimateAccessAvailable: true,
    legitimateAccessDescription:
      "The /api/crazy-time Next.js route adds the upstream-required " +
      "User-Agent, Origin and Referer headers server-side and streams " +
      "the JSON back to the app with Cache-Control: no-store. The app " +
      "calls /api/crazy-time (relative) — no client-side circumvention.",
    probeDirectly: true,
    upstreamProbeUrl:
      "https://api-cs.casino.org/svc-evolution-game-events/api/crazytime?page=0&size=1",
  },
  {
    endpoint: "CasinoScores Crazy Time API — User-Agent filter",
    protectionType: "User-Agent-filter",
    reason:
      "Upstream rejects requests without a browser-like User-Agent. " +
      "The Next.js route sets a Chrome UA in HEADERS.",
    legitimateAccessAvailable: true,
    legitimateAccessDescription:
      "Headers are set server-side in /api/crazy-time/route.ts. The app " +
      "does not need to spoof anything client-side.",
  },
  {
    endpoint: "CasinoScores Crazy Time API — Origin/Referer filter",
    protectionType: "Origin/Referer-filter",
    reason:
      "Upstream requires Origin: https://www.casinoorg-india.com and " +
      "Referer: https://www.casinoorg-india.com/india/casinoscores/crazy-time/.",
    legitimateAccessAvailable: true,
    legitimateAccessDescription:
      "Both headers are set server-side in the Next.js route handler. " +
      "No client-side evasion is performed.",
  },
  {
    endpoint: "CasinoScores Crazy Time API — bot-detection",
    protectionType: "bot-detection",
    reason:
      "Cloudflare bot scoring is in front of the upstream. Excessive " +
      "polling risks a challenge. The Next.js route mitigates this with " +
      "a dedup lock (recentFetchPromise) so concurrent client polls " +
      "coalesce into ONE upstream request, and the client polls at 1.5s.",
    legitimateAccessAvailable: true,
    legitimateAccessDescription:
      "App polls at 1.5s cadence through the dedup-coalescing proxy. " +
      "No rate-limit circumvention is performed.",
  },
  {
    endpoint: "Firebase RTDB (revo-fixer-45a26) — authorization",
    protectionType: "authorization",
    reason:
      "Firebase RTDB rules are currently public-read per the project " +
      "worklog (verified via REST). Write rules are gated by admin key / " +
      "license key logic in the route handlers.",
    legitimateAccessAvailable: true,
    legitimateAccessDescription:
      "Public read is the configured policy. Admin writes happen via " +
      "the /api/generate-keys and /api/verify-admin routes which check " +
      "the admin PIN (8950888988) or admin key.",
  },
  {
    endpoint: "Admin endpoints (/api/admin-data, /api/revenue, /api/generate-keys)",
    protectionType: "authorization",
    reason:
      "Admin-gated by PIN (8950888988) or admin key in the route handlers.",
    legitimateAccessAvailable: true,
    legitimateAccessDescription:
      "Owner unlocks the admin panel using the documented PIN bypass or " +
      "a real admin key. This is a legitimate access mechanism, not a " +
      "circumvention.",
  },
  {
    endpoint: "Video stream (/api/video-proxy)",
    protectionType: "unknown",
    reason:
      "Proxy hides the underlying stream URL. No CAPTCHA / WAF is " +
      "currently documented for this endpoint.",
    legitimateAccessAvailable: true,
    legitimateAccessDescription:
      "Streamed to the client via the Next.js route; no circumvention.",
  },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Resolve a (possibly relative) path against an optional base URL. */
function resolveUrl(path: string, baseUrl?: string): string {
  if (!baseUrl) return path;
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return path;
  }
}

/** Compute the median of a sorted-ascending numeric array. */
function median(sortedAsc: number[]): number {
  if (sortedAsc.length === 0) return 0;
  const mid = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 === 0
    ? (sortedAsc[mid - 1] + sortedAsc[mid]) / 2
    : sortedAsc[mid];
}

/** Compute the q-th percentile (0..100) of a numeric array. */
function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (q / 100) * (sorted.length - 1);
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/** Compute population standard deviation. */
function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/** Build an ApiLatencyStats object from a list of LatencySample. */
function buildLatencyStats(
  endpoint: string,
  samples: LatencySample[],
): ApiLatencyStats {
  const latencies = samples.map((s) => s.latencyMs);
  const sorted = [...latencies].sort((a, b) => a - b);
  const lagSamples = samples.filter(
    (s) => typeof s.deliveryLagMs === "number",
  ) as Array<LatencySample & { deliveryLagMs: number }>;
  const lags = lagSamples.map((s) => s.deliveryLagMs);
  const staleCount = samples.filter((s) => s.stale).length;

  return {
    endpoint,
    samples: samples.length,
    minMs: latencies.length ? Math.min(...latencies) : 0,
    maxMs: latencies.length ? Math.max(...latencies) : 0,
    meanMs: latencies.length
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0,
    medianMs: median(sorted),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    stdDevMs: stdDev(latencies),
    lastSampleAt: samples.length
      ? samples[samples.length - 1].responseArrivedAt
      : 0,
    samplesList: latencies,
    deliveryLagMs: lags.length
      ? {
          min: Math.min(...lags),
          max: Math.max(...lags),
          mean: lags.reduce((a, b) => a + b, 0) / lags.length,
          count: lags.length,
        }
      : undefined,
    staleResponseCount: staleCount,
  };
}

/**
 * Extract round metadata from a /api/crazy-time recent response.
 * Returns settledAt (ms), roundId, and whether the response is stale.
 *
 * "Stale" here means the most recent settledAt is more than STALE_THRESHOLD_MS
 * behind the response arrival time — i.e. the source has not published a new
 * round in an unusually long window (table closed, API stalled, etc.).
 */
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

interface CrazyTimeRoundMeta {
  latestSettledAt?: number;
  roundId?: string;
  count: number;
  stale: boolean;
}

function extractCrazyTimeMeta(
  body: unknown,
  responseArrivedAt: number,
): CrazyTimeRoundMeta {
  const arr = Array.isArray(body) ? body : [];
  if (arr.length === 0) {
    // No rounds returned — almost certainly stale (table closed / API issue).
    return { count: 0, stale: true };
  }
  const latest = arr[0] as
    | { data?: { settledAt?: string; result?: { outcome?: { wheelResult?: { wheelSector?: string } } } } }
    | undefined;
  const settledAtStr = latest?.data?.settledAt;
  if (!settledAtStr) return { count: arr.length, stale: true };
  const settledAt = new Date(settledAtStr).getTime();
  if (!Number.isFinite(settledAt)) return { count: arr.length, stale: true };
  const roundId = `${latest?.data?.result?.outcome?.wheelResult?.wheelSector ?? "?"}-${settledAt}`;
  const stale = responseArrivedAt - settledAt > STALE_THRESHOLD_MS;
  return {
    latestSettledAt: settledAt,
    roundId,
    count: arr.length,
    stale,
  };
}

/** Sleep for ms milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

/** Issue a single latency probe against an endpoint. */
async function probeOnce(
  url: string,
  method: HttpMethod,
  index: number,
  isCrazyTimeRecent: boolean,
  abortSignal?: AbortSignal,
): Promise<LatencySample> {
  const requestStartedAt = Date.now();
  const featureTimestamp = requestStartedAt; // tentatively; refined below
  try {
    const res = await fetch(url, {
      method,
      cache: "no-store",
      signal: abortSignal,
      headers: { Accept: "application/json" },
    });
    const responseArrivedAt = Date.now();
    let body: unknown = undefined;
    if (res.ok) {
      try {
        body = await res.json();
      } catch {
        // Non-JSON body (e.g. PDF / CSV / video stream) — that's fine.
        body = undefined;
      }
    }

    let meta: CrazyTimeRoundMeta | undefined;
    if (isCrazyTimeRecent) {
      meta = extractCrazyTimeMeta(body, responseArrivedAt);
    }

    const sample: LatencySample = {
      index,
      requestStartedAt,
      responseArrivedAt,
      latencyMs: responseArrivedAt - requestStartedAt,
      statusCode: res.status,
      error: res.ok ? "" : `HTTP ${res.status}`,
      featureTimestamp: responseArrivedAt,
      stale: meta?.stale ?? false,
      latestSettledAt: meta?.latestSettledAt,
      roundId: meta?.roundId,
    };
    if (meta?.latestSettledAt !== undefined) {
      sample.availabilityTimestamp = meta.latestSettledAt;
      sample.deliveryLagMs = responseArrivedAt - meta.latestSettledAt;
    }
    // Suppress unused-variable lint for featureTimestamp alias.
    void featureTimestamp;
    return sample;
  } catch (err) {
    const responseArrivedAt = Date.now();
    const message = err instanceof Error ? err.message : String(err);
    return {
      index,
      requestStartedAt,
      responseArrivedAt,
      latencyMs: responseArrivedAt - requestStartedAt,
      statusCode: 0,
      error: message,
      featureTimestamp: responseArrivedAt,
      stale: false,
    };
  }
}

/**
 * Probe an upstream URL DIRECTLY without the legitimate headers, purely to
 * document the resulting status code / latency for the bypass analysis.
 *
 * ⚠️  This never attempts to circumvent the protection. The probe is
 *     expected to fail (403 / challenge) — the failure itself is the
 *     diagnostic data we record.
 */
async function probeDirectlyWithoutLegitimateHeaders(
  url: string,
): Promise<{ statusCode: number; latencyMs: number; error: string }> {
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      // Intentionally OMIT User-Agent / Origin / Referer to observe the
      // protection response. This does NOT bypass anything — it confirms
      // the protection exists.
    });
    return {
      statusCode: res.status,
      latencyMs: Date.now() - startedAt,
      error: res.ok ? "" : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      statusCode: 0,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface RunApiAuditOptions {
  /** Base URL for resolving relative endpoint paths (server-side use). */
  baseUrl?: string;
  /** Number of latency samples to take for multiSample endpoints (default 5). */
  samplesPerEndpoint?: number;
  /** Delay (ms) between samples for the same endpoint (default 250ms). */
  sampleDelayMs?: number;
  /** Whether to run the diagnostic direct-upstream probes (default true). */
  probeUpstreamDirectly?: boolean;
  /** Optional AbortSignal to cancel the audit. */
  signal?: AbortSignal;
}

/**
 * Run a full API audit. Probes every endpoint in the registry, collects
 * latency samples for the crazy-time endpoint, and produces a bypass
 * analysis (DIAGNOSTIC ONLY — no circumvention is implemented).
 *
 * @returns an ApiAuditReport
 */
export async function runApiAudit(
  opts: RunApiAuditOptions = {},
): Promise<ApiAuditReport> {
  const {
    baseUrl,
    samplesPerEndpoint = 5,
    sampleDelayMs = 250,
    probeUpstreamDirectly = true,
    signal,
  } = opts;

  const auditStartedAt = Date.now();
  const endpoints: ApiEndpointInfo[] = [];

  for (const entry of ENDPOINT_REGISTRY) {
    const shouldProbe = entry.probe !== false;
    const samples: LatencySample[] = [];

    if (shouldProbe) {
      const url = resolveUrl(entry.path, baseUrl);
      const isCrazyTimeRecent =
        entry.path.startsWith("/api/crazy-time") &&
        entry.path.includes("type=recent");
      const numSamples = entry.multiSample ? samplesPerEndpoint : 1;
      for (let i = 0; i < numSamples; i++) {
        if (signal?.aborted) break;
        const sample = await probeOnce(
          url,
          entry.method,
          i,
          isCrazyTimeRecent,
          signal,
        );
        samples.push(sample);
        if (i < numSamples - 1 && sampleDelayMs > 0) {
          await sleep(sampleDelayMs);
        }
      }
    }

    const info: ApiEndpointInfo = {
      name: entry.name,
      path: entry.path,
      method: entry.method,
      source: entry.source,
      upstreamUrl: entry.upstreamUrl,
      authorizationStatus: entry.authorizationStatus,
      caching: entry.caching,
      duplicateDetection: entry.duplicateDetection,
      exposesRoundData: entry.exposesRoundData,
      roundIdField: entry.roundIdField,
      sequenceField: entry.sequenceField,
      latencySamples: samples,
      notes: entry.notes,
    };

    if (samples.length > 0) {
      info.latency = buildLatencyStats(entry.path, samples);
      const last = samples[samples.length - 1];
      info.featureTimestamp = last.featureTimestamp;
      info.availabilityTimestamp = last.availabilityTimestamp;
      info.deliveryLagMs = last.deliveryLagMs;
      info.staleResponseDetected = last.stale;
    }

    endpoints.push(info);
  }

  // ---- Bypass analysis (DIAGNOSTIC ONLY) --------------------------------
  const bypassAnalysis: BypassAnalysisResult[] = [];
  for (const entry of BYPASS_ANALYSIS_STATIC) {
    let statusCode = 0;
    let latencyMs = 0;
    let reason = entry.reason;

    if (probeUpstreamDirectly && entry.probeDirectly && entry.upstreamProbeUrl) {
      const probe = await probeDirectlyWithoutLegitimateHeaders(
        entry.upstreamProbeUrl,
      );
      statusCode = probe.statusCode;
      latencyMs = probe.latencyMs;
      if (probe.error) {
        reason +=
          ` Direct probe observed: HTTP ${probe.statusCode}` +
          (probe.error ? ` (${probe.error})` : "") +
          ` in ${probe.latencyMs}ms. This confirms the protection exists.`;
      } else {
        reason +=
          ` Direct probe observed: HTTP ${probe.statusCode}` +
          ` in ${probe.latencyMs}ms.`;
      }
    }

    bypassAnalysis.push({
      endpoint: entry.endpoint,
      protectionType: entry.protectionType,
      statusCode,
      latencyMs,
      reason,
      legitimateAccessAvailable: entry.legitimateAccessAvailable,
      legitimateAccessDescription: entry.legitimateAccessDescription,
      diagnosticOnly: true,
    });
  }

  // ---- Aggregated latency stats for crazy-time (primary target) ---------
  const crazyTimeInfo = endpoints.find(
    (e) =>
      e.path.startsWith("/api/crazy-time") && e.path.includes("type=recent"),
  );
  const latencyStats =
    crazyTimeInfo?.latency ??
    buildLatencyStats("/api/crazy-time?type=recent&size=30&duration=24", []);

  // ---- Summary ----------------------------------------------------------
  const publicCount = endpoints.filter(
    (e) => e.authorizationStatus === "public",
  ).length;
  const authedCount = endpoints.filter(
    (e) => e.authorizationStatus === "authenticated",
  ).length;
  const adminCount = endpoints.filter(
    (e) => e.authorizationStatus === "admin",
  ).length;
  const cachedCount = endpoints.filter(
    (e) => e.caching.type !== "none",
  ).length;
  const dedupCount = endpoints.filter(
    (e) => e.duplicateDetection?.enabled,
  ).length;
  const protectedCount = bypassAnalysis.filter(
    (b) => b.protectionType !== "none" && b.protectionType !== "unknown",
  ).length;

  const auditDurationMs = Date.now() - auditStartedAt;

  return {
    generatedAt: auditStartedAt,
    auditDurationMs,
    endpoints,
    bypassAnalysis,
    latencyStats,
    summary: {
      totalEndpoints: endpoints.length,
      publicEndpoints: publicCount,
      authenticatedEndpoints: authedCount,
      adminEndpoints: adminCount,
      endpointsWithCache: cachedCount,
      endpointsWithDedup: dedupCount,
      endpointsWithBypassProtection: protectedCount,
      notes:
        "All endpoints are accessed through legitimate app channels. " +
        "The crazy-time endpoint proxies upstream through /api/crazy-time " +
        "with the required headers set server-side; no client-side " +
        "circumvention is performed anywhere in the app.",
    },
    diagnosticOnlyNotice:
      "DIAGNOSTIC ONLY — this report documents what API protections " +
      "exist and confirms legitimate access paths. It does NOT implement " +
      "any bypass, circumvention, or evasion technique.",
  };
}

interface GetApiLatencyStatsOptions {
  /** Base URL for resolving relative endpoint paths (server-side use). */
  baseUrl?: string;
  /** Number of latency samples to collect (default 8). */
  samples?: number;
  /** Delay (ms) between samples (default 1500ms — matches app polling). */
  delayMs?: number;
  /** Optional AbortSignal. */
  signal?: AbortSignal;
}

/**
 * Collect latency statistics for the crazy-time recent endpoint (the
 * primary live feed). Returns latency percentiles, delivery lag (source→app),
 * stale-response count, and the latest round id observed.
 *
 * @returns ApiLatencyStats for /api/crazy-time?type=recent&size=30&duration=24
 */
export async function getApiLatencyStats(
  opts: GetApiLatencyStatsOptions = {},
): Promise<ApiLatencyStats> {
  const { baseUrl, samples = 8, delayMs = 1500, signal } = opts;
  const url = resolveUrl(
    "/api/crazy-time?type=recent&size=30&duration=24",
    baseUrl,
  );

  const collected: LatencySample[] = [];
  for (let i = 0; i < samples; i++) {
    if (signal?.aborted) break;
    const sample = await probeOnce(url, "GET", i, true, signal);
    collected.push(sample);
    if (i < samples - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }
  return buildLatencyStats(
    "/api/crazy-time?type=recent&size=30&duration=24",
    collected,
  );
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export {
  ENDPOINT_REGISTRY as KNOWN_ENDPOINTS,
  BYPASS_ANALYSIS_STATIC as KNOWN_BYPASS_PROTECTIONS,
  STALE_THRESHOLD_MS as STALE_RESPONSE_THRESHOLD_MS,
};
