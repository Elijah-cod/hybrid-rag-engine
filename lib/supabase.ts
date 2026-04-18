import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import type {
  DocumentMatchOptions,
  Entity,
  SourceChunkPreview,
  SourceLibraryDetail,
  SourceLibraryItem,
  Triplet,
  VectorMatch
} from "@/lib/types";

let cachedClient: ReturnType<typeof createClient> | null = null;

function getServiceClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const env = getServerEnv();
  cachedClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return cachedClient;
}

export function toPgVector(values: number[]) {
  return `[${values.join(",")}]`;
}

export async function matchDocuments(embedding: number[], options: DocumentMatchOptions = {}) {
  const supabase = getServiceClient();
  const filter: Record<string, string> = {};

  if (options.sourceId) {
    filter.sourceId = options.sourceId;
  }

  if (options.sourceType) {
    filter.sourceType = options.sourceType;
  }

  const { data, error } = await (supabase as never as {
    rpc: (
      fn: string,
      args: {
        query_embedding: string;
        match_count: number;
        filter: Record<string, string>;
      }
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc("match_documents", {
    query_embedding: toPgVector(embedding),
    match_count: options.limit ?? 6,
    filter
  });

  if (error) {
    throw new Error(`Supabase vector search failed: ${error.message}`);
  }

  return (data ?? []) as VectorMatch[];
}

export async function insertDocumentChunk(input: {
  sourceId: string;
  title?: string | null;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
  entities?: Entity[];
  triplets?: Triplet[];
  chunkIndex: number;
}) {
  const supabase = getServiceClient();
  const { error } = await (
    supabase.from("documents") as never as {
      insert: (value: {
        source_id: string;
        title: string | null;
        content: string;
        metadata: Record<string, unknown>;
        embedding: string;
      }) => Promise<{ error: { message: string } | null }>;
    }
  ).insert({
    source_id: input.sourceId,
    title: input.title ?? null,
    content: input.content,
    metadata: {
      ...(input.metadata ?? {}),
      chunkIndex: input.chunkIndex,
      entities: input.entities ?? [],
      triplets: input.triplets ?? []
    },
    embedding: toPgVector(input.embedding)
  });

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }
}

type RawLibraryRow = {
  source_id: string;
  title: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function listSourceLibrary(limit = 24) {
  const supabase = getServiceClient();
  const { data, error } = await (
    supabase
      .from("documents")
      .select("source_id, title, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(limit * 8) as never as Promise<{
      data: RawLibraryRow[] | null;
      error: { message: string } | null;
    }>
  );

  if (error) {
    throw new Error(`Supabase library query failed: ${error.message}`);
  }

  const grouped = new Map<string, SourceLibraryItem>();

  for (const row of data ?? []) {
    const existing = grouped.get(row.source_id);
    if (existing) {
      existing.chunkCount += 1;
      continue;
    }

    const sourceType =
      row.metadata && typeof row.metadata.sourceType === "string" ? row.metadata.sourceType : null;

    grouped.set(row.source_id, {
      sourceId: row.source_id,
      title: row.title,
      sourceType,
      chunkCount: 1,
      latestIngestedAt: row.created_at
    });
  }

  return Array.from(grouped.values()).slice(0, limit);
}

type RawDetailRow = {
  id: string;
  source_id: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function getSourceLibraryDetail(sourceId: string) {
  const trimmedSourceId = sourceId.trim();
  if (!trimmedSourceId) {
    throw new Error("A sourceId is required to load document details.");
  }

  const supabase = getServiceClient();
  const { data, error } = await (
    supabase
      .from("documents")
      .select("id, source_id, title, content, metadata, created_at")
      .eq("source_id", trimmedSourceId)
      .order("created_at", { ascending: false })
      .limit(12) as never as Promise<{
      data: RawDetailRow[] | null;
      error: { message: string } | null;
    }>
  );

  if (error) {
    throw new Error(`Supabase detail query failed: ${error.message}`);
  }

  const firstRow = data?.[0];
  if (!firstRow) {
    throw new Error(`No ingested chunks were found for sourceId "${trimmedSourceId}".`);
  }

  const sourceType =
    firstRow.metadata && typeof firstRow.metadata.sourceType === "string"
      ? firstRow.metadata.sourceType
      : null;

  const chunks: SourceChunkPreview[] = (data ?? []).map((row) => {
    const chunkIndex =
      row.metadata && typeof row.metadata.chunkIndex === "number" ? row.metadata.chunkIndex : 0;
    const entities =
      row.metadata && Array.isArray(row.metadata.entities) ? row.metadata.entities : [];
    const entityNames = entities
      .map((entity) =>
        entity && typeof entity === "object" && "name" in entity && typeof entity.name === "string"
          ? entity.name
          : null
      )
      .filter((entityName): entityName is string => Boolean(entityName));

    return {
      id: row.id,
      chunkIndex,
      content: row.content,
      createdAt: row.created_at,
      entityNames: entityNames.slice(0, 12)
    };
  });

  return {
    source: {
      sourceId: firstRow.source_id,
      title: firstRow.title,
      sourceType,
      chunkCount: chunks.length,
      latestIngestedAt: firstRow.created_at
    },
    chunks
  } satisfies SourceLibraryDetail;
}

export async function verifySupabaseConnection() {
  const supabase = getServiceClient();
  const { data, error } = await (
    supabase
      .from("documents")
      .select("id")
      .limit(1) as never as Promise<{
      data: Array<{ id: string }> | null;
      error: { message: string } | null;
    }>
  );

  if (error) {
    throw new Error(`Supabase readiness query failed: ${error.message}`);
  }

  return data?.length ?? 0;
}
