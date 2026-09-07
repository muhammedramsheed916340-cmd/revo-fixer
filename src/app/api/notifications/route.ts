import { NextResponse } from "next/server";
import { getNotifications } from "@/lib/firebase";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getNotifications(24);
  return NextResponse.json(data);
}
