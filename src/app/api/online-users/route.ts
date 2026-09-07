import { NextResponse } from "next/server";
import { getOnlineUsers } from "@/lib/firebase";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getOnlineUsers();
  return NextResponse.json(data);
}
