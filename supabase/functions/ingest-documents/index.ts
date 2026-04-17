import { createClient } from "npm:@supabase/supabase-js@2";
import neo4j from "npm:neo4j-driver@5";

type Entity = {
  name: string;
  type?: string;
};

type Triplet = {
  subject: string;
  relation: string;
  object: string;
};

type ExtractionResult = {
  entities: Entity[];
  triplets: Triplet[];
};

type IngestRequest = {
  sourceId: string;
  title?: string;
  text: string;
  metadata?: Record<string, unknown>;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY") || "";
const GOOGLE_TEXT_MODEL = Deno.env.get("GOOGLE_TEXT_MODEL") || "gemini-2.0-flash";
const GOOGLE_EMBEDDING_MODEL = Deno.env.get("GOOGLE_EMBEDDING_MODEL") || "text-embedding-004";
const NEO4J_URI = Deno.env.get("NEO4J_URI") || "";
const NEO4J_USERNAME = Deno.env.get("NEO4J_USERNAME") || "";
const NEO4J_PASSWORD = Deno.env.get("NEO4J_PASSWORD") || "";
const NEO4J_DATABASE = Deno.env.get("NEO4J_DATABASE") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));

function chunkText(text: string, chunkSize = 1_500, overlap = 220) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= chunkSize) {
    return [normalized];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const upperBound = Math.min(cursor + chunkSize, normalized.length);
    let end = upperBound;

    if (upperBound < normalized.length) {
      const lastSentence = normalized.lastIndexOf(". ", upperBound);
      const lastBreak = normalized.lastIndexOf(" ", upperBound);
      end = Math.max(lastSentence > cursor ? lastSentence + 1 : cursor, lastBreak > cursor ? lastBreak : cursor);
      if (end <= cursor) {
        end = upperBound;
      }
    }

    chunks.push(normalized.slice(cursor, end).trim());
    if (end >= normalized.length) {
      break;
    }

    cursor = Math.max(0, end - overlap);
  }

  return chunks.filter(Boolean);
}

function stripCodeFences(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function toPgVector(values: number[]) {
  return `[${values.join(",")}]`;
}

async function callGemini(model: string, action: "generateContent" | "embedContent", body: Record<string, unknown>) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${GOOGLE_AI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini ${action} failed: ${response.status} ${await response.text()}`);
  }

  return await response.json();
}

async function extractEntitiesAndRelationships(text: string) {
  const prompt = [
    "Extract all entities and their relationships from the following text.",
    "Return valid JSON only.",
    'Use this shape: {"entities":[{"name":"","type":""}],"triplets":[{"subject":"","relation":"","object":""}]}',
    "",
    text
  ].join("\n");

  const response = await callGemini(GOOGLE_TEXT_MODEL, "generateContent", {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json"
    }
  });

  const rawText = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    return { entities: [], triplets: [] } satisfies ExtractionResult;
  }

  const parsed = JSON.parse(stripCodeFences(rawText)) as ExtractionResult;
  return {
    entities: parsed.entities ?? [],
    triplets: parsed.triplets ?? []
  } satisfies ExtractionResult;
}

async function embedText(text: string) {
  const response = await callGemini(GOOGLE_EMBEDDING_MODEL, "embedContent", {
    content: {
      parts: [{ text }]
    }
  });

  const values = response.embedding?.values;
  if (!values?.length) {
    throw new Error("No embedding values were returned by Gemini.");
  }

  return values as number[];
}

async function upsertTriplets(triplets: Triplet[]) {
  if (triplets.length === 0) {
    return;
  }

  const session = driver.session({ database: NEO4J_DATABASE });
  try {
    await session.executeWrite((tx) =>
      tx.run(
        `
          UNWIND $triplets AS triplet
          MERGE (a:Entity {name: triplet.subject})
          MERGE (b:Entity {name: triplet.object})
          MERGE (a)-[r:RELATED {type: triplet.relation}]->(b)
        `,
        { triplets }
      )
    );
  } finally {
    await session.close();
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST." }), {
      headers: { "Content-Type": "application/json" },
      status: 405
    });
  }

  try {
    const body = (await request.json()) as IngestRequest;
    if (!body.text?.trim() || !body.sourceId?.trim()) {
      return new Response(JSON.stringify({ error: "sourceId and text are required." }), {
        headers: { "Content-Type": "application/json" },
        status: 400
      });
    }

    const chunks = chunkText(body.text);
    let totalTriplets = 0;

    for (const [index, chunk] of chunks.entries()) {
      const [extraction, embedding] = await Promise.all([
        extractEntitiesAndRelationships(chunk),
        embedText(chunk)
      ]);

      await upsertTriplets(extraction.triplets);
      totalTriplets += extraction.triplets.length;

      const { error } = await supabase.from("documents").insert({
        source_id: body.sourceId,
        title: body.title || null,
        content: chunk,
        metadata: {
          ...body.metadata,
          chunkIndex: index,
          entities: extraction.entities,
          triplets: extraction.triplets
        },
        embedding: toPgVector(embedding)
      });

      if (error) {
        throw new Error(`Supabase insert failed: ${error.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        ingestedChunks: chunks.length,
        graphTriplets: totalTriplets,
        sourceId: body.sourceId
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ingestion error.";
    return new Response(JSON.stringify({ error: message }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    });
  }
});
