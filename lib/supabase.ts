import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import type { Entity, Triplet, VectorMatch } from "@/lib/types";

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

export async function matchDocuments(embedding: number[], limit = 6) {
  const supabase = getServiceClient();
  const { data, error } = await (supabase as never as {
    rpc: (
      fn: string,
      args: {
        query_embedding: string;
        match_count: number;
        filter: Record<string, never>;
      }
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc("match_documents", {
    query_embedding: toPgVector(embedding),
    match_count: limit,
    filter: {}
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
