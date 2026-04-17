export type ChatRole = "user" | "assistant";

export type RetrievedSource = {
  id: string;
  sourceId: string;
  title: string | null;
  content: string;
  similarity: number;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  sources?: RetrievedSource[];
};

export type Entity = {
  name: string;
  type?: string;
};

export type Triplet = {
  subject: string;
  relation: string;
  object: string;
};

export type ExtractionResult = {
  entities: Entity[];
  triplets: Triplet[];
};

export type GraphNode = {
  id: string;
  label: string;
  type?: string;
  group?: string;
  highlighted?: boolean;
};

export type GraphLink = {
  source: string;
  target: string;
  relation: string;
  highlighted?: boolean;
};

export type GraphPath = {
  nodes: string[];
  relationships: string[];
};

export type GraphPayload = {
  nodes: GraphNode[];
  links: GraphLink[];
  paths: GraphPath[];
  relatedEntities: string[];
};

export type VectorMatch = {
  id: string;
  source_id: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
};

export type ChatApiResponse = {
  answer: string;
  graph: GraphPayload;
  sources: RetrievedSource[];
};

export type IngestRequestPayload = {
  sourceId: string;
  title?: string;
  text: string;
  metadata?: Record<string, unknown>;
};

export type IngestionChunkSummary = {
  chunkIndex: number;
  entityCount: number;
  tripletCount: number;
};

export type IngestionResult = {
  sourceId: string;
  title: string | null;
  chunkCount: number;
  entityCount: number;
  tripletCount: number;
  entities: string[];
  chunks: IngestionChunkSummary[];
};
