import { NextRequest, NextResponse } from "next/server";
import { embedText, extractQuestionEntities, synthesizeHybridAnswer } from "@/lib/gemini";
import { fetchGraphContext } from "@/lib/neo4j";
import { matchDocuments } from "@/lib/supabase";
import type { ChatApiResponse } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { question?: string; sourceId?: string | null };
    const question = body.question?.trim();
    const sourceId = body.sourceId?.trim() || null;

    if (!question) {
      return NextResponse.json({ error: "A question is required." }, { status: 400 });
    }

    const [embedding, entityNames] = await Promise.all([
      embedText(question),
      extractQuestionEntities(question)
    ]);

    const [vectorMatches, graph] = await Promise.all([
      matchDocuments(embedding, {
        limit: 6,
        sourceId: sourceId || undefined
      }),
      fetchGraphContext(entityNames)
    ]);

    const answer = await synthesizeHybridAnswer({
      question,
      vectorMatches,
      graph,
      sourceScope: sourceId
    });

    const payload: ChatApiResponse = {
      answer,
      graph,
      sources: vectorMatches.map((match) => ({
        id: match.id,
        sourceId: match.source_id,
        title: match.title,
        content: match.content,
        similarity: match.similarity
      }))
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
