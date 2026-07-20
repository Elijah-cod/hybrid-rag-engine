"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, startTransition, useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { KnowledgeMap } from "@/components/knowledge-map";
import {
  getMockSourceLibraryDetail,
  listMockSourceLibrary,
  queryMockWorkspace,
  upsertMockWorkspaceDocument
} from "@/lib/mock-workspace";
import type {
  ChatApiResponse,
  ChatMessage,
  GraphPayload,
  IngestionResult,
  MockWorkspaceDocument,
  RetrievalMode,
  SourceLibraryDetail,
  SourceLibraryItem
} from "@/lib/types";

const MIN_REQUEST_INTERVAL_MS = 4_500;
const MOCK_STORAGE_KEY = "insightgraph.mock-workspace.v2";

const starterMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Ask a question, inspect the evidence, and watch the graph path take shape. InsightGraph is designed to stay explorable in both live and fully simulated modes."
  }
];

const initialGraph: GraphPayload = {
  nodes: [],
  links: [],
  paths: [],
  relatedEntities: []
};

const demoSources = [
  {
    sourceId: "project-atlas-brief",
    title: "Project Atlas Brief",
    sourceType: "memo",
    text:
      "Project Atlas is the internal modernization program sponsored by CEO Maya Chen and owned by the platform strategy team. The 2025 goals emphasize cost efficiency, faster customer onboarding, and a unified knowledge layer across product lines. Atlas depends on the Search Infrastructure group, partners with the Analytics Office, and is expected to reduce support resolution time by 18 percent. VP of Operations Daniel Brooks reviews Atlas milestones with Maya Chen every month."
  },
  {
    sourceId: "northstar-ai-roadmap",
    title: "Northstar AI Roadmap",
    sourceType: "article",
    text:
      "Northstar AI is a cross-functional initiative connecting the research team, the customer intelligence unit, and the enterprise sales org. CTO Elena Ortiz asked the graph engineering squad to map how customer pain points relate to product roadmap themes. The 2025 roadmap links Northstar AI to Project Atlas because both programs share the same retrieval platform and success metric around answer quality. Enterprise sales director Priya Njeri uses Northstar outputs in quarterly planning."
  },
  {
    sourceId: "ceo-2025-goals",
    title: "CEO 2025 Goals",
    sourceType: "notes",
    text:
      "CEO Maya Chen set three priorities for 2025: operational efficiency, trusted AI experiences, and clearer executive visibility into strategic programs. Project Atlas supports operational efficiency and trusted AI experiences. Northstar AI supports trusted AI experiences and executive visibility. Daniel Brooks and Elena Ortiz are responsible for reporting progress on their respective programs during the executive review."
  }
] as const;

const freeAiToolkit = [
  {
    name: "Gemini API Free Tier",
    mode: "Cloud",
    href: "https://ai.google.dev/gemini-api/docs/pricing",
    blurb: "Fastest path for live extraction, embeddings, and synthesis while you are validating the real connector route."
  },
  {
    name: "Ollama",
    mode: "Local",
    href: "https://ollama.com/download",
    blurb: "Run chat and embedding models on your own machine when you want zero cloud cost and predictable demos."
  },
  {
    name: "LM Studio",
    mode: "Desktop",
    href: "https://lmstudio.ai/download",
    blurb: "Good for local model testing with a friendly desktop UI and an OpenAI-compatible local API."
  },
  {
    name: "Hugging Face Inference",
    mode: "Fallback",
    href: "https://huggingface.co/docs/inference-providers/index",
    blurb: "Useful when you want a free experimentation surface for model comparisons and backup inference paths."
  }
] as const;

const fallbackPlaybooks = [
  {
    title: "Quota capped",
    detail: "Switch to Mock AI and keep exploring locally. The browser workspace keeps ingestion, retrieval, and graph generation moving without live model calls."
  },
  {
    title: "Vector store paused",
    detail: "Seed or ingest sources into the local mock workspace, then continue with semantic search simulation while Supabase is unavailable."
  },
  {
    title: "Graph DB paused",
    detail: "Use vector mode for live evidence, or use Mock AI to build graph paths deterministically from the ingested source text."
  }
] as const;

function slugifySourceId(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function inferTitleFromText(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }

  const firstSentence = compact.split(/(?<=[.!?])\s+/)[0] ?? compact;
  return firstSentence.replace(/[.!?]+$/, "").trim().slice(0, 64);
}

function makeUniqueSourceId(base: string, existingSourceIds: string[]) {
  const normalizedBase = slugifySourceId(base) || "source";
  const existing = new Set(existingSourceIds.map((item) => item.trim()).filter(Boolean));

  if (!existing.has(normalizedBase)) {
    return normalizedBase;
  }

  let suffix = 2;
  while (existing.has(`${normalizedBase}-${suffix}`)) {
    suffix += 1;
  }

  return `${normalizedBase}-${suffix}`;
}

async function readApiPayload<T>(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  const rawText = (await response.text()).trim();
  if (rawText.startsWith("<!DOCTYPE") || rawText.startsWith("<html")) {
    throw new Error(fallbackMessage);
  }

  throw new Error(rawText || fallbackMessage);
}

function describeRetrievalMode(mode: RetrievalMode) {
  if (mode === "vector") {
    return "Semantic retrieval only, graph traversal skipped.";
  }

  if (mode === "graph") {
    return "Graph traversal only, vector search skipped.";
  }

  return "Hybrid retrieval blends semantic evidence with graph structure.";
}

function parseMockWorkspace(raw: string | null) {
  if (!raw) {
    return [] as MockWorkspaceDocument[];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is MockWorkspaceDocument => {
      return Boolean(
        entry &&
          typeof entry === "object" &&
          "sourceId" in entry &&
          typeof entry.sourceId === "string" &&
          "chunks" in entry &&
          Array.isArray(entry.chunks)
      );
    });
  } catch {
    return [];
  }
}

