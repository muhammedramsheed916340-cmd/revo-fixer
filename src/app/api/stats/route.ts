import { NextResponse } from "next/server";
import { getStats } from "@/lib/firebase";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getStats();
  return NextResponse.json(data);
}
