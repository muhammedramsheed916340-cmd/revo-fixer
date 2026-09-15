import { NextResponse } from "next/server";
import { verifyAdminKey } from "@/lib/firebase";

export const dynamic = "force-dynamic";

/**
 * Admin access gate.
 *
 * Two accepted credentials:
 *  1. Bypass PIN  — a simple numeric code the owner can type quickly.
 *     Default: 8950888988 (override via ADMIN_BYPASS_PIN env).
 *  2. Real admin key — stored in Firebase `adminKeys/*` (XXXX-XXXX-XXXX-XXXX).
 *
 * The bypass PIN is intentionally NOT a Firebase record. It grants the same
 * read-only panel access without needing the complex 4-4-4-4 key format.
 */
const BYPASS_PIN = (process.env.ADMIN_BYPASS_PIN ?? "8950888988").trim();

export async function POST(req: Request) {
  let body: { key?: string; pin?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request" },
      { status: 400 },
    );
  }

  const raw = (body.key ?? body.pin ?? "").trim();
  if (!raw) {
    return NextResponse.json({ ok: false, error: "Empty credential" });
  }

  // --- 1. Bypass PIN (numeric, fast path) ---
  // Accept digits only — ignore spaces/dashes the user might type by habit.
  const digits = raw.replace(/\D/g, "");
  if (digits && digits === BYPASS_PIN) {
    return NextResponse.json({
      ok: true,
      key: "BYPASS-PIN",
      mode: "pin",
      label: "Owner (PIN bypass)",
    });
  }

  // --- 2. Real admin key (Firebase lookup) ---
  const result = await verifyAdminKey(raw);
  if (result.ok) {
    return NextResponse.json({ ...result, mode: "firebase" });
  }

  return NextResponse.json({
    ok: false,
    error: "Invalid PIN or admin key.",
  });
}