export function DashboardShell() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [statusText, setStatusText] = useState("Boot sequence ready.");
  const [statusVariant, setStatusVariant] = useState<"default" | "error">("default");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [graph, setGraph] = useState<GraphPayload>(initialGraph);
  const [sourceId, setSourceId] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceType, setSourceType] = useState("article");
  const [articleUrl, setArticleUrl] = useState("");
  const [documentText, setDocumentText] = useState("");
  const [sourceIdTouched, setSourceIdTouched] = useState(false);
  const [sourceTitleTouched, setSourceTitleTouched] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestionResult | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [latestSources, setLatestSources] = useState<ChatApiResponse["sources"]>([]);
  const [remoteLibraryItems, setRemoteLibraryItems] = useState<SourceLibraryItem[]>([]);
  const [libraryPending, setLibraryPending] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedLibrarySourceId, setSelectedLibrarySourceId] = useState<string | null>(null);
  const [selectedRemoteLibraryDetail, setSelectedRemoteLibraryDetail] = useState<SourceLibraryDetail | null>(null);
  const [libraryDetailPending, setLibraryDetailPending] = useState(false);
  const [libraryDetailError, setLibraryDetailError] = useState<string | null>(null);
  const [activeChatSourceId, setActiveChatSourceId] = useState<string | null>(null);
  const [retrievalMode, setRetrievalMode] = useState<RetrievalMode>("hybrid");
  const [useMockAi, setUseMockAi] = useState(false);
  const [mockDocuments, setMockDocuments] = useState<MockWorkspaceDocument[]>([]);
  const [mockWorkspaceReady, setMockWorkspaceReady] = useState(false);

  useEffect(() => {
    startTransition(() => {
      fetch("/api/health")
        .then(() => {
          setStatusVariant("default");
          setStatusText("Backend is awake. You can run live connectors or stay fully local with Mock AI.");
        })
        .catch(() => {
          setStatusVariant("error");
          setStatusText("Warmup ping failed. Live routes may be slower, but Mock AI is still available.");
        });
    });
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const stored = parseMockWorkspace(window.localStorage.getItem(MOCK_STORAGE_KEY));
      setMockDocuments(stored);
      setMockWorkspaceReady(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!mockWorkspaceReady) {
      return;
    }

    window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(mockDocuments));
  }, [mockDocuments, mockWorkspaceReady]);

  useEffect(() => {
    if (cooldownUntil <= now) {
      return;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => window.clearInterval(timer);
  }, [cooldownUntil, now]);

  const loadRemoteLibraryDetail = useCallback(async (sourceIdToLoad: string) => {
    setLibraryDetailPending(true);
    setLibraryDetailError(null);

    try {
      const response = await fetch(`/api/library/${encodeURIComponent(sourceIdToLoad)}`);
      const payload = (await response.json()) as SourceLibraryDetail | { error?: string };

      if (!response.ok || "error" in payload) {
        const message =
          "error" in payload && payload.error
            ? payload.error
            : "Could not load the selected source detail.";
        throw new Error(message);
      }

      setSelectedRemoteLibraryDetail(payload as SourceLibraryDetail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected library detail error.";
      setLibraryDetailError(message);
    } finally {
      setLibraryDetailPending(false);
    }
  }, []);

  const loadRemoteLibrary = useCallback(async () => {
    setLibraryPending(true);
    setLibraryError(null);

    try {
      const response = await fetch("/api/library");
      const payload = (await response.json()) as
        | { sources: SourceLibraryItem[] }
        | { error?: string };

      if (!response.ok || "error" in payload) {
        const message =
          "error" in payload && payload.error
            ? payload.error
            : "Could not load the source library.";
        throw new Error(message);
      }

      const sources = (payload as { sources: SourceLibraryItem[] }).sources;
      setRemoteLibraryItems(sources);

      let nextSelection: string | null = null;
      setSelectedLibrarySourceId((current) => {
        if (current || sources.length === 0) {
          return current;
        }

        nextSelection = sources[0].sourceId;
        return nextSelection;
      });

      if (nextSelection) {
        void loadRemoteLibraryDetail(nextSelection);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected library error.";
      setLibraryError(message);
    } finally {
      setLibraryPending(false);
    }
  }, [loadRemoteLibraryDetail]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadRemoteLibrary();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadRemoteLibrary]);

  const mockLibraryItems = useMemo(() => listMockSourceLibrary(mockDocuments), [mockDocuments]);
  const displayLibraryItems = useMemo(
    () => (useMockAi ? mockLibraryItems : remoteLibraryItems),
    [mockLibraryItems, remoteLibraryItems, useMockAi]
  );
  const currentLibrarySourceId =
    selectedLibrarySourceId && displayLibraryItems.some((item) => item.sourceId === selectedLibrarySourceId)
      ? selectedLibrarySourceId
      : displayLibraryItems[0]?.sourceId ?? null;
  const effectiveActiveChatSourceId =
    useMockAi && activeChatSourceId && !mockLibraryItems.some((item) => item.sourceId === activeChatSourceId)
      ? null
      : activeChatSourceId;
  const displayLibraryDetail = useMemo(
    () =>
      useMockAi
        ? currentLibrarySourceId
          ? getMockSourceLibraryDetail(mockDocuments, currentLibrarySourceId)
          : null
        : selectedRemoteLibraryDetail,
    [currentLibrarySourceId, mockDocuments, selectedRemoteLibraryDetail, useMockAi]
  );

  const cooldownRemaining = Math.max(0, cooldownUntil - now);
  const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);
  const canSubmitQuestion = Boolean(question.trim()) && !pending && cooldownRemaining <= 0;

  const graphStats = useMemo(
    () => ({
      nodes: graph.nodes.length,
      links: graph.links.length,
      paths: graph.paths.length
    }),
    [graph]
  );

  const recentIngestSources = useMemo(() => displayLibraryItems.slice(0, 6), [displayLibraryItems]);
  const latestIngestLabel = ingestResult?.title || ingestResult?.sourceId || "No source seeded yet";
  const activeSourceLabel =
    displayLibraryDetail?.source.title ||
    ingestResult?.title ||
    effectiveActiveChatSourceId ||
    "the current workspace";

  const quickQuestions = useMemo(() => {
    if (effectiveActiveChatSourceId || ingestResult || displayLibraryDetail) {
      return [
        `Summarize the key themes in ${activeSourceLabel}.`,
        `Which entities or teams matter most in ${activeSourceLabel}?`,
        `What relationships connect the most important ideas in ${activeSourceLabel}?`
      ];
    }

    return [
      "Summarize the strongest ideas in the current workspace.",
      "Which leaders or teams are most connected across the available sources?",
      "What graph path best explains the current knowledge base?"
    ];
  }, [activeSourceLabel, displayLibraryDetail, effectiveActiveChatSourceId, ingestResult]);

  const suggestedQuestions = useMemo(() => {
    if (!displayLibraryDetail) {
      return [];
    }

    const sourceLabel = displayLibraryDetail.source.title || displayLibraryDetail.source.sourceId;
    const entities = displayLibraryDetail.chunks.flatMap((chunk) => chunk.entityNames).slice(0, 3);

    return [
      `Summarize the key themes in ${sourceLabel}.`,
      entities.length >= 2
        ? `How is ${entities[0]} related to ${entities[1]} in ${sourceLabel}?`
        : `What relationships stand out in ${sourceLabel}?`,
      `What should an executive understand first about ${sourceLabel}?`
    ];
  }, [displayLibraryDetail]);

  function applyAutoDerivedFields(nextText: string, nextTitle: string) {
    let resolvedTitle = nextTitle;

    if (!sourceTitleTouched) {
      resolvedTitle = inferTitleFromText(nextText);
      setSourceTitle(resolvedTitle);
    }

    if (!sourceIdTouched) {
      const baseTitle = resolvedTitle.trim() || inferTitleFromText(nextText);
      setSourceId(
        baseTitle ? makeUniqueSourceId(baseTitle, displayLibraryItems.map((item) => item.sourceId)) : ""
      );
    }
  }

  function seedMockWorkspace() {
    let nextDocuments = mockDocuments;
    let lastResult: IngestionResult | null = null;

    for (const demoSource of demoSources) {
      const upserted = upsertMockWorkspaceDocument(nextDocuments, {
        sourceId: demoSource.sourceId,
        title: demoSource.title,
        sourceType: demoSource.sourceType,
        text: demoSource.text
      });
      nextDocuments = upserted.documents;
      lastResult = upserted.result;
    }

    setMockDocuments(nextDocuments);
    setIngestResult(lastResult);
    setSelectedLibrarySourceId(nextDocuments[0]?.sourceId ?? null);
    setActiveChatSourceId(nextDocuments[0]?.sourceId ?? null);
    setStatusVariant("default");
    setStatusText("Seeded the mock workspace with three demo sources. You can now chat, inspect evidence, and explore graph paths without live connectors.");
  }

  function clearMockWorkspace() {
    setMockDocuments([]);
    setSelectedLibrarySourceId(null);
    setActiveChatSourceId(null);
    setIngestResult(null);
    setLatestSources([]);
    setGraph(initialGraph);
    setMessages(starterMessages);
    setStatusVariant("default");
    setStatusText("Mock workspace cleared. You can seed the demos again or ingest fresh local text.");
  }

  async function loadSourceIntoForm(sourceIdToLoad: string) {
    setSelectedLibrarySourceId(sourceIdToLoad);
    setLibraryDetailPending(true);
    setLibraryDetailError(null);

    try {
      const detail = useMockAi
        ? getMockSourceLibraryDetail(mockDocuments, sourceIdToLoad)
        : await (async () => {
            const response = await fetch(`/api/library/${encodeURIComponent(sourceIdToLoad)}`);
            const payload = (await response.json()) as SourceLibraryDetail | { error?: string };

            if (!response.ok || "error" in payload) {
              const message =
                "error" in payload && payload.error
                  ? payload.error
                  : "Could not load the selected source detail.";
              throw new Error(message);
            }

            return payload as SourceLibraryDetail;
          })();

      if (!detail) {
        throw new Error("That source is not available in the current workspace.");
      }

      const reconstructedText = detail.chunks
        .slice()
        .sort((left, right) => left.chunkIndex - right.chunkIndex)
        .map((chunk) => chunk.content)
        .join("\n\n");

      if (!useMockAi) {
        setSelectedRemoteLibraryDetail(detail);
      }

      setSourceIdTouched(true);
      setSourceTitleTouched(true);
      setSelectedFileName(null);
      setArticleUrl("");
      setSourceId(detail.source.sourceId);
      setSourceTitle(detail.source.title || detail.source.sourceId);
      setSourceType(detail.source.sourceType || "article");
      setDocumentText(reconstructedText);
      setStatusVariant("default");
      setStatusText(`Loaded ${detail.source.title || detail.source.sourceId} into the ingestion console.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected source loading error.";
      setLibraryDetailError(message);
      setStatusVariant("error");
      setStatusText(message);
    } finally {
      setLibraryDetailPending(false);
    }
  }

  function loadDemoSource(sourceIdToLoad: string) {
    const demoSource = demoSources.find(
      (source) => source.sourceId === sourceIdToLoad
    ) as (typeof demoSources)[number] | undefined;
    if (!demoSource) {
      return;
    }

    const sourceBase = demoSource.title || sourceIdToLoad;
    setSourceIdTouched(true);
    setSourceTitleTouched(true);
    setSourceId(makeUniqueSourceId(sourceBase, displayLibraryItems.map((item) => item.sourceId)));
    setSourceTitle(demoSource.title);
    setSourceType(demoSource.sourceType);
    setDocumentText(demoSource.text);
    setSelectedFileName(null);
    setIngestError(null);
    setStatusVariant("default");
    setStatusText(`Loaded demo source "${demoSource.title}" into the ingestion console.`);
  }

  function applySuggestedQuestion(nextQuestion: string) {
    setQuestion(nextQuestion);

    if (displayLibraryDetail) {
      setActiveChatSourceId(displayLibraryDetail.source.sourceId);
      setStatusVariant("default");
      setStatusText(`Prepared a scoped question for ${displayLibraryDetail.source.sourceId}.`);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = question.trim();
    if (!trimmed) {
      setStatusVariant("error");
      setStatusText("Type a question or tap one of the guided prompts before asking InsightGraph.");
      return;
    }

    if (pending) {
      return;
    }

    if (cooldownRemaining > 0) {
      setStatusVariant("error");
      setStatusText(`Cooling down to avoid request spikes. Try again in ${cooldownSeconds}s.`);
      return;
    }

    if (useMockAi && mockDocuments.length === 0) {
      setStatusVariant("error");
      setStatusText("The mock workspace is empty. Seed the demo sources or ingest a local document first.");
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed
    };

    setQuestion("");
    setPending(true);
    setCooldownUntil(Date.now() + MIN_REQUEST_INTERVAL_MS);
    setNow(Date.now());
    setStatusVariant("default");
    setStatusText(
      effectiveActiveChatSourceId
        ? `${describeRetrievalMode(retrievalMode)} Scoped to ${effectiveActiveChatSourceId}.`
        : describeRetrievalMode(retrievalMode)
    );
    setMessages((current) => [...current, userMessage]);

    try {
      const payload = useMockAi
        ? queryMockWorkspace(mockDocuments, {
            question: trimmed,
            sourceId: effectiveActiveChatSourceId,
            retrievalMode
          })
        : await (async () => {
            const response = await fetch("/api/chat", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                question: trimmed,
                sourceId: effectiveActiveChatSourceId,
                retrievalMode,
                useMockAi
              })
            });

            const payload = (await response.json()) as ChatApiResponse | { error?: string };

            if (!response.ok || "error" in payload) {
              const errorMessage =
                "error" in payload && payload.error
                  ? payload.error
                  : "The hybrid retrieval request failed.";
              throw new Error(errorMessage);
            }

            return payload as ChatApiResponse;
          })();

      startTransition(() => {
        setGraph(payload.graph);
        setLatestSources(payload.sources);
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: payload.answer,
            sources: payload.sources
          }
        ]);
        setStatusText(
          useMockAi
            ? `Mock answer ready using ${payload.retrievalMode} mode. Everything on screen was generated from the local workspace.`
            : effectiveActiveChatSourceId
              ? `Live answer ready using ${payload.retrievalMode} mode for ${effectiveActiveChatSourceId}.`
              : `Live answer ready using ${payload.retrievalMode} mode.`
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error.";
      setStatusVariant("error");
      setStatusText(message);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `I couldn't complete that request.\n\n${message}`
        }
      ]);
    } finally {
      setPending(false);
    }
  }

  async function handleIngest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedSourceId = sourceId.trim();
    const trimmedText = documentText.trim();

    if (!trimmedSourceId || !trimmedText || ingesting) {
      return;
    }

    setIngesting(true);
    setIngestError(null);

    try {
      const resolvedSourceId = makeUniqueSourceId(
        trimmedSourceId,
        displayLibraryItems
          .map((item) => item.sourceId)
          .filter((existingSourceId) => existingSourceId !== trimmedSourceId)
      );

      const result = useMockAi
        ? (() => {
            const upserted = upsertMockWorkspaceDocument(mockDocuments, {
              sourceId: resolvedSourceId,
              title: sourceTitle.trim() || undefined,
              sourceType,
              text: trimmedText
            });

            setMockDocuments(upserted.documents);
            return upserted.result;
          })()
        : await (async () => {
            const response = await fetch("/api/ingest", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                sourceId: resolvedSourceId,
                title: sourceTitle.trim() || undefined,
                text: trimmedText,
                useMockAi,
                metadata: {
                  sourceType
                }
              })
            });

            const payload = (await response.json()) as IngestionResult | { error?: string };
            if (!response.ok || "error" in payload) {
              const message =
                "error" in payload && payload.error ? payload.error : "Ingestion failed unexpectedly.";
              throw new Error(message);
            }

            return payload as IngestionResult;
          })();

      setIngestResult(result);
      setSelectedLibrarySourceId(result.sourceId);
      setActiveChatSourceId(result.sourceId);

      if (!useMockAi) {
        void loadRemoteLibraryDetail(result.sourceId);
        void loadRemoteLibrary();
      }

      setSelectedFileName(null);
      setArticleUrl("");
      setDocumentText("");
      setSourceTitle("");
      setSourceId("");
      setSourceTitleTouched(false);
      setSourceIdTouched(false);
      setStatusVariant("default");
      setStatusText(
        useMockAi
          ? `Ingested ${result.chunkCount} chunk${result.chunkCount === 1 ? "" : "s"} into the local mock workspace. Chat is now scoped to ${result.sourceId}.`
          : `Ingested ${result.chunkCount} chunk${result.chunkCount === 1 ? "" : "s"} into Supabase and Neo4j. Chat is now scoped to ${result.sourceId}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected ingestion error.";
      setIngestError(message);
      setStatusVariant("error");
      setStatusText(message);
    } finally {
      setIngesting(false);
    }
  }

  async function handleFileSelected(file: File | null) {
    if (!file) {
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData
      });

      const payload = (await readApiPayload<
        | {
            fileName: string;
            title: string;
            sourceId: string;
            sourceType: string;
            text: string;
          }
        | { error?: string }
      >(
        response,
        "The file could not be processed automatically. If this was a PDF, try a text-based PDF or paste the extracted text into the raw text box instead."
      )) as
        | {
            fileName: string;
            title: string;
            sourceId: string;
            sourceType: string;
            text: string;
          }
        | { error?: string };

      if (!response.ok || "error" in payload) {
        const message =
          "error" in payload && payload.error ? payload.error : "File extraction failed unexpectedly.";
        throw new Error(message);
      }

      const successPayload = payload as {
        fileName: string;
        title: string;
        sourceId: string;
        sourceType: string;
        text: string;
      };

      const uniqueSourceId = makeUniqueSourceId(
        successPayload.sourceId || successPayload.title,
        displayLibraryItems.map((item) => item.sourceId)
      );

      setSelectedFileName(successPayload.fileName);
      setSourceTitleTouched(true);
      setSourceIdTouched(true);
      setSourceTitle(successPayload.title);
      setSourceId(uniqueSourceId);
      setSourceType(successPayload.sourceType);
      setDocumentText(successPayload.text);
      setIngestError(null);
      setStatusVariant("default");
      setStatusText(`Loaded ${successPayload.fileName} into the ingestion console.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not read the selected source file.";
      setIngestError(message);
      setStatusVariant("error");
      setStatusText(message);
    }
  }

  async function handleArticleLoad() {
    const trimmedUrl = articleUrl.trim();
    if (!trimmedUrl || articleLoading) {
      return;
    }

    setArticleLoading(true);
    setIngestError(null);

    try {
      const response = await fetch("/api/extract-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ url: trimmedUrl })
      });

      const payload = (await readApiPayload<
        | {
            url: string;
            title: string;
            sourceId: string;
            sourceType: "article";
            text: string;
          }
        | { error?: string }
      >(
        response,
        "The article could not be loaded right now. Please try again, or paste the text into the raw text box instead."
      )) as
        | {
            url: string;
            title: string;
            sourceId: string;
            sourceType: "article";
            text: string;
          }
        | { error?: string };

      if (!response.ok || "error" in payload) {
        const message =
          "error" in payload && payload.error ? payload.error : "Article extraction failed unexpectedly.";
        throw new Error(message);
      }

      const successPayload = payload as {
        url: string;
        title: string;
        sourceId: string;
        sourceType: "article";
        text: string;
      };

      const uniqueSourceId = makeUniqueSourceId(
        successPayload.sourceId || successPayload.title,
        displayLibraryItems.map((item) => item.sourceId)
      );

      setSelectedFileName(null);
      setSourceTitleTouched(true);
      setSourceIdTouched(true);
      setSourceTitle(successPayload.title);
      setSourceId(uniqueSourceId);
      setSourceType(successPayload.sourceType);
      setDocumentText(successPayload.text);
      setStatusVariant("default");
      setStatusText(`Loaded article content from ${successPayload.url}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load the article URL.";
      setIngestError(message);
      setStatusVariant("error");
      setStatusText(message);
    } finally {
      setArticleLoading(false);
    }
  }

  const librarySurfaceLabel = useMockAi ? "Mock Workspace" : "Live Library";

  return (
    <main className="page-shell">
      <section className="command-deck panel">
        <div className="command-grid">
          <div className="command-copy">
            <div className="deck-topline">
              <span className="eyebrow">Hybrid Retrieval Operating System</span>
              <span className={`status-dot ${useMockAi ? "status-dot-mock" : "status-dot-live"}`}>
                {useMockAi ? "Browser mock workspace" : "Live connector path"}
              </span>
            </div>

            <div className="brand-lockup">
              <Image
                alt="InsightGraph logo"
                className="hero-logo"
                height={84}
                priority
                src="/insightgraph-logo.jpeg"
                width={84}
              />
              <div className="brand-copy">
                <p className="brand-kicker">InsightGraph v0.2</p>
                <h1>Inspectable answers, even when free-tier AI gets flaky.</h1>
              </div>
            </div>

            <p className="deck-lede">
              Ingest unstructured sources, expose the entity graph, and compare semantic evidence with
              relationship structure in one startup-ready workspace. When live services are unavailable,
              Mock AI keeps the demo moving with browser-only ingestion, retrieval, and graph synthesis.
            </p>

            <div className="command-actions">
              <div className="segmented-control">
                <button
                  className={`segment-button ${!useMockAi ? "segment-button-active" : ""}`}
                  onClick={() => setUseMockAi(false)}
                  type="button"
                >
                  Live AI
                </button>
                <button
                  className={`segment-button ${useMockAi ? "segment-button-active" : ""}`}
                  onClick={() => setUseMockAi(true)}
                  type="button"
                >
                  Mock AI
                </button>
              </div>

              <button
                className="ghost-button"
                onClick={() => {
                  setUseMockAi(true);
                  seedMockWorkspace();
                }}
                type="button"
              >
                Seed Local Demo
              </button>

              {useMockAi ? (
                <button className="ghost-button" onClick={() => clearMockWorkspace()} type="button">
                  Clear Mock Data
                </button>
              ) : (
                <a className="ghost-button" href="#ingestion">
                  Open Ingestion Console
                </a>
              )}
            </div>

            <div className="status-ribbon" data-variant={statusVariant}>
              <span className="status-ribbon-label">System status</span>
              <span>{statusText}</span>
            </div>
          </div>

          <div className="ops-rail">
            <div className="ops-card ops-card-spotlight">
              <div className="ops-card-header">
                <span className="ops-kicker">Workspace runway</span>
                <span className="badge">{useMockAi ? "local-first" : "live"}</span>
              </div>
              <div className="ops-metrics">
                <div className="ops-metric">
                  <span>Sources</span>
                  <strong>{displayLibraryItems.length}</strong>
                </div>
                <div className="ops-metric">
                  <span>Scope</span>
                  <strong>{effectiveActiveChatSourceId ?? "all"}</strong>
                </div>
                <div className="ops-metric">
                  <span>Mode</span>
                  <strong>{retrievalMode}</strong>
                </div>
                <div className="ops-metric">
                  <span>Latest ingest</span>
                  <strong>{latestIngestLabel}</strong>
                </div>
              </div>
              <p className="ops-summary">
                {useMockAi
                  ? "The current session runs entirely from the browser workspace. No Gemini, Supabase, or Neo4j round-trips are required for chat or ingestion."
                  : "The current session uses the production connector path for embeddings, retrieval, and graph traversal."}
              </p>
            </div>

            <div className="ops-card">
              <div className="ops-card-header">
                <span className="ops-kicker">Free AI toolkit</span>
                <span className="badge">verified options</span>
              </div>
              <div className="toolkit-list">
                {freeAiToolkit.map((tool) => (
                  <Link
                    className="tool-card"
                    href={tool.href}
                    key={tool.name}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <div className="tool-card-header">
                      <strong>{tool.name}</strong>
                      <span>{tool.mode}</span>
                    </div>
                    <p>{tool.blurb}</p>
                  </Link>
                ))}
              </div>
            </div>

            <div className="ops-card">
              <div className="ops-card-header">
                <span className="ops-kicker">Fallback playbooks</span>
                <span className="badge">demo-safe</span>
              </div>
              <div className="playbook-list">
                {fallbackPlaybooks.map((playbook, index) => (
                  <div className="playbook-row" key={playbook.title}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{playbook.title}</strong>
                      <p>{playbook.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="workspace-grid">
        <article className="panel query-panel">
          <header className="panel-header">
            <div className="panel-title">
              <h2>Query Engine</h2>
              <p>Ask for explanations that can be defended with both chunk evidence and graph context.</p>
            </div>
            <div className="badge">{pending ? "retrieving" : "ready"}</div>
          </header>

          <div className="messages">
            {messages.map((message) => (
              <div
                className={`message ${message.role === "user" ? "message-user" : "message-assistant"}`}
                key={message.id}
              >
                <div className="message-label">{message.role === "user" ? "Prompt" : "Response"}</div>
                <ReactMarkdown>{message.content}</ReactMarkdown>
                {message.sources && message.sources.length > 0 ? (
                  <div className="sources">
                    <strong>Evidence trace</strong>
                    <div>
                      {message.sources.map((source) => (
                        <span className="source-chip" key={source.id}>
                          {source.title || source.sourceId} · {(source.similarity * 100).toFixed(1)}%
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="composer">
            <form className="composer-shell" onSubmit={handleSubmit}>
              <div className="composer-topline">
                <div className="segmented-control">
                  {(["hybrid", "vector", "graph"] as RetrievalMode[]).map((mode) => (
                    <button
                      className={`segment-button ${retrievalMode === mode ? "segment-button-active" : ""}`}
                      key={mode}
                      onClick={() => setRetrievalMode(mode)}
                      type="button"
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                {effectiveActiveChatSourceId ? (
                  <div className="scope-actions">
                    <span className="scope-pill">Scoped to {effectiveActiveChatSourceId}</span>
                    <button className="ghost-button" onClick={() => setActiveChatSourceId(null)} type="button">
                      Clear scope
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="quick-question-strip">
                {quickQuestions.map((prompt) => (
                  <button
                    className="question-prompt-button"
                    key={prompt}
                    onClick={() => setQuestion(prompt)}
                    type="button"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <textarea
                aria-label="Ask a hybrid retrieval question"
                onChange={(event) => setQuestion(event.target.value)}
                placeholder='Ask about a project, person, or concept. Example: "How is Project Atlas connected to the CEO&apos;s 2025 goals?"'
                value={question}
              />

              <div className="composer-actions">
                <div className="composer-hint">
                  {pending
                    ? describeRetrievalMode(retrievalMode)
                    : cooldownRemaining > 0
                      ? `Cooldown active for ${cooldownSeconds}s.`
                      : useMockAi
                        ? "Mock AI runs in the browser workspace with deterministic extraction, embeddings, and graph synthesis."
                        : "Live AI uses your configured Gemini, Supabase, and Neo4j connectors. A small cooldown reduces free-tier rate-limit spikes."}
                </div>
                <button className="submit-button" disabled={!canSubmitQuestion} type="submit">
                  {pending ? "Thinking..." : "Ask InsightGraph"}
                </button>
              </div>
            </form>
          </div>
        </article>

        <aside className="panel map-panel">
          <header className="panel-header">
            <div className="panel-title">
              <h2>Knowledge Map</h2>
              <p>Trace the entities, edges, and shortest paths returned by the current query.</p>
            </div>
            <div className="badge">{graph.relatedEntities.length} active entities</div>
          </header>

          <div className="map-summary">
            <div className="stat-card">
              <span>Nodes</span>
              <strong>{graphStats.nodes}</strong>
            </div>
            <div className="stat-card">
              <span>Links</span>
              <strong>{graphStats.links}</strong>
            </div>
            <div className="stat-card">
              <span>Paths</span>
              <strong>{graphStats.paths}</strong>
            </div>
          </div>

          <div className="map-shell">
            <KnowledgeMap graph={graph} />
          </div>

          <div className="evidence-grid">
            <div className="evidence-card">
              <h3>Graph paths</h3>
              {graph.paths.length > 0 ? (
                <div className="path-list">
                  {graph.paths.map((path, index) => (
                    <div className="path-card" key={`${path.nodes.join("->")}-${index}`}>
                      <strong>Path {index + 1}</strong>
                      <p>{path.nodes.join(" → ")}</p>
                      <div>
                        {path.relationships.map((relation, relationIndex) => (
                          <span className="source-chip" key={`${relation}-${relationIndex}`}>
                            {relation}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ingest-muted">
                  No path has been drawn yet. Ask a question with named entities to activate the graph context.
                </p>
              )}
            </div>

            <div className="evidence-card">
              <h3>Semantic evidence</h3>
              {latestSources.length > 0 ? (
                <div className="evidence-list">
                  {latestSources.map((source) => (
                    <div className="evidence-row" key={source.id}>
                      <div className="evidence-heading">
                        <strong>{source.title || source.sourceId}</strong>
                        <span>{(source.similarity * 100).toFixed(1)}%</span>
                      </div>
                      <p>
                        {source.content.slice(0, 200)}
                        {source.content.length > 200 ? "..." : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ingest-muted">
                  Vector matches for the latest question will appear here after retrieval runs.
                </p>
              )}
            </div>
          </div>
        </aside>
      </section>

      <section className="operations-grid">
        <section className="panel ingest-panel" id="ingestion">
          <header className="panel-header">
            <div className="panel-title">
              <h2>Ingestion Console</h2>
              <p>Turn pasted text, files, or article URLs into chunked evidence and extracted relationships.</p>
            </div>
            <div className="badge">{useMockAi ? "browser ingest" : ingesting ? "writing to stores" : "ready"}</div>
          </header>

          <div className="ingest-grid">
            <form className="composer-shell ingest-form" onSubmit={handleIngest}>
              <div className="ingest-toolbar">
                <div className="preset-group">
                  <span className="preset-label">Starter demos</span>
                  <div className="preset-strip">
                    {demoSources.map((demoSource) => (
                      <button
                        className="preset-button"
                        key={demoSource.sourceId}
                        onClick={() => loadDemoSource(demoSource.sourceId)}
                        type="button"
                      >
                        {demoSource.title}
                      </button>
                    ))}
                  </div>
                </div>

                {recentIngestSources.length > 0 ? (
                  <div className="preset-group">
                    <span className="preset-label">Recent workspace sources</span>
                    <div className="preset-strip">
                      {recentIngestSources.map((item) => (
                        <button
                          className="preset-button preset-button-secondary"
                          key={item.sourceId}
                          onClick={() => void loadSourceIntoForm(item.sourceId)}
                          type="button"
                        >
                          {item.title || item.sourceId}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="field-grid">
                <label className="field">
                  <span>Source ID</span>
                  <input
                    onChange={(event) => {
                      setSourceIdTouched(true);
                      setSourceId(event.target.value);
                    }}
                    placeholder="auto-generated from title"
                    value={sourceId}
                  />
                </label>
                <label className="field">
                  <span>Title</span>
                  <input
                    onChange={(event) => {
                      setSourceTitleTouched(true);
                      const nextTitle = event.target.value;
                      setSourceTitle(nextTitle);

                      if (!sourceIdTouched) {
                        const baseTitle = nextTitle.trim() || inferTitleFromText(documentText);
                        setSourceId(
                          baseTitle
                            ? makeUniqueSourceId(baseTitle, displayLibraryItems.map((item) => item.sourceId))
                            : ""
                        );
                      }
                    }}
                    placeholder="auto-generated from text or file name"
                    value={sourceTitle}
                  />
                </label>
                <label className="field">
                  <span>Source type</span>
                  <select onChange={(event) => setSourceType(event.target.value)} value={sourceType}>
                    <option value="article">Article</option>
                    <option value="data">Data</option>
                    <option value="pdf">PDF</option>
                    <option value="memo">Memo</option>
                    <option value="notes">Notes</option>
                  </select>
                </label>
              </div>

              <div className="article-loader">
                <label className="field">
                  <span>Article URL</span>
                  <input
                    onChange={(event) => setArticleUrl(event.target.value)}
                    placeholder="https://example.com/article"
                    value={articleUrl}
                  />
                </label>
                <button
                  className="ghost-button"
                  disabled={articleLoading || !articleUrl.trim()}
                  onClick={() => void handleArticleLoad()}
                  type="button"
                >
                  {articleLoading ? "Loading article..." : "Load Article"}
                </button>
              </div>

              <label className="field">
                <span>Raw text</span>
                <div className="file-picker-row">
                  <label className="file-picker">
                    <input
                      accept=".pdf,.txt,.md,.csv,.json"
                      onChange={(event) => void handleFileSelected(event.target.files?.[0] ?? null)}
                      type="file"
                    />
                    Load source file
                  </label>
                  <span className="file-picker-hint">
                    {selectedFileName
                      ? `Loaded: ${selectedFileName}`
                      : "Supports .pdf, .txt, .md, .csv, and .json files."}
                  </span>
                </div>
                <textarea
                  aria-label="Raw document text for ingestion"
                  onChange={(event) => {
                    const nextText = event.target.value;
                    setDocumentText(nextText);
                    applyAutoDerivedFields(nextText, sourceTitle);
                  }}
                  placeholder="Paste extracted text from a PDF, article, transcript, or internal memo."
                  value={documentText}
                />
              </label>

              <div className="composer-actions">
                <div className="composer-hint">
                  {ingesting
                    ? "Chunking text, extracting entities, building embeddings, and updating the selected workspace."
                    : useMockAi
                      ? "Mock ingestion stays in the browser. It is the fastest way to demo the product without connector cost or downtime."
                      : "Live ingestion runs server-side so Neo4j and Supabase credentials never leave the backend."}
                </div>
                <button
                  className="submit-button"
                  disabled={ingesting || !sourceId.trim() || !documentText.trim()}
                  type="submit"
                >
                  {ingesting ? "Ingesting..." : useMockAi ? "Ingest Locally" : "Ingest Document"}
                </button>
              </div>
            </form>

            <div className="ingest-results">
              <div className="stat-strip">
                <div className="stat-card">
                  <span>Chunks</span>
                  <strong>{ingestResult?.chunkCount ?? 0}</strong>
                </div>
                <div className="stat-card">
                  <span>Entities</span>
                  <strong>{ingestResult?.entityCount ?? 0}</strong>
                </div>
                <div className="stat-card">
                  <span>Triplets</span>
                  <strong>{ingestResult?.tripletCount ?? 0}</strong>
                </div>
              </div>

              <div className="ingest-card">
                <h3>Latest ingest</h3>
                <p>
                  {ingestResult
                    ? `${ingestResult.title || ingestResult.sourceId} is ready for chat, evidence review, and graph exploration.`
                    : "No source has been ingested yet. Seed a demo or paste your own document to activate the workspace."}
                </p>
              </div>

              <div className="ingest-card">
                <h3>Entity preview</h3>
                <div>
                  {ingestResult?.entities.length ? (
                    ingestResult.entities.slice(0, 16).map((entity) => (
                      <span className="source-chip" key={entity}>
                        {entity}
                      </span>
                    ))
                  ) : (
                    <p className="ingest-muted">Entity names from the latest ingest will appear here.</p>
                  )}
                </div>
              </div>

              <div className="ingest-card">
                <h3>Chunk trace</h3>
                {ingestResult?.chunks.length ? (
                  <div className="chunk-list">
                    {ingestResult.chunks.map((chunk) => (
                      <div className="chunk-row" key={chunk.chunkIndex}>
                        <span>Chunk {chunk.chunkIndex + 1}</span>
                        <span>{chunk.entityCount} entities</span>
                        <span>{chunk.tripletCount} triplets</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="ingest-muted">Per-chunk extraction details will appear after ingestion.</p>
                )}
              </div>

              {ingestError ? <div className="status-ribbon" data-variant="error">{ingestError}</div> : null}
            </div>
          </div>
        </section>

        <section className="panel library-panel">
          <header className="panel-header">
            <div className="panel-title">
              <h2>{librarySurfaceLabel}</h2>
              <p>
                {useMockAi
                  ? "Inspect local mock sources, chunk previews, and guided prompts without calling external services."
                  : "Inspect live sources stored in Supabase and use them to scope chat and rehydrate the ingestion form."}
              </p>
            </div>
            {useMockAi ? (
              <div className="library-actions">
                <button className="ghost-button" onClick={() => seedMockWorkspace()} type="button">
                  Seed demos
                </button>
                <button className="ghost-button" onClick={() => clearMockWorkspace()} type="button">
                  Reset
                </button>
              </div>
            ) : (
              <button className="ghost-button" onClick={() => void loadRemoteLibrary()} type="button">
                {libraryPending ? "Refreshing..." : "Refresh Library"}
              </button>
            )}
          </header>

          <div className="library-grid">
            {displayLibraryItems.length > 0 ? (
              <>
                <div className="library-list">
                  {displayLibraryItems.map((item) => (
                    <button
                      className={`library-card ${
                        currentLibrarySourceId === item.sourceId ? "library-card-active" : ""
                      }`}
                      key={item.sourceId}
                      onClick={() => {
                        setSelectedLibrarySourceId(item.sourceId);
                        if (!useMockAi) {
                          void loadRemoteLibraryDetail(item.sourceId);
                        }
                      }}
                      type="button"
                    >
                      <div className="library-card-header">
                        <div>
                          <h3>{item.title || item.sourceId}</h3>
                          <p>{item.sourceId}</p>
                        </div>
                        <span className="badge">{item.chunkCount} chunks</span>
                      </div>
                      <div className="library-meta">
                        <span>{item.sourceType || "unknown type"}</span>
                        <span>{new Date(item.latestIngestedAt).toLocaleString()}</span>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="library-detail">
                  {displayLibraryDetail ? (
                    <>
                      <div className="library-detail-card">
                        <h3>{displayLibraryDetail.source.title || displayLibraryDetail.source.sourceId}</h3>
                        <p>{displayLibraryDetail.source.sourceId}</p>
                        <div className="library-meta">
                          <span>{displayLibraryDetail.source.sourceType || "unknown type"}</span>
                          <span>{new Date(displayLibraryDetail.source.latestIngestedAt).toLocaleString()}</span>
                        </div>
                        <div className="library-actions">
                          <button
                            className="ghost-button"
                            onClick={() =>
                              setActiveChatSourceId((current) =>
                                current === displayLibraryDetail.source.sourceId
                                  ? null
                                  : displayLibraryDetail.source.sourceId
                              )
                            }
                            type="button"
                          >
                            {effectiveActiveChatSourceId === displayLibraryDetail.source.sourceId
                              ? "Clear chat scope"
                              : "Use in chat"}
                          </button>
                          <button
                            className="ghost-button"
                            onClick={() => void loadSourceIntoForm(displayLibraryDetail.source.sourceId)}
                            type="button"
                          >
                            Load in ingest form
                          </button>
                        </div>
                      </div>

                      <div className="library-detail-card">
                        <h3>Guided prompts</h3>
                        <div className="suggestion-list">
                          {suggestedQuestions.map((suggestion) => (
                            <button
                              className="suggestion-button"
                              key={suggestion}
                              onClick={() => applySuggestedQuestion(suggestion)}
                              type="button"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="library-detail-card">
                        <h3>Recent chunks</h3>
                        <div className="detail-chunk-list">
                          {displayLibraryDetail.chunks.map((chunk) => (
                            <div className="detail-chunk-card" key={chunk.id}>
                              <div className="detail-chunk-header">
                                <strong>Chunk {chunk.chunkIndex + 1}</strong>
                                <span>{new Date(chunk.createdAt).toLocaleString()}</span>
                              </div>
                              <p>
                                {chunk.content.slice(0, 260)}
                                {chunk.content.length > 260 ? "..." : ""}
                              </p>
                              <div>
                                {chunk.entityNames.length > 0 ? (
                                  chunk.entityNames.map((entityName) => (
                                    <span className="source-chip" key={`${chunk.id}-${entityName}`}>
                                      {entityName}
                                    </span>
                                  ))
                                ) : (
                                  <span className="ingest-muted">No entity names captured for this chunk.</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="library-detail-card">
                      <p>
                        {libraryDetailPending
                          ? "Loading source detail..."
                          : "Select a source to inspect its chunk previews and suggested prompts."}
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="library-empty">
                <p>
                  {useMockAi
                    ? "The mock workspace is empty. Seed the demos or ingest a local document to start exploring."
                    : libraryPending
                      ? "Loading live library..."
                      : "No live library items yet. Ingest a source and it will appear here."}
                </p>
              </div>
            )}
          </div>

          {!useMockAi && libraryError ? (
            <div className="footnote">
              <div className="status-ribbon" data-variant="error">
                {libraryError}
              </div>
            </div>
          ) : null}

          {!useMockAi && libraryDetailError ? (
            <div className="footnote">
              <div className="status-ribbon" data-variant="error">
                {libraryDetailError}
              </div>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
