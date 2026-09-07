import { NextResponse } from "next/server";
import {
  getPackagePayments,
  getTransferRequests,
  getAppSettings,
} from "@/lib/firebase";

export const dynamic = "force-dynamic";

/** Escape a CSV field (RFC 4180). */
function csvField(v: string | number): string {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Generates a CSV transaction-history export.
 * All data is REAL (live packagePayments + transferRequests from Firebase).
 */
export async function GET() {
  const [payments, transfers, settings] = await Promise.all([
    getPackagePayments(100),
    getTransferRequests(50),
    getAppSettings(),
  ]);

  const rows: (string | number)[][] = [];
  // Header row
  rows.push([
    "Date (UTC)",
    "Type",
    "Package",
    "Method",
    "Amount (INR)",
    "Status",
    "Discount %",
    "Hours",
    "User",
  ]);

  for (const p of payments) {
    rows.push([
      p.createdAt
        ? new Date(p.createdAt).toISOString().slice(0, 19).replace("T", " ")
        : "",
      "Package",
      p.packageName ?? "",
      (p.method ?? "").toUpperCase(),
      Number(p.amount ?? 0),
      p.status ?? (p.approvedAt ? "approved" : "pending"),
      p.discountPercent ?? 0,
      p.hours ?? 0,
      p.isGuest ? "Guest" : "Registered",
    ]);
  }
  for (const t of transfers) {
    rows.push([
      t.createdAt
        ? new Date(t.createdAt).toISOString().slice(0, 19).replace("T", " ")
        : "",
      "Transfer",
      "Wallet Transfer",
      "WALLET",
      Number(t.amount ?? 0),
      t.status ?? "pending",
      0,
      0,
      t.username ?? "",
    ]);
  }

  // Sort by date descending
  rows.slice(1).sort((a, b) => String(b[0]).localeCompare(String(a[0])));

  const csv = rows.map((r) => r.map(csvField).join(",")).join("\r\n");

  // Prepend a metadata comment block (real platform info).
  const appName = settings?.appName ?? "Revo Fixer";
  const version = settings?.appVersion ?? "2.0.0";
  const support = settings?.supportContact ?? "@RevoAgent";
  const usdtRate = settings?.paymentSettings?.usdtRate ?? 94.14;
  const generated = new Date().toISOString().slice(0, 19).replace("T", " ");
  const totalRevenue = payments
    .filter((p) => (p.status ?? (p.approvedAt ? "approved" : "")).toLowerCase() === "approved")
    .reduce((s, p) => s + Number(p.amount ?? 0), 0);

  const meta = [
    `# ${appName} - Transaction History Export`,
    `# Version: ${version}`,
    `# Support: ${support}`,
    `# USDT Rate: ${usdtRate.toFixed(2)} INR/USDT`,
    `# Total Transactions: ${payments.length + transfers.length}`,
    `# Approved Revenue: Rs ${totalRevenue.toLocaleString("en-IN")}`,
    `# Generated (UTC): ${generated}`,
    `# Source: Live Revo Fixer Firebase platform`,
    "",
  ].join("\r\n");

  const full = meta + csv + "\r\n";
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(full, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="revo-fixer-transactions-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
