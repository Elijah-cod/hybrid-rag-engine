import { NextRequest, NextResponse } from "next/server";
import { getSourceLibraryDetail } from "@/lib/supabase";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    sourceId: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { sourceId } = await context.params;
    const detail = await getSourceLibraryDetail(decodeURIComponent(sourceId));
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown library detail error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
