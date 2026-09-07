import { NextResponse } from "next/server";
import {
  getAdminKeys,
  getActivationCodes,
  getSecurityCodesOverview,
  getPaymentRequestsOverview,
} from "@/lib/firebase";

export const dynamic = "force-dynamic";

export async function GET() {
  // Fetch all admin data sources in parallel; never let one failure break all.
  const [adminKeysR, codesR, securityR, payReqsR] = await Promise.allSettled([
    getAdminKeys(),
    getActivationCodes(),
    getSecurityCodesOverview(),
    getPaymentRequestsOverview(20),
  ]);

  const adminKeys = adminKeysR.status === "fulfilled" ? adminKeysR.value : [];
  const activationCodes = codesR.status === "fulfilled" ? codesR.value : [];
  const security =
    securityR.status === "fulfilled"
      ? securityR.value
      : { total: 0, byStatus: {}, recent: [] };
  const paymentRequests =
    payReqsR.status === "fulfilled" ? payReqsR.value : [];

  return NextResponse.json({
    adminKeys,
    activationCodes,
    security,
    paymentRequests,
  });
}
