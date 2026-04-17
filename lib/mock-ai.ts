import type {
  Entity,
  ExtractionResult,
  GraphPayload,
  RetrievalMode,
  VectorMatch
} from "@/lib/types";

const EMBEDDING_DIMENSIONS = 768;

const RELATION_PATTERNS: Array<{ pattern: RegExp; relation: string }> = [
  { pattern: /\bdepends on\b/i, relation: "DEPENDS_ON" },
  { pattern: /\bpartners with\b/i, relation: "PARTNERS_WITH" },
  { pattern: /\bsponsored by\b/i, relation: "SPONSORED_BY" },
  { pattern: /\bowned by\b/i, relation: "OWNED_BY" },
  { pattern: /\bsupports\b/i, relation: "SUPPORTS" },
  { pattern: /\buses\b/i, relation: "USES" },
  { pattern: /\breviews\b/i, relation: "REVIEWS" },
  { pattern: /\bresponsible for\b/i, relation: "RESPONSIBLE_FOR" }
];

function hashToken(token: string, seed = 0) {
  let hash = 2166136261 + seed;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}

function classifyEntity(name: string): string {
  if (/\b(office|group|team|org|squad|unit)\b/i.test(name)) {
    return "Organization";
  }
  if (/\b(project|program|initiative|roadmap|goals?)\b/i.test(name)) {
    return "Initiative";
  }
  if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name)) {
    return "Person";
  }
  return "Concept";
}

function extractEntityCandidates(text: string) {
  const matches = text.match(
    /\b(?:[A-Z][a-z]+|[A-Z]{2,}|\d{4})(?:\s+(?:[A-Z][a-z]+|[A-Z]{2,}|\d{4}|AI|CEO|CTO|VP|Office|Group|Team|Goals?)){0,4}\b/g
  );

  const cleaned = (matches ?? [])
    .map((match) => match.trim().replace(/\s+/g, " "))
    .filter((match) => match.length > 2)
    .filter((match) => !/^(The|This|That|These|Those)$/.test(match));

  return Array.from(new Set(cleaned)).slice(0, 30);
}

function extractEntities(text: string) {
  return extractEntityCandidates(text).map((name) => ({
    name,
    type: classifyEntity(name)
  })) satisfies Entity[];
}

export function mockEmbedText(text: string) {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);

  for (const token of tokenize(text)) {
    const primary = hashToken(token) % EMBEDDING_DIMENSIONS;
    const secondary = hashToken(token, 31) % EMBEDDING_DIMENSIONS;
    vector[primary] += 1;
    vector[secondary] += 0.5;
  }

  return normalizeVector(vector);
}

export function mockExtractEntitiesAndRelationships(text: string) {
  const entities = extractEntities(text);
  const entityNames = entities.map((entity) => entity.name);
  const sentenceCandidates = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const triplets = new Map<string, { subject: string; relation: string; object: string }>();

  for (const sentence of sentenceCandidates) {
    const sentenceEntities = entityNames.filter((entityName) => sentence.includes(entityName));
    if (sentenceEntities.length < 2) {
      continue;
    }

    const relation =
      RELATION_PATTERNS.find(({ pattern }) => pattern.test(sentence))?.relation || "RELATED_TO";

    for (let index = 0; index < sentenceEntities.length - 1; index += 1) {
      const subject = sentenceEntities[index];
      const object = sentenceEntities[index + 1];
      const key = `${subject}|${relation}|${object}`;
      if (!triplets.has(key) && subject !== object) {
        triplets.set(key, { subject, relation, object });
      }
    }
  }

  return {
    entities,
    triplets: Array.from(triplets.values())
  } satisfies ExtractionResult;
}

export function mockExtractQuestionEntities(question: string) {
  return mockExtractEntitiesAndRelationships(question).entities.map((entity) => entity.name);
}

export function mockSynthesizeHybridAnswer(input: {
  question: string;
  vectorMatches: VectorMatch[];
  graph: GraphPayload;
  sourceScope?: string | null;
  retrievalMode?: RetrievalMode;
}) {
  const vectorSummary = input.vectorMatches
    .slice(0, 2)
    .map((match) => `${match.title || match.source_id} (${(match.similarity * 100).toFixed(1)}% match)`)
    .join(", ");

  const pathSummary =
    input.graph.paths[0]?.nodes.join(" -> ") ||
    (input.graph.nodes.length > 0
      ? `${input.graph.nodes.length} graph node(s) and ${input.graph.links.length} relationship(s) retrieved`
      : "no graph path was found");

  return [
    "### Direct answer",
    input.vectorMatches.length > 0
      ? `The strongest supporting context for "${input.question}" comes from ${vectorSummary}.`
      : `No strong semantic matches were retrieved for "${input.question}", so the answer relies on graph structure or mock reasoning only.`,
    "",
    "### Why the graph matters",
    input.retrievalMode === "vector"
      ? "Graph traversal was skipped in vector mode, so this answer is based on semantic chunk similarity only."
      : `The graph view suggests ${pathSummary}.`,
    "",
    "### Evidence used",
    input.sourceScope
      ? `Source scope: ${input.sourceScope}.`
      : "Source scope: all ingested sources.",
    `Retrieval mode: ${input.retrievalMode || "hybrid"}.`,
    `Semantic matches returned: ${input.vectorMatches.length}.`,
    `Graph nodes returned: ${input.graph.nodes.length}.`
  ].join("\n");
}
