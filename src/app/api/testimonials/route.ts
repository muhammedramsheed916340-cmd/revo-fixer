import { NextResponse } from "next/server";
import { getTestimonials } from "@/lib/firebase";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getTestimonials(8);
  return NextResponse.json(data);
}
