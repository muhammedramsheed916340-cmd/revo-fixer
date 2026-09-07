import { NextResponse } from "next/server";
import { getPackagePayments, getTransferRequests } from "@/lib/firebase";

export const dynamic = "force-dynamic";

export async function GET() {
  // Fetch independently so one failing node never breaks the whole feed.
  const [paymentsR, transfersR] = await Promise.allSettled([
    getPackagePayments(15),
    getTransferRequests(10),
  ]);
  const payments = paymentsR.status === "fulfilled" ? paymentsR.value : [];
  const transfers = transfersR.status === "fulfilled" ? transfersR.value : [];
  return NextResponse.json({ payments, transfers });
}
