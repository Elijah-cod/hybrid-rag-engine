import { NextRequest, NextResponse } from "next/server";
import { embedText, extractQuestionEntities, synthesizeHybridAnswer } from "@/lib/gemini";
import { mockEmbedText, mockExtractQuestionEntities, mockSynthesizeHybridAnswer } from "@/lib/mock-ai";
import { fetchGraphContext } from "@/lib/neo4j";
import { matchDocuments } from "@/lib/supabase";
import type { ChatApiResponse, GraphPayload, RetrievalMode } from "@/lib/types";
import { toUserFacingErrorMessage } from "@/lib/user-facing-errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      question?: string;
      sourceId?: string | null;
      retrievalMode?: RetrievalMode;
      useMockAi?: boolean;
    };
    const question = body.question?.trim();
    const sourceId = body.sourceId?.trim() || null;
    const retrievalMode = body.retrievalMode || "hybrid";
    const useMockAi = body.useMockAi ?? false;

    if (!question) {
      return NextResponse.json({ error: "A question is required." }, { status: 400 });
    }

    const [embedding, entityNames] = await Promise.all([
      useMockAi ? Promise.resolve(mockEmbedText(question)) : embedText(question),
      useMockAi ? Promise.resolve(mockExtractQuestionEntities(question)) : extractQuestionEntities(question)
    ]);

    const vectorPromise =
      retrievalMode === "graph"
        ? Promise.resolve([])
        : matchDocuments(embedding, {
            limit: 6,
            sourceId: sourceId || undefined
          });

    const graphPromise: Promise<GraphPayload> =
      retrievalMode === "vector"
        ? Promise.resolve({
            nodes: [],
            links: [],
            paths: [],
            relatedEntities: []
          })
        : fetchGraphContext(entityNames);

    const [vectorMatches, graph] = await Promise.all([vectorPromise, graphPromise]);

    const answer = useMockAi
      ? mockSynthesizeHybridAnswer({
          question,
          vectorMatches,
          graph,
          sourceScope: sourceId,
          retrievalMode
        })
      : await synthesizeHybridAnswer({
          question,
          vectorMatches,
          graph,
          sourceScope: sourceId,
          retrievalMode
        });

    const payload: ChatApiResponse = {
      answer,
      graph,
      retrievalMode,
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
    const message = toUserFacingErrorMessage(error, "chat");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
