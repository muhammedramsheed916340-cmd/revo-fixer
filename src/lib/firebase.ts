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

/** Real activation codes (Crazy Time Revo Signal) — usage stats only. */
export async function getActivationCodes(): Promise<ActivationCode[]> {
  const map = await fbGet<Record<string, ActivationCode>>("activation_codes");
  if (!map) return [];
  return Object.values(map);
}

/** Real admin keys (login counters only — no secrets). */
export async function getAdminKeys(): Promise<AdminKey[]> {
  const map = await fbGet<Record<string, AdminKey>>("adminKeys");
  if (!map) return [];
  return Object.values(map);
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
