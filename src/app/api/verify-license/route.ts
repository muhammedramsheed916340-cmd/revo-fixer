import { NextResponse } from "next/server";
import { verifyLicense } from "@/lib/firebase";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { key?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const result = await verifyLicense(body.key ?? "");
  return NextResponse.json(result);
}
