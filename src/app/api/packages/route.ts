import { NextResponse } from "next/server";
import { getPackages } from "@/lib/firebase";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getPackages();
  return NextResponse.json(data);
}
