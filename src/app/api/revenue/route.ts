import { NextResponse } from "next/server";
import { getRevenueSummary } from "@/lib/firebase";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getRevenueSummary();
  return NextResponse.json(data);
}
