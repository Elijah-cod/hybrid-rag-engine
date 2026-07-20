import { chunkText } from "@/lib/chunking";
import {
  mockEmbedText,
  mockExtractEntitiesAndRelationships,
  mockExtractQuestionEntities,
  mockSynthesizeHybridAnswer
} from "@/lib/mock-ai";
import type {
  ChatApiResponse,
  GraphLink,
  GraphNode,
  GraphPath,
  GraphPayload,
  IngestionResult,
  MockWorkspaceDocument,
  RetrievalMode,
  SourceLibraryDetail,
  SourceLibraryItem,
  Triplet,
  VectorMatch
} from "@/lib/types";

type MockDocumentInput = {
  sourceId: string;
  title?: string | null;
  sourceType?: string | null;
  text: string;
  createdAt?: string;
};

type AdjacencyEdge = {
  node: string;
  relation: string;
};

function uniqueBy<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function cosineSimilarity(left: number[], right: number[]) {
  const maxLength = Math.min(left.length, right.length);
  let dotProduct = 0;

  for (let index = 0; index < maxLength; index += 1) {
    dotProduct += (left[index] ?? 0) * (right[index] ?? 0);
  }

  return Math.max(0, Math.min(1, dotProduct));
}

function summarizeDocument(document: MockWorkspaceDocument) {
  const uniqueEntities = new Set(
    document.chunks.flatMap((chunk) => chunk.entityNames.map((entityName) => normalizeName(entityName)))
  );

  return {
    sourceId: document.sourceId,
    title: document.title,
    chunkCount: document.chunks.length,
    entityCount: uniqueEntities.size,
    tripletCount: document.chunks.reduce((sum, chunk) => sum + chunk.triplets.length, 0),
    entities: Array.from(
      new Set(document.chunks.flatMap((chunk) => chunk.entityNames.map((entityName) => entityName.trim())))
    ).sort((left, right) => left.localeCompare(right)),
    chunks: document.chunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      entityCount: chunk.entities.length,
      tripletCount: chunk.triplets.length
    }))
  } satisfies IngestionResult;
}

function buildAdjacency(triplets: Triplet[]) {
  const adjacency = new Map<string, AdjacencyEdge[]>();

  for (const triplet of triplets) {
    const subject = triplet.subject.trim();
    const object = triplet.object.trim();
    const relation = triplet.relation.trim() || "RELATED_TO";

    if (!subject || !object || subject === object) {
      continue;
    }

    const subjectKey = normalizeName(subject);
    const objectKey = normalizeName(object);

    const subjectEdges = adjacency.get(subjectKey) ?? [];
    subjectEdges.push({ node: object, relation });
    adjacency.set(subjectKey, subjectEdges);

    const objectEdges = adjacency.get(objectKey) ?? [];
    objectEdges.push({ node: subject, relation });
    adjacency.set(objectKey, objectEdges);
  }

  return adjacency;
}

function findShortestPath(triplets: Triplet[], start: string, end: string) {
  const adjacency = buildAdjacency(triplets);
  const startKey = normalizeName(start);
  const endKey = normalizeName(end);

  if (!adjacency.has(startKey) || !adjacency.has(endKey)) {
    return null;
  }

  const queue: Array<{
    node: string;
    nodes: string[];
    relationships: string[];
  }> = [{ node: start, nodes: [start], relationships: [] }];
  const visited = new Set<string>([startKey]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    if (normalizeName(current.node) === endKey) {
      return {
        nodes: current.nodes,
        relationships: current.relationships
      } satisfies GraphPath;
    }

    const edges = adjacency.get(normalizeName(current.node)) ?? [];
    for (const edge of edges) {
      const nextKey = normalizeName(edge.node);
      if (visited.has(nextKey) || current.nodes.length >= 5) {
        continue;
      }

      visited.add(nextKey);
      queue.push({
        node: edge.node,
        nodes: [...current.nodes, edge.node],
        relationships: [...current.relationships, edge.relation]
      });
    }
  }

  return null;
}

