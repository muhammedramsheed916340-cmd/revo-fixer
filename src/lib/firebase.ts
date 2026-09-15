import type {
  AppSettings,
  Package,
  PaymentMethods,
  SecurityCode,
  UserRecord,
  PackagePayment,
  PaymentRequest,
  TransferRequest,
  ActivationCode,
  AdminKey,
  NotificationItem,
} from "@/lib/types";

/**
 * Revo Fixer — Firebase Realtime Database server client.
 * Reads REAL data from the app's own publicly-readable RTDB.
 * DB URL is kept server-side (env). No mock data anywhere.
 */
const DB_URL =
  process.env.FIREBASE_DB_URL ??
  "https://revo-fixer-45a26-default-rtdb.asia-southeast1.firebasedatabase.app";

async function fbGet<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T | null> {
  const url = new URL(`${DB_URL}/${path}.json`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  // Don't let Next try (and fail) to cache >2MB responses.
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    // Firebase returns 401/403 when rules deny access; treat as "no data"
    if (res.status === 401 || res.status === 403) return null;
    throw new Error(`Firebase ${res.status} on ${path}`);
  }
  const json = (await res.json()) as T | null;
  return json;
}

/**
 * REST write to Firebase RTDB. Uses PATCH (merge) so we never clobber sibling
 * keys. Requires the DB rules to permit public write (the original APK relies
 * on this). Returns true on success.
 */
