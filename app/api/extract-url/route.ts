import { NextResponse } from "next/server";
import { extractArticleFromUrl } from "@/lib/article-extraction";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    const result = await extractArticleFromUrl(body.url?.trim() || "");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown article extraction error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