function buildMockGraph(documents: MockWorkspaceDocument[], entityNames: string[]) {
  if (entityNames.length === 0) {
    return {
      nodes: [],
      links: [],
      paths: [],
      relatedEntities: []
    } satisfies GraphPayload;
  }

  const loweredNames = new Set(entityNames.map((entityName) => normalizeName(entityName)));
  const triplets = documents.flatMap((document) =>
    document.chunks.flatMap((chunk) => chunk.triplets)
  );

  const neighborLinks: GraphLink[] = triplets
    .filter(
      (triplet) =>
        loweredNames.has(normalizeName(triplet.subject)) ||
        loweredNames.has(normalizeName(triplet.object))
    )
    .map((triplet) => ({
      source: triplet.subject,
      target: triplet.object,
      relation: triplet.relation || "RELATED_TO"
    }));

  const graphLinks: GraphLink[] =
    neighborLinks.length > 0
      ? neighborLinks
      : triplets.slice(0, 12).map((triplet) => ({
          source: triplet.subject,
          target: triplet.object,
          relation: triplet.relation || "RELATED_TO"
        }));

  const distinctEntities = Array.from(new Set(entityNames.map((entityName) => entityName.trim()).filter(Boolean)));
  const pathRecords: GraphPath[] = [];

  if (distinctEntities.length >= 2) {
    for (let startIndex = 0; startIndex < distinctEntities.length - 1 && pathRecords.length === 0; startIndex += 1) {
      for (let endIndex = startIndex + 1; endIndex < distinctEntities.length; endIndex += 1) {
        const path = findShortestPath(
          triplets,
          distinctEntities[startIndex],
          distinctEntities[endIndex]
        );
        if (path) {
          pathRecords.push(path);
          break;
        }
      }
    }
  }

  const highlightedPathLinks = pathRecords.flatMap((path) =>
    path.relationships.map((relation, index) => ({
      source: path.nodes[index],
      target: path.nodes[index + 1],
      relation,
      highlighted: true
    }))
  );

  const nodes = uniqueBy(
    [
      ...distinctEntities.map(
        (entityName) =>
          ({
            id: entityName,
            label: entityName,
            group: "query",
            highlighted: true
          }) satisfies GraphNode
      ),
      ...[...graphLinks, ...highlightedPathLinks].flatMap((link) => [
        {
          id: link.source,
          label: link.source,
          group: loweredNames.has(normalizeName(link.source)) ? "query" : "neighbor",
          highlighted: loweredNames.has(normalizeName(link.source))
        },
        {
          id: link.target,
          label: link.target,
          group: loweredNames.has(normalizeName(link.target)) ? "query" : "neighbor",
          highlighted: loweredNames.has(normalizeName(link.target))
        }
      ])
    ],
    (node) => node.id
  );

  return {
    nodes,
    links: uniqueBy(
      [...graphLinks, ...highlightedPathLinks],
      (link) => `${link.source}|${link.relation}|${link.target}|${link.highlighted ? "1" : "0"}`
    ),
    paths: pathRecords,
    relatedEntities: distinctEntities
  } satisfies GraphPayload;
}

export function buildMockWorkspaceDocument(input: MockDocumentInput) {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const chunks = chunkText(input.text.trim());

  const document = {
    sourceId: input.sourceId.trim(),
    title: input.title?.trim() || null,
    sourceType: input.sourceType?.trim() || null,
    text: input.text.trim(),
    createdAt,
    chunks: chunks.map((chunk, chunkIndex) => {
      const extraction = mockExtractEntitiesAndRelationships(chunk);

      return {
        id: `${input.sourceId.trim()}-chunk-${chunkIndex}-${createdAt}`,
        chunkIndex,
        content: chunk,
        createdAt,
        entityNames: extraction.entities.map((entity) => entity.name).slice(0, 16),
        entities: extraction.entities,
        triplets: extraction.triplets,
        embedding: mockEmbedText(chunk)
      };
    })
  } satisfies MockWorkspaceDocument;

  return {
    document,
    result: summarizeDocument(document)
  };
}