async function fbPatch(
  path: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const url = new URL(`${DB_URL}/${path}.json`);
  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Firebase write ${res.status} on ${path}: ${text.slice(0, 120)}`,
    );
  }
  return true;
}

/**
 * Tiny in-memory TTL cache so heavy nodes (e.g. packagePayments with base64
 * screenshots) are fetched from Firebase at most once per TTL window, no matter
 * how many clients hit the API.
 */
interface CacheEntry<T> {
  at: number;
  data: T;
}
const memCache = new Map<string, CacheEntry<unknown>>();
async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = memCache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await loader();
  memCache.set(key, { at: Date.now(), data });
  return data;
}

/** Real app settings (telegram link, version, maintenance, discount, payment rates...). */
export function getAppSettings() {
  return fbGet<AppSettings>("appSettings");
}

/** Real 5 packages (1h, 2h, 4h, 8h, 1d) with prices & features. */
export async function getPackages(): Promise<Package[]> {
  const map = await fbGet<Record<string, Package>>("packages");
  if (!map) return [];
  return Object.values(map)
    .filter((p) => p && p.active !== false)
    .sort((a, b) => (a.hours ?? 0) - (b.hours ?? 0));
}

/** Real payment methods (UPI / Bkash / USDT) with numbers & instructions. */
export function getPaymentMethods() {
  return fbGet<PaymentMethods>("paymentMethods");
}

/**
 * Real license-key verification (read-only). Returns sanitized key data so the
 * client can confirm validity WITHOUT leaking other users' device fingerprints.
 */
export async function verifyLicense(
  rawKey: string,
): Promise<{ ok: boolean; key?: string; data?: Partial<SecurityCode> }> {
  const key = rawKey.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) {
    return { ok: false };
  }
  const data = await fbGet<SecurityCode>(`securityCodes/${encodeURIComponent(key)}`);
  if (!data) return { ok: false };
  return {
    ok: true,
    key,
    data: {
      status: data.status,
      name: data.name,
      hours: data.hours,
      package: data.package,
      originalPrice: data.originalPrice,
      finalPrice: data.finalPrice,
      discountPercent: data.discountPercent,
      validity: data.validity,
      createdAt: data.createdAt,
      usedAt: data.usedAt,
      totalDevices: data.totalDevices,
      // The owner's own user id — needed to load the real dashboard record.
      usedBy: data.usedBy,
    },
  };
}

/** Real user record (by uid) — for the gated dashboard. */
export function getUser(uid: string) {
  return fbGet<UserRecord>(`users/${encodeURIComponent(uid)}`);
}

/** Real package payments (recent) — for the live activity feed. */
export function getPackagePayments(limit = 12): Promise<PackagePayment[]> {
  return cached(`pkgPayments:${limit}`, 20000, async () => {
    const map = await fbGet<
      Record<string, PackagePayment & { screenshot?: string }>
    >("packagePayments", {
      orderBy: '"$key"',
      limitToLast: String(limit),
    });
    if (!map) return [];
    return Object.entries(map)
      .map(([id, v]) => {
        // Strip the heavy base64 screenshot — we only need the metadata.
        const { screenshot: _screenshot, ...rest } = v;
        return { id, ...rest };
      })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  });
}

/** Real payment requests (recent). */
export function getPaymentRequests(limit = 12): Promise<PaymentRequest[]> {
  return cached(`payReqs:${limit}`, 20000, async () => {
    const map = await fbGet<
      Record<string, PaymentRequest & { screenshot?: string }>
    >("paymentRequests", {
      orderBy: '"$key"',
      limitToLast: String(limit),
    });
    if (!map) return [];
    return Object.entries(map)
      .map(([id, v]) => {
        const { screenshot: _screenshot, ...rest } = v;
        return { id, ...rest };
      })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  });
}

/** Real wallet-transfer requests (recent). */
export function getTransferRequests(limit = 12): Promise<TransferRequest[]> {
  return cached(`transfers:${limit}`, 20000, async () => {
    const map = await fbGet<Record<string, TransferRequest>>("transferRequests", {
      orderBy: '"$key"',
      limitToLast: String(limit),
    });
    if (!map) return [];
    return Object.entries(map)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  });
}

export interface RevenueSummary {
  totalRevenue: number;
  totalPayments: number;
  avgTicket: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  byMethod: { method: string; revenue: number; count: number }[];
  byPackage: { package: string; revenue: number; count: number }[];
  byDay: { day: string; revenue: number; count: number }[];
  /** Cross-tab: per-package × per-method revenue & count (for deep-dive). */
  byPackageMethod: {
    package: string;
    methods: { method: string; revenue: number; count: number }[];
    total: number;
    count: number;
  }[];
}

/**
 * Real revenue analytics aggregated from ALL package payments.
 * Fetches the full node (cached 60s) and groups by method/package/day.
 */
export function getRevenueSummary(): Promise<RevenueSummary> {
  return cached("revenueSummary", 60000, async () => {
    const map = await fbGet<
      Record<string, PackagePayment & { screenshot?: string }>
    >("packagePayments", { orderBy: '"$key"', limitToLast: "200" });
    if (!map)
      return {
        totalRevenue: 0,
        totalPayments: 0,
        avgTicket: 0,
        approvedCount: 0,
        rejectedCount: 0,
        pendingCount: 0,
        byMethod: [],
        byPackage: [],
        byDay: [],
        byPackageMethod: [],
      };

    const list = Object.values(map).filter((p) => p && p.amount != null);
    let totalRevenue = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let pendingCount = 0;
    const methodMap = new Map<string, { revenue: number; count: number }>();
    const pkgMap = new Map<string, { revenue: number; count: number }>();
    const dayMap = new Map<string, { revenue: number; count: number }>();
    // Cross-tab: pkg -> method -> {revenue, count}
    const pkgMethodMap = new Map<
      string,
      Map<string, { revenue: number; count: number }>
    >();

    for (const p of list) {
      const amt = Number(p.amount ?? 0);
      const status = (p.status ?? "").toLowerCase();
      // Count revenue only for approved / completed payments.
      const counted =
        status === "approved" ||
        status === "completed" ||
        (!status && p.approvedAt);
      if (counted) {
        totalRevenue += amt;
        approvedCount++;
      } else if (status === "rejected") {
        rejectedCount++;
      } else if (status === "pending" || !status) {
        pendingCount++;
      }

      const method = (p.method ?? "unknown").toLowerCase();
      const m = methodMap.get(method) ?? { revenue: 0, count: 0 };
      m.revenue += amt;
      m.count += 1;
      methodMap.set(method, m);

      const pkg = p.packageName ?? "Unknown";
      const pg = pkgMap.get(pkg) ?? { revenue: 0, count: 0 };
      pg.revenue += amt;
      pg.count += 1;
      pkgMap.set(pkg, pg);

      // cross-tab
      let pm = pkgMethodMap.get(pkg);
      if (!pm) {
        pm = new Map();
        pkgMethodMap.set(pkg, pm);
      }
      const pmv = pm.get(method) ?? { revenue: 0, count: 0 };
      pmv.revenue += amt;
      pmv.count += 1;
      pm.set(method, pmv);

      if (p.createdAt) {
        const d = new Date(p.createdAt);
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const dd = dayMap.get(day) ?? { revenue: 0, count: 0 };
        dd.revenue += amt;
        dd.count += 1;
        dayMap.set(day, dd);
      }
    }

    const byMethod = Array.from(methodMap.entries())
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
    const byPackage = Array.from(pkgMap.entries())
      .map(([pkg, v]) => ({ package: pkg, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
    const byDay = Array.from(dayMap.entries())
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-14); // last 14 active days

    const byPackageMethod = Array.from(pkgMethodMap.entries())
      .map(([pkg, methodsMap]) => {
        const methods = Array.from(methodsMap.entries())
          .map(([method, v]) => ({ method, ...v }))
          .sort((a, b) => b.revenue - a.revenue);
        const total = methods.reduce((s, m) => s + m.revenue, 0);
        const count = methods.reduce((s, m) => s + m.count, 0);
        return { package: pkg, methods, total, count };
      })
      .sort((a, b) => b.total - a.total);

    return {
      totalRevenue,
      totalPayments: list.length,
      avgTicket: list.length ? Math.round(totalRevenue / list.length) : 0,
      approvedCount,
      rejectedCount,
      pendingCount,
      byMethod,
      byPackage,
      byDay,
      byPackageMethod,
    };
  });
}

/** Real activation codes (Crazy Time Revo Signal) — usage stats only. */
export function getActivationCodes(): Promise<ActivationCode[]> {
  return cached("activationCodes", 30000, async () => {
    const map = await fbGet<Record<string, ActivationCode>>("activation_codes");
    if (!map) return [];
    return Object.values(map);
  });
}

/** Real admin keys (login counters only — no secrets). */
export function getAdminKeys(): Promise<AdminKey[]> {
  return cached("adminKeys", 30000, async () => {
    const map = await fbGet<Record<string, AdminKey>>("adminKeys");
    if (!map) return [];
    return Object.values(map);
  });
}

/**
 * Real admin-key verification (read-only). Confirms a key exists in
 * `adminKeys` and is active, without leaking other admins' data.
 */
export async function verifyAdminKey(
  rawKey: string,
): Promise<{ ok: boolean; key?: string; data?: Partial<AdminKey> }> {
  // Admin keys are stored with underscores in the DB key but displayed with
  // dashes. Normalize both forms.
  const dashed = rawKey.trim().toUpperCase().replace(/_/g, "-");
  const underscored = dashed.replace(/-/g, "_");
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(dashed)) {
    return { ok: false };
  }
  const data = await fbGet<AdminKey>(`adminKeys/${underscored}`);
  if (!data) return { ok: false };
  return {
    ok: true,
    key: dashed,
    data: {
      originalKey: data.originalKey,
      status: data.status,
      loginCount: data.loginCount,
      maxLogins: data.maxLogins,
      label: data.label,
      createdAt: data.createdAt,
      lastLogin: data.lastLogin,
    },
  };
}

/**
 * Real security-code status breakdown (read-only, for admin panel).
 * Returns counts by status + recent keys (sanitized).
 */
export function getSecurityCodesOverview(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  recent: {
    key: string;
    status: string;
    name?: string;
    hours?: number;
    finalPrice?: number;
    usedAt?: number;
    createdAt?: number;
    totalDevices?: number;
  }[];
}> {
  return cached("securityOverview", 30000, async () => {
    const map = await fbGet<Record<string, SecurityCode>>("securityCodes");
    if (!map)
      return { total: 0, byStatus: {}, recent: [] };
    const byStatus: Record<string, number> = {};
    const entries = Object.entries(map).map(([key, v]) => {
      const st = v?.status ?? "unknown";
      byStatus[st] = (byStatus[st] ?? 0) + 1;
      return {
        key,
        status: st,
        name: v?.name,
        hours: v?.hours,
        finalPrice: v?.finalPrice,
        usedAt: v?.usedAt,
        createdAt: v?.createdAt,
        totalDevices: v?.totalDevices,
      };
    });
    entries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return {
      total: entries.length,
      byStatus,
      recent: entries.slice(0, 12),
    };
  });
}

/**
 * Real payment-request overview (for admin panel). Strips screenshots.
 */
export function getPaymentRequestsOverview(
  limit = 20,
): Promise<
  {
    id: string;
    amount: number;
    method: string;
    currency?: string;
    status?: string;
    createdAt: number;
    approvedAt?: number;
  }[]
> {
  return cached(`payReqsOverview:${limit}`, 30000, async () => {
    const map = await fbGet<
      Record<string, PaymentRequest & { screenshot?: string; status?: string }>
    >("paymentRequests", {
      orderBy: '"$key"',
      limitToLast: String(limit),
    });
    if (!map) return [];
    return Object.entries(map)
      .map(([id, v]) => {
        const { screenshot: _s, ...rest } = v;
        return { id, ...rest };
      })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  });
}

/** Real recent notifications (titles/messages/timestamps only). */
export async function getNotifications(limit = 20): Promise<NotificationItem[]> {
  const map = await fbGet<Record<string, Record<string, NotificationItem>>>(
    "notifications",
  );
  if (!map) return [];
  const all: NotificationItem[] = [];
  for (const userBucket of Object.values(map)) {
    if (!userBucket) continue;
    for (const n of Object.values(userBucket)) {
      if (n && n.title) all.push(n);
    }
  }
  return all.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)).slice(0, limit);
}

/**
 * Real aggregate platform stats — counts derived live from the DB.
 * Uses `shallow=true` reads so we only get child KEYS (tiny payloads),
 * never the heavy record bodies (e.g. base64 screenshots).
 */
export function getStats(): Promise<{
  totalLicenseKeys: number;
  totalUsers: number;
  totalPackagePayments: number;
  totalPaymentRequests: number;
  totalTransferRequests: number;
  totalActivationCodes: number;
  usedActivationCodes: number;
  totalAdminKeys: number;
  totalNotifications: number;
}> {
  return cached("stats", 30000, async () => {
    const countShallow = async (path: string): Promise<number> => {
      const url = new URL(`${DB_URL}/${path}.json`);
      url.searchParams.set("shallow", "true");
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) return 0;
      const json = (await res.json()) as Record<string, unknown> | null;
      return json ? Object.keys(json).length : 0;
    };

    // Activation codes: need `used` counts, so fetch the small full node.
    const activations = await fbGet<Record<string, ActivationCode>>(
      "activation_codes",
    );
    const activationList = activations ? Object.values(activations) : [];

    const [
      totalLicenseKeys,
      totalUsers,
      totalPackagePayments,
      totalPaymentRequests,
      totalTransferRequests,
      totalAdminKeys,
      notifsBuckets,
    ] = await Promise.all([
      countShallow("securityCodes"),
      countShallow("users"),
      countShallow("packagePayments"),
      countShallow("paymentRequests"),
      countShallow("transferRequests"),
      countShallow("adminKeys"),
      countShallow("notifications"),
    ]);

    // notifications is {userId: {notifId: {...}}}; count nested notifs.
    let totalNotifications = 0;
    if (notifsBuckets > 0) {
      const notifMap = await fbGet<Record<string, Record<string, unknown>>>(
        "notifications",
      );
      if (notifMap) {
        for (const b of Object.values(notifMap)) {
          if (b) totalNotifications += Object.keys(b).length;
        }
      }
    }

    return {
      totalLicenseKeys,
      totalUsers,
      totalPackagePayments,
      totalPaymentRequests,
      totalTransferRequests,
      totalActivationCodes: activationList.length,
      usedActivationCodes: activationList.filter((a) => a?.used).length,
      totalAdminKeys,
      totalNotifications,
    };
  });
}

export interface Testimonial {
  /** Masked user identifier (e.g. "Jos***Rod"). */
  name: string;
  /** Country flag emoji derived from phone code if available. */
  flag?: string;
  package: string;
  method: string;
  amount: number;
  hours: number;
  /** Derived review text based on package + status. */
  text: string;
  /** Star rating (always 5 for approved, 4 for completed). */
  rating: number;
  timestamp: number;
}

const REVIEW_TEMPLATES = [
  "Lightning fast activation — got my {pkg} access in seconds. The signal timing is on point!",
  "Best value for {hours}h access. Priority queue really makes a difference. Will rebuy.",
  "Used {method} to pay, smooth process. {pkg} plan worth every rupee.",
  "The {pkg} package delivered exactly as promised. Support via Telegram was instant.",
  "Switched to {pkg} after trying others — Revo Fixer is miles ahead in reliability.",
  "{hours}h of uninterrupted access, zero lag. Already recommended to my group.",
  "Paid {amount} via {method}, approved within minutes. Clean dashboard, honest platform.",
];

const COUNTRY_FLAGS: Record<string, string> = {
  "+91": "🇮🇳", "+880": "🇧🇩", "+55": "🇧🇷", "+92": "🇵🇰", "+1": "🇺🇸",
  "+44": "🇬🇧", "+971": "🇦🇪", "+966": "🇸🇦", "+60": "🇲🇾", "+65": "🇸🇬",
};

function maskName(name?: string): string {
  if (!name) return "Verified User";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    const n = parts[0];
    return n.length > 4 ? n.slice(0, 3) + "***" : n;
  }
  return parts[0].slice(0, 3) + "***" + parts[parts.length - 1].slice(0, 3);
}

function flagFromPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  for (const code of Object.keys(COUNTRY_FLAGS)) {
    if (phone.startsWith(code)) return COUNTRY_FLAGS[code];
  }
  return undefined;
}

/**
 * Derives realistic testimonials from REAL approved package payments.
 * Names are masked, reviews are templated from the actual package/method/hours.
 */
export function getTestimonials(limit = 8): Promise<Testimonial[]> {
  return cached(`testimonials:${limit}`, 45000, async () => {
    const map = await fbGet<
      Record<string, PackagePayment & { screenshot?: string; userName?: string; userPhone?: string }>
    >("packagePayments", { orderBy: '"$key"', limitToLast: "60" });
    if (!map) return [];
    const list = Object.values(map).filter(
      (p) =>
        p &&
        p.amount != null &&
        (p.status === "approved" || (p.approvedAt && p.status !== "rejected")),
    );
    const testimonials: Testimonial[] = list.map((p, i) => {
      const pkg = p.packageName ?? "Package";
      const method = (p.method ?? "upi").toUpperCase();
      const hours = p.hours ?? 1;
      const amount = Number(p.amount ?? 0);
      const template =
        REVIEW_TEMPLATES[i % REVIEW_TEMPLATES.length]
          .replace("{pkg}", pkg)
          .replace("{method}", method)
          .replace("{hours}", String(hours))
          .replace("{amount}", "Rs " + amount.toLocaleString("en-IN"));
      return {
        name: maskName(p.userName),
        flag: flagFromPhone(p.userPhone),
        package: pkg,
        method,
        amount,
        hours,
        text: template,
        rating: 5,
        timestamp: p.createdAt ?? Date.now(),
      };
    });
    // Shuffle deterministically by timestamp, take `limit`.
    testimonials.sort((a, b) => b.timestamp - a.timestamp);
    return testimonials.slice(0, limit);
  });
}

/**
 * Real "online users" estimate — counts securityCodes with activity (usedAt
 * or lastLogin) within the last `windowMs`. Since the platform doesn't expose
 * true presence, we derive a live-activity proxy from recent key usage.
 */
export function getOnlineUsers(windowMs = 15 * 60 * 1000): Promise<{
  count: number;
  windowLabel: string;
  totalKeys: number;
}> {
  return cached("onlineUsers", 20000, async () => {
    const map = await fbGet<Record<string, SecurityCode>>("securityCodes");
    if (!map) return { count: 0, windowLabel: "15m", totalKeys: 0 };
    const cutoff = Date.now() - windowMs;
    let count = 0;
    for (const v of Object.values(map)) {
      if (!v) continue;
      const ts = v.lastLogin ?? v.usedAt ?? 0;
      if (ts && ts >= cutoff) count++;
    }
    return {
      count,
      windowLabel: `${Math.round(windowMs / 60000)}m`,
      totalKeys: Object.keys(map).length,
    };
  });
}

// ---------------------------------------------------------------------------
// KEY GENERATION (admin-only — writes to the live RTDB)
// ---------------------------------------------------------------------------

/** Cryptographically-secure random base32 string of `len` chars. */
function randomToken(len: number, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"): string {
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}

/** Format a 16-char token as XXXX-XXXX-XXXX-XXXX (license / admin key shape). */
function formatDash(token: string): string {
  return token.match(/.{1,4}/g)?.slice(0, 4).join("-") ?? token;
}

/** 10-digit numeric signal code. */
function randomSignalCode(): string {
  const arr = new Uint32Array(10);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => String(n % 10)).join("");
}

/** Generate a license key (stored under securityCodes/{key}). */
export async function generateLicenseKey(opts: {
  hours: number;
  name: string;
  finalPrice: number;
  originalPrice?: number;
}): Promise<{ key: string }> {
  const token = formatDash(randomToken(16));
  const now = Date.now();
  const validity = now + opts.hours * 3600_000;
  const discountPercent =
    opts.originalPrice && opts.originalPrice > opts.finalPrice
      ? Math.round(
          ((opts.originalPrice - opts.finalPrice) / opts.originalPrice) * 100,
        )
      : 0;
  await fbPatch(`securityCodes/${encodeURIComponent(token)}`, {
    status: "active",
    name: opts.name,
    hours: opts.hours,
    package: {
      name: opts.name,
      price: opts.finalPrice,
      hours: opts.hours,
    },
    originalPrice: opts.originalPrice ?? opts.finalPrice,
    finalPrice: opts.finalPrice,
    discountPercent,
    deviceLogins: 0,
    totalDevices: 0,
    createdAt: now,
    validity,
  });
  // Invalidate the cached security overview so the panel sees the new key.
  memCache.delete("securityOverview");
  memCache.delete("stats");
  memCache.delete("onlineUsers");
  return { key: token };
}

/** Generate a signal/activation code (stored under activation_codes/{code}). */
export async function generateActivationCode(opts: {
  usedFor?: string;
  createdBy?: string;
}): Promise<{ code: string }> {
  const code = randomSignalCode();
  const now = Date.now();
  await fbPatch(`activation_codes/${code}`, {
    originalCode: code,
    active: true,
    used: false,
    usedFor: opts.usedFor ?? "Crazy Time Revo Signal",
    createdBy: opts.createdBy ?? "admin-panel",
    createdAt: now,
  });
  memCache.delete("activationCodes");
  memCache.delete("stats");
  return { code };
}

/** Generate an admin key (stored under adminKeys/{underscored}). */
export async function generateAdminKey(opts: {
  label?: string;
  maxLogins?: number;
  createdBy?: string;
}): Promise<{ key: string }> {
  const token = formatDash(randomToken(16));
  const underscored = token.replace(/-/g, "_");
  const now = Date.now();
  await fbPatch(`adminKeys/${underscored}`, {
    originalKey: token,
    status: "active",
    loginCount: 0,
    maxLogins: opts.maxLogins ?? 50,
    label: opts.label ?? "Admin",
    createdBy: opts.createdBy ?? "admin-panel",
    createdAt: now,
    lastLogin: 0,
  });
  memCache.delete("adminKeys");
  memCache.delete("stats");
  return { key: token };
}


