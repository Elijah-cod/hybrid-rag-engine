import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import type { VectorMatch } from "@/lib/types";

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
