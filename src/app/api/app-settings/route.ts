import { NextResponse } from "next/server";
import { getAppSettings } from "@/lib/firebase";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getAppSettings();
  return NextResponse.json(data ?? {});
}
