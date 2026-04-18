import { NextResponse } from "next/server";
import { listSourceLibrary } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  try {
    const sources = await listSourceLibrary();
    return NextResponse.json({ sources });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown library error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