export function upsertMockWorkspaceDocument(
  documents: MockWorkspaceDocument[],
  input: MockDocumentInput
) {
  const { document, result } = buildMockWorkspaceDocument(input);
  const nextDocuments = [
    document,
    ...documents.filter((existingDocument) => existingDocument.sourceId !== document.sourceId)
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    documents: nextDocuments,
    result
  };
}

export function listMockSourceLibrary(documents: MockWorkspaceDocument[]) {
  return documents.map((document) => ({
    sourceId: document.sourceId,
    title: document.title,
    sourceType: document.sourceType,
    chunkCount: document.chunks.length,
    latestIngestedAt: document.createdAt
  })) satisfies SourceLibraryItem[];
}

export function getMockSourceLibraryDetail(
  documents: MockWorkspaceDocument[],
  sourceId: string
) {
  const document = documents.find((candidate) => candidate.sourceId === sourceId);
  if (!document) {
    return null;
  }

  return {
    source: {
      sourceId: document.sourceId,
      title: document.title,
      sourceType: document.sourceType,
      chunkCount: document.chunks.length,
      latestIngestedAt: document.createdAt
    },
    chunks: document.chunks
  } satisfies SourceLibraryDetail;
}

export function queryMockWorkspace(
  documents: MockWorkspaceDocument[],
  input: {
    question: string;
    retrievalMode: RetrievalMode;
    sourceId?: string | null;
  }
) {
  const relevantDocuments = input.sourceId
    ? documents.filter((document) => document.sourceId === input.sourceId)
    : documents;

  const question = input.question.trim();
  const embedding = mockEmbedText(question);
  const rawEntityNames = mockExtractQuestionEntities(question);
  const normalizedQuestion = normalizeName(question);
  const documentEntityNames = Array.from(
    new Set(relevantDocuments.flatMap((document) => document.chunks.flatMap((chunk) => chunk.entityNames)))
  );
  const titleMatchedEntities = relevantDocuments.flatMap((document) =>
    document.title && normalizedQuestion.includes(normalizeName(document.title))
      ? document.chunks.flatMap((chunk) => chunk.entityNames).slice(0, 8)
      : []
  );
  const resolvedDocumentEntities = documentEntityNames.filter((entityName) => {
    const normalizedEntity = normalizeName(entityName);
    if (normalizedQuestion.includes(normalizedEntity)) {
      return true;
    }

    const entityTokens = normalizedEntity.split(/\s+/).filter((token) => token.length >= 3);
    return rawEntityNames.some((rawEntity) => {
      const rawTokens = normalizeName(rawEntity).split(/\s+/).filter((token) => token.length >= 3);
      return entityTokens.some((token) => rawTokens.includes(token));
    });
  });
  const entityNames = Array.from(
    new Set([...resolvedDocumentEntities, ...titleMatchedEntities, ...rawEntityNames])
  ).slice(0, 12);

  const vectorMatches =
    input.retrievalMode === "graph"
      ? []
      : relevantDocuments
          .flatMap((document) =>
            document.chunks.map((chunk) => ({
              id: chunk.id,
              source_id: document.sourceId,
              title: document.title,
              content: chunk.content,
              metadata: {
                sourceType: document.sourceType,
                chunkIndex: chunk.chunkIndex,
                entities: chunk.entities,
                triplets: chunk.triplets
              },
              similarity: cosineSimilarity(embedding, chunk.embedding)
            }))
          )
          .sort((left, right) => right.similarity - left.similarity)
          .slice(0, 6) satisfies VectorMatch[];

  const graph =
    input.retrievalMode === "vector"
      ? ({
          nodes: [],
          links: [],
          paths: [],
          relatedEntities: []
        } satisfies GraphPayload)
      : buildMockGraph(relevantDocuments, entityNames);

  return {
    answer: mockSynthesizeHybridAnswer({
      question,
      vectorMatches,
      graph,
      sourceScope: input.sourceId,
      retrievalMode: input.retrievalMode
    }),
    graph,
    retrievalMode: input.retrievalMode,
    sources: vectorMatches.map((match) => ({
      id: match.id,
      sourceId: match.source_id,
      title: match.title,
      content: match.content,
      similarity: match.similarity
    }))
  } satisfies ChatApiResponse;
}
