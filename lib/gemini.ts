import type { ExtractionResult, GraphPayload, VectorMatch } from "@/lib/types";
import { getServerEnv } from "@/lib/env";

type GeminiCandidateResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  embedding?: {
    values?: number[];
  };
};

function buildEndpoint(model: string, action: "generateContent" | "embedContent") {
  const env = getServerEnv();
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${env.GOOGLE_AI_API_KEY}`;
}

function stripCodeFences(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseJsonPayload<T>(raw: string): T {
  const cleaned = stripCodeFences(raw);
  return JSON.parse(cleaned) as T;
}

async function postGemini<T>(model: string, action: "generateContent" | "embedContent", body: Record<string, unknown>) {
  const response = await fetch(buildEndpoint(model, action), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini request failed with ${response.status}: ${errorText}`);
  }

  return (await response.json()) as T;
}

function makeUserTextContent(text: string) {
  return [
    {
      role: "user",
      parts: [{ text }]
    }
  ];
}

export async function extractEntitiesAndRelationships(text: string) {
  const env = getServerEnv();
  const prompt = [
    "Extract all entities and their relationships from the following text.",
    "Return valid JSON only.",
    'Use this shape: {"entities":[{"name":"","type":""}],"triplets":[{"subject":"","relation":"","object":""}]}',
    "Keep relationship names concise and normalized.",
    "",
    text
  ].join("\n");

  const response = await postGemini<GeminiCandidateResponse>(env.GOOGLE_TEXT_MODEL, "generateContent", {
    contents: makeUserTextContent(prompt),
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json"
    }
  });

  const rawText = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    return { entities: [], triplets: [] } satisfies ExtractionResult;
  }

  const parsed = parseJsonPayload<ExtractionResult>(rawText);
  return {
    entities: parsed.entities ?? [],
    triplets: parsed.triplets ?? []
  } satisfies ExtractionResult;
}

export async function embedText(text: string) {
  const env = getServerEnv();
  const response = await postGemini<GeminiCandidateResponse>(env.GOOGLE_EMBEDDING_MODEL, "embedContent", {
    content: {
      parts: [{ text }]
    }
  });

  const values = response.embedding?.values;
  if (!values?.length) {
    throw new Error("Gemini embedding response did not include values.");
  }

  return values;
}

export async function extractQuestionEntities(question: string) {
  const env = getServerEnv();
  const prompt = [
    "Identify the key entities or named concepts in this user question.",
    "Return valid JSON only.",
    'Use this shape: {"entities":["entity one","entity two"]}',
    "Prefer literal names that can be looked up in a knowledge graph.",
    "",
    question
  ].join("\n");

  const response = await postGemini<GeminiCandidateResponse>(env.GOOGLE_TEXT_MODEL, "generateContent", {
    contents: makeUserTextContent(prompt),
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json"
    }
  });

  const rawText = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    return [];
  }

  const parsed = parseJsonPayload<{ entities?: string[] }>(rawText);
  return (parsed.entities ?? []).filter(Boolean);
}

export async function synthesizeHybridAnswer(input: {
  question: string;
  vectorMatches: VectorMatch[];
  graph: GraphPayload;
  sourceScope?: string | null;
}) {
  const env = getServerEnv();
  const evidenceSummary = input.vectorMatches.map((match, index) => ({
    source: index + 1,
    sourceId: match.source_id,
    title: match.title,
    similarity: match.similarity,
    content: match.content
  }));

  const prompt = [
    "You are answering a hybrid retrieval question using both semantic context and graph relationships.",
    "Use the supplied evidence only. If the evidence is incomplete, say what is missing.",
    "Structure the answer in three short sections:",
    "1. Direct answer",
    "2. Why the graph matters",
    "3. Evidence used",
    "",
    `Question: ${input.question}`,
    input.sourceScope ? `Scoped source: ${input.sourceScope}` : "",
    "",
    `Vector evidence: ${JSON.stringify(evidenceSummary)}`,
    "",
    `Graph evidence: ${JSON.stringify(input.graph)}`
  ].join("\n");

  const response = await postGemini<GeminiCandidateResponse>(env.GOOGLE_TEXT_MODEL, "generateContent", {
    contents: makeUserTextContent(prompt),
    generationConfig: {
      temperature: 0.3
    }
  });

  return (
    response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
    "I found relevant vector and graph evidence, but Gemini did not return a synthesis."
  );
}
