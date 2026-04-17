import { NextRequest, NextResponse } from "next/server";
import { ingestDocument } from "@/lib/ingestion";
import type { IngestRequestPayload } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as IngestRequestPayload;
    const result = await ingestDocument(payload);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingestion error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
