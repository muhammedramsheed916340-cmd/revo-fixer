import { NextResponse } from "next/server";
import { getPaymentMethods } from "@/lib/firebase";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getPaymentMethods();
  return NextResponse.json(data ?? {});
}
