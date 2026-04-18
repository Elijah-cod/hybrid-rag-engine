import { NextRequest, NextResponse } from "next/server";
import { ingestDocument } from "@/lib/ingestion";
import type { IngestRequestPayload } from "@/lib/types";
import { toUserFacingErrorMessage } from "@/lib/user-facing-errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as IngestRequestPayload & { useMockAi?: boolean };
    const result = await ingestDocument(payload, { useMockAi: payload.useMockAi });
    return NextResponse.json(result);
  } catch (error) {
    const message = toUserFacingErrorMessage(error, "ingestion");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
