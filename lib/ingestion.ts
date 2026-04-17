import { chunkText } from "@/lib/chunking";
import { embedText, extractEntitiesAndRelationships } from "@/lib/gemini";
import { upsertTriplets } from "@/lib/neo4j";
import { insertDocumentChunk } from "@/lib/supabase";
import type { Entity, IngestionResult, IngestRequestPayload } from "@/lib/types";

function normalizeEntityName(entity: Entity) {
  return entity.name.trim().toLowerCase();
}

export async function ingestDocument(input: IngestRequestPayload) {
  const sourceId = input.sourceId.trim();
  const title = input.title?.trim() || null;
  const text = input.text.trim();

  if (!sourceId || !text) {
    throw new Error("Both sourceId and text are required for ingestion.");
  }

  const chunks = chunkText(text);
  const uniqueEntities = new Map<string, Entity>();
  const chunkSummaries: IngestionResult["chunks"] = [];
  let tripletCount = 0;

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const [extraction, embedding] = await Promise.all([
      extractEntitiesAndRelationships(chunk),
      embedText(chunk)
    ]);

    extraction.entities.forEach((entity) => {
      const normalizedName = normalizeEntityName(entity);
      if (!normalizedName) {
        return;
      }

      uniqueEntities.set(normalizedName, entity);
    });

    await upsertTriplets(extraction.triplets);
    await insertDocumentChunk({
      sourceId,
      title,
      content: chunk,
      embedding,
      metadata: input.metadata,
      entities: extraction.entities,
      triplets: extraction.triplets,
      chunkIndex
    });

    tripletCount += extraction.triplets.length;
    chunkSummaries.push({
      chunkIndex,
      entityCount: extraction.entities.length,
      tripletCount: extraction.triplets.length
    });
  }

  return {
    sourceId,
    title,
    chunkCount: chunks.length,
    entityCount: uniqueEntities.size,
    tripletCount,
    entities: Array.from(uniqueEntities.values())
      .map((entity) => entity.name)
      .sort((left, right) => left.localeCompare(right)),
    chunks: chunkSummaries
  } satisfies IngestionResult;
}
