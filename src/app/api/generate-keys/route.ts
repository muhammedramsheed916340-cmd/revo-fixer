import { NextResponse } from "next/server";
import {
  generateLicenseKey,
  generateActivationCode,
  generateAdminKey,
} from "@/lib/firebase";

export const dynamic = "force-dynamic";

interface GenerateBody {
  kind: "license" | "signal" | "admin";
  hours?: number;
  name?: string;
  finalPrice?: number;
  originalPrice?: number;
  usedFor?: string;
  label?: string;
  maxLogins?: number;
}

export async function POST(req: Request) {
  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  try {
    if (body.kind === "license") {
      const hours = Number(body.hours ?? 0);
      const finalPrice = Number(body.finalPrice ?? 0);
      if (!hours || hours <= 0) {
        return NextResponse.json(
          { ok: false, error: "hours must be a positive number" },
          { status: 400 },
        );
      }
      const { key } = await generateLicenseKey({
        hours,
        name: body.name?.trim() || `${hours}h`,
        finalPrice,
        originalPrice: body.originalPrice
          ? Number(body.originalPrice)
          : undefined,
      });
      return NextResponse.json({ ok: true, kind: "license", key });
    }

    if (body.kind === "signal") {
      const { code } = await generateActivationCode({
        usedFor: body.usedFor?.trim() || undefined,
      });
      return NextResponse.json({ ok: true, kind: "signal", code });
    }

    if (body.kind === "admin") {
      const { key } = await generateAdminKey({
        label: body.label?.trim() || undefined,
        maxLogins: body.maxLogins ? Number(body.maxLogins) : undefined,
      });
      return NextResponse.json({ ok: true, kind: "admin", key });
    }

    return NextResponse.json(
      { ok: false, error: `Unknown kind: ${String(body.kind)}` },
      { status: 400 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  }
}
