import { NextResponse } from "next/server";
import { getUser } from "@/lib/firebase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const uid = searchParams.get("uid")?.trim();
  if (!uid) {
    return NextResponse.json({ error: "uid required" }, { status: 400 });
  }
  const data = await getUser(uid);
  return NextResponse.json(data ?? null);
}
