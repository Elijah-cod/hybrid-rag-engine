"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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

type WorkspaceView = "map" | "query" | "sources" | "schema" | "traces" | "settings";

type IconName =
  | "map"
  | "database"
  | "schema"
  | "trace"
  | "settings"
  | "search"
  | "play"
  | "plus"
  | "spark"
  | "history"
  | "person"
  | "document"
  | "arrow";

function AppIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    map: <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="m7.8 7 3 8M16.2 7l-3 8M8 6h8"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    schema: <><rect x="3" y="3" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><path d="M9 6h6M18 9v6M6 9v6h9"/></>,
    trace: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/><path d="m3 7 6-4 6 7 6-5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    play: <path d="m8 5 11 7-11 7Z"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    spark: <><path d="m12 3 1.2 4.8L18 9l-4.8 1.2L12 15l-1.2-4.8L6 9l4.8-1.2Z"/><path d="m19 15 .6 2.4L22 18l-2.4.6L19 21l-.6-2.4L16 18l2.4-.6Z"/></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
    person: <><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></>,
    document: <><path d="M6 2h8l4 4v16H6Z"/><path d="M14 2v5h5M9 13h6M9 17h6"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>
  };

  return (
    <svg aria-hidden="true" className="app-icon" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{paths[name]}</g>
    </svg>
  );
}

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
  const workspaceContentRef = useRef<HTMLDivElement | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>("map");
  const [showIngestPanel, setShowIngestPanel] = useState(false);
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
    workspaceContentRef.current?.scrollTo({ top: 0 });
  }, [activeView]);

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

  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
  const traceQuestions = messages.filter((message) => message.role === "user");
  const activeNode = graph.nodes.find((node) => node.highlighted) ?? graph.nodes[0] ?? null;
  const totalChunks = displayLibraryItems.reduce((sum, item) => sum + item.chunkCount, 0);
  const navItems: Array<{ id: WorkspaceView; label: string; icon: IconName }> = [
    { id: "map", label: "Knowledge Map", icon: "map" },
    { id: "sources", label: "Data Sources", icon: "database" },
    { id: "schema", label: "Schema Builder", icon: "schema" },
    { id: "traces", label: "Trace Logs", icon: "trace" },
    { id: "settings", label: "Settings", icon: "settings" }
  ];

  function renderModeControl() {
    return (
      <div className="mode-control" aria-label="Retrieval mode">
        {(["hybrid", "vector", "graph"] as RetrievalMode[]).map((mode) => (
          <button
            className={retrievalMode === mode ? "is-active" : ""}
            key={mode}
            onClick={() => setRetrievalMode(mode)}
            type="button"
          >
            {mode}
          </button>
        ))}
      </div>
    );
  }

  function renderComposer(compact = false) {
    return (
      <form className={`query-composer ${compact ? "query-composer-compact" : ""}`} onSubmit={handleSubmit}>
        <div className="query-input-row">
          <span className="composer-plus"><AppIcon name="plus" size={18} /></span>
          <textarea
            aria-label="Ask a hybrid retrieval question"
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about a project, person, or concept..."
            value={question}
          />
          <span className="composer-mode">{retrievalMode}</span>
          <button className="primary-icon-button" disabled={!canSubmitQuestion} type="submit">
            <AppIcon name="arrow" size={20} />
            <span className="sr-only">Ask InsightGraph</span>
          </button>
        </div>
        {!compact ? (
          <div className="prompt-chips">
            {quickQuestions.map((prompt) => (
              <button key={prompt} onClick={() => applySuggestedQuestion(prompt)} type="button">
                {prompt.length > 42 ? `${prompt.slice(0, 42)}...` : prompt}
              </button>
            ))}
          </div>
        ) : null}
      </form>
    );
  }

  function renderEvidenceInspector() {
    return (
      <aside className="inspector-panel">
        <div className="inspector-heading">
          <div>
            <span className="technical-label">Selected entity</span>
            <h2>{activeNode?.label ?? "Awaiting query"}</h2>
          </div>
          <span className="type-badge">{activeNode?.type ?? "ENTITY"}</span>
        </div>
        <div className="inspector-meta">
          Node ID: {activeNode?.id ?? "Run a query to inspect a node"}
        </div>
        <div className="inspector-section">
          <h3><AppIcon name="document" size={16} /> Semantic Evidence</h3>
          {latestSources.length > 0 ? latestSources.slice(0, 3).map((source) => (
            <article className="evidence-block" key={source.id}>
              <p>{source.content.slice(0, 210)}{source.content.length > 210 ? "..." : ""}</p>
              <footer>
                <span>{source.title || source.sourceId}</span>
                <strong>{Math.round(source.similarity * 100)}%</strong>
              </footer>
            </article>
          )) : <p className="empty-copy">Semantic matches appear here after a vector or hybrid query.</p>}
        </div>
        <div className="inspector-section">
          <h3><AppIcon name="schema" size={16} /> Graph Paths</h3>
          {graph.paths.length > 0 ? graph.paths.map((path, index) => (
            <div className="path-trace" key={`${path.nodes.join("-")}-${index}`}>
              {path.nodes.map((node, nodeIndex) => (
                <span key={`${node}-${nodeIndex}`}>
                  <strong>{node}</strong>
                  {path.relationships[nodeIndex] ? <><i>→</i><em>{path.relationships[nodeIndex]}</em><i>→</i></> : null}
                </span>
              ))}
            </div>
          )) : <p className="empty-copy">Relationship paths will appear when named entities connect.</p>}
        </div>
        <div className="trace-terminal">
          <div><span>Latest Trace</span><strong>{pending ? "RUNNING" : "200 OK"}</strong></div>
          <pre>{JSON.stringify({ mode: retrievalMode, nodes: graphStats.nodes, edges: graphStats.links, sources: latestSources.length }, null, 2)}</pre>
        </div>
      </aside>
    );
  }

  function renderMapView() {
    return (
      <div className="map-view">
        <section className="graph-stage">
          <div className="graph-toolbar">
            <button aria-label="Search graph" type="button"><AppIcon name="search" size={17} /></button>
            <button aria-label="Center graph" type="button"><AppIcon name="map" size={17} /></button>
            <span>{graphStats.nodes} nodes · {graphStats.links} edges</span>
          </div>
          <div className="graph-live"><span /> {useMockAi ? "Local Graph" : "Graph Live"}</div>
          <KnowledgeMap graph={graph} />
          <div className="map-composer-wrap">{renderComposer()}</div>
        </section>
        {renderEvidenceInspector()}
      </div>
    );
  }

  function renderQueryView() {
    return (
      <div className="query-view">
        <section className="query-main">
          <div className="view-heading compact-heading">
            <div><span className="technical-label">Cypher / semantic workspace</span><h1>Query Engine</h1></div>
            <span className={`health-chip ${pending ? "is-running" : ""}`}>{pending ? "Retrieving" : "Syntax Ready"}</span>
          </div>
          <div className="conversation-stream">
            {messages.map((message) => (
              <article className={`conversation-message is-${message.role}`} key={message.id}>
                <span className="message-avatar"><AppIcon name={message.role === "user" ? "person" : "spark"} size={18} /></span>
                <div>
                  <span className="technical-label">{message.role === "user" ? "Prompt" : "InsightGraph"}</span>
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                  {message.sources?.length ? <div className="source-tags">{message.sources.map((source) => <span key={source.id}>{source.title || source.sourceId} · {Math.round(source.similarity * 100)}%</span>)}</div> : null}
                </div>
              </article>
            ))}
          </div>
          <div className="query-footer">
            {renderModeControl()}
            {renderComposer(true)}
            <p>{cooldownRemaining > 0 ? `Ready again in ${cooldownSeconds}s` : describeRetrievalMode(retrievalMode)}</p>
          </div>
        </section>
        <aside className="prompt-studio">
          <div className="section-bar"><h2><AppIcon name="spark" size={18} /> Prompt Studio</h2><span>AI Assisted</span></div>
          <div className="prompt-studio-body">
            <span className="technical-label">Suggested prompts</span>
            {quickQuestions.map((prompt) => (
              <button key={prompt} onClick={() => setQuestion(prompt)} type="button">
                <AppIcon name="spark" size={16} /><span>{prompt}</span>
              </button>
            ))}
          </div>
          <div className="query-results-mini">
            <span className="technical-label">Current result</span>
            <p>{latestAssistantMessage?.content.slice(0, 420) ?? "Run a query to see the generated answer and evidence trace."}</p>
            <div className="mini-stats"><span>{latestSources.length} sources</span><span>{graphStats.nodes} nodes</span><span>{graphStats.paths} paths</span></div>
          </div>
        </aside>
      </div>
    );
  }

  function renderIngestionPanel() {
    return (
      <form className="ingestion-drawer" onSubmit={handleIngest}>
        <div className="drawer-heading">
          <div><span className="technical-label">New source</span><h2>Ingestion Console</h2></div>
          <button aria-label="Close ingestion console" onClick={() => setShowIngestPanel(false)} type="button">×</button>
        </div>
        <div className="preset-row">
          {demoSources.map((demoSource) => <button key={demoSource.sourceId} onClick={() => loadDemoSource(demoSource.sourceId)} type="button">{demoSource.title}</button>)}
        </div>
        <div className="form-grid">
          <label><span>Source ID</span><input onChange={(event) => { setSourceIdTouched(true); setSourceId(event.target.value); }} placeholder="auto-generated" value={sourceId} /></label>
          <label><span>Title</span><input onChange={(event) => { const nextTitle = event.target.value; setSourceTitleTouched(true); setSourceTitle(nextTitle); if (!sourceIdTouched) setSourceId(makeUniqueSourceId(nextTitle, displayLibraryItems.map((item) => item.sourceId))); }} placeholder="Document title" value={sourceTitle} /></label>
          <label><span>Source type</span><select onChange={(event) => setSourceType(event.target.value)} value={sourceType}><option value="article">Article</option><option value="data">Data</option><option value="pdf">PDF</option><option value="memo">Memo</option><option value="notes">Notes</option></select></label>
        </div>
        <div className="article-row">
          <label><span>Article URL</span><input onChange={(event) => setArticleUrl(event.target.value)} placeholder="https://example.com/article" value={articleUrl} /></label>
          <button disabled={articleLoading || !articleUrl.trim()} onClick={() => void handleArticleLoad()} type="button">{articleLoading ? "Loading" : "Load"}</button>
        </div>
        <label className="source-file-picker">
          <input accept=".pdf,.txt,.md,.csv,.json" onChange={(event) => void handleFileSelected(event.target.files?.[0] ?? null)} type="file" />
          <AppIcon name="document" size={20} /><span>{selectedFileName ?? "Choose PDF, TXT, MD, CSV, or JSON"}</span>
        </label>
        <label className="raw-text-field"><span>Raw text</span><textarea aria-label="Raw document text for ingestion" onChange={(event) => { const nextText = event.target.value; setDocumentText(nextText); applyAutoDerivedFields(nextText, sourceTitle); }} placeholder="Paste source text here..." value={documentText} /></label>
        {ingestResult ? <div className="ingest-summary"><span>{ingestResult.chunkCount} chunks</span><span>{ingestResult.entityCount} entities</span><span>{ingestResult.tripletCount} triplets</span></div> : null}
        {ingestError ? <div className="inline-error">{ingestError}</div> : null}
        <button className="primary-button" disabled={ingesting || !sourceId.trim() || !documentText.trim()} type="submit">{ingesting ? "Ingesting..." : useMockAi ? "Ingest Locally" : "Ingest Source"}</button>
      </form>
    );
  }

  function renderSourcesView() {
    return (
      <div className="sources-view">
        <div className="view-heading">
          <div><h1>Data Sources</h1><p>Manage documents, structured data, and APIs feeding the semantic engine.</p></div>
          <button className="primary-button" onClick={() => setShowIngestPanel(true)} type="button"><AppIcon name="plus" size={18} /> Add Source</button>
        </div>
        <div className="source-metrics">
          <div><span>Total Sources</span><strong>{displayLibraryItems.length}</strong></div>
          <div><span>Active Chunks</span><strong>{totalChunks}</strong></div>
          <div><span>Graph Entities</span><strong>{ingestResult?.entityCount ?? graphStats.nodes}</strong></div>
          <div><span>Pipeline Mode</span><strong>{useMockAi ? "Local" : "Live"}</strong></div>
        </div>
        <div className={`sources-layout ${showIngestPanel ? "has-drawer" : ""}`}>
          <section className="source-table">
            <div className="source-table-head"><span>Source document</span><span>Type</span><span>Status</span><span>Chunks</span><span>Updated</span></div>
            {displayLibraryItems.length > 0 ? displayLibraryItems.map((item) => (
              <button className={currentLibrarySourceId === item.sourceId ? "is-selected" : ""} key={item.sourceId} onClick={() => { setSelectedLibrarySourceId(item.sourceId); if (!useMockAi) void loadRemoteLibraryDetail(item.sourceId); }} type="button">
                <span className="source-name"><AppIcon name="document" size={19} /><span><strong>{item.title || item.sourceId}</strong><small>ID: {item.sourceId}</small></span></span>
                <span className="type-badge">{item.sourceType ?? "text"}</span>
                <span className="sync-status"><i /> Synced</span>
                <strong>{item.chunkCount}</strong>
                <span>{new Date(item.latestIngestedAt).toLocaleDateString()}</span>
              </button>
            )) : <div className="source-empty"><AppIcon name="database" size={32} /><h3>No sources in this workspace</h3><p>{libraryPending ? "Checking the connected library..." : "Add a source or switch to Mock AI and seed the local demo."}</p></div>}
            {libraryDetailPending ? <div className="source-loading">Loading selected source...</div> : null}
            {libraryError && !useMockAi ? <div className="inline-error">The live source library is unavailable. Switch to Mock AI to continue exploring locally.</div> : null}
            {libraryDetailError && !useMockAi ? <div className="inline-error">The selected source could not be loaded. Refresh the library and try again.</div> : null}
          </section>
          {showIngestPanel ? renderIngestionPanel() : null}
        </div>
        {displayLibraryDetail && !showIngestPanel ? (
          <section className="source-detail-strip">
            <div><span className="technical-label">Selected source</span><h2>{displayLibraryDetail.source.title || displayLibraryDetail.source.sourceId}</h2></div>
            <div><div className="source-tags">{displayLibraryDetail.chunks.flatMap((chunk) => chunk.entityNames).slice(0, 8).map((name) => <span key={name}>{name}</span>)}</div><div className="source-tags prompt-source-tags">{suggestedQuestions.slice(0, 1).map((prompt) => <button key={prompt} onClick={() => { applySuggestedQuestion(prompt); setActiveView("query"); }} type="button">{prompt}</button>)}</div></div>
            <div className="source-detail-actions"><button onClick={() => void loadSourceIntoForm(displayLibraryDetail.source.sourceId)} type="button">Edit source</button><button onClick={() => { setActiveChatSourceId(displayLibraryDetail.source.sourceId); setActiveView("query"); }} type="button">Use in query <AppIcon name="arrow" size={16} /></button></div>
          </section>
        ) : null}
      </div>
    );
  }

  function renderSchemaView() {
    const inferredTypes = Array.from(new Set(graph.nodes.map((node) => node.type || "Entity")));
    const schemaTypes = inferredTypes.length ? inferredTypes : ["Person", "Organization", "Project", "Concept"];
    return (
      <div className="schema-view">
        <section className="schema-list">
          <div className="section-bar"><h2>Node Entities</h2><button type="button"><AppIcon name="plus" size={18} /></button></div>
          {schemaTypes.map((type, index) => <button className={index === 0 ? "is-active" : ""} key={type} type="button"><AppIcon name={type.toLowerCase().includes("person") ? "person" : "schema"} /><span><strong>{type}</strong><small>{graph.nodes.filter((node) => (node.type || "Entity") === type).length || "Simulated"} nodes</small></span></button>)}
        </section>
        <section className="schema-canvas"><div className="schema-node"><AppIcon name="person" /><strong>{schemaTypes[0]}</strong><span>{graphStats.links} edges</span></div><div className="schema-node secondary"><AppIcon name="schema" /><strong>{schemaTypes[1] ?? "Organization"}</strong><span>related</span></div><svg aria-hidden="true"><line x1="35%" x2="65%" y1="50%" y2="50%" /></svg></section>
        <aside className="schema-properties"><div className="section-bar"><h2>{schemaTypes[0]}</h2><span>Node</span></div><label><span>Property name</span><input readOnly value="id" /><small>UUID · Primary key</small></label><label><span>Property name</span><input readOnly value="name" /><small>String · Indexed</small></label><label><span>Property name</span><input readOnly value="type" /><small>Enum</small></label><button className="outline-button" type="button"><AppIcon name="plus" size={16} /> Add property</button><p>This schema is inferred from the active graph. Editing is simulated until a schema persistence API is connected.</p></aside>
      </div>
    );
  }

  function renderTracesView() {
    return (
      <div className="traces-view">
        <div className="view-heading"><div><h1>Pipeline Traces</h1><p>Real-time inspection of retrieval augmented generation paths.</p></div><span className="health-chip"><i /> Live Feed Active</span></div>
        <div className="trace-metrics"><div><span>Queries</span><strong>{traceQuestions.length}</strong></div><div><span>Evidence Returned</span><strong>{latestSources.length}</strong></div><div><span>Graph Nodes</span><strong>{graphStats.nodes}</strong></div><div><span>Error State</span><strong>{statusVariant === "error" ? "1" : "0"}</strong></div></div>
        <div className="trace-layout">
          <aside className="trace-list"><div className="section-bar"><h2>Recent Queries</h2><AppIcon name="history" size={18} /></div>{traceQuestions.length ? traceQuestions.map((message, index) => <article className={index === traceQuestions.length - 1 ? "is-active" : ""} key={message.id}><div><span>REQ-{message.id.slice(0, 8)}</span><strong>200 OK</strong></div><p>{message.content}</p><small>{retrievalMode} · {graphStats.nodes} nodes</small></article>) : <div className="source-empty"><p>No query traces yet. Ask a question in the Query Engine.</p></div>}</aside>
          <section className="trace-detail"><div className="trace-detail-head"><div><span className="technical-label">Latest trace</span><h2>{traceQuestions.at(-1)?.content ?? "No query selected"}</h2></div><strong>{pending ? "Running" : "200 OK"}</strong></div><ol><li><span><AppIcon name="person" /></span><div><h3>User input received</h3><pre>{JSON.stringify({ source: effectiveActiveChatSourceId ?? "all", mode: retrievalMode }, null, 2)}</pre></div></li><li><span><AppIcon name="search" /></span><div><h3>Vector semantic search</h3><pre>{JSON.stringify(latestSources.slice(0, 3).map((source) => ({ source: source.sourceId, score: source.similarity.toFixed(2) })), null, 2)}</pre></div></li><li><span><AppIcon name="schema" /></span><div><h3>Graph traversal and expansion</h3><pre>{JSON.stringify({ nodes: graphStats.nodes, edges: graphStats.links, paths: graphStats.paths }, null, 2)}</pre></div></li><li><span><AppIcon name="spark" /></span><div><h3>Context synthesis</h3><p>{latestAssistantMessage?.content.slice(0, 320) ?? "Awaiting a completed query."}</p></div></li></ol></section>
        </div>
      </div>
    );
  }

  function renderSettingsView() {
    return (
      <div className="settings-view">
        <div className="view-heading"><div><h1>Workspace Configuration</h1><p>Manage AI behavior, fallback mode, and connected data services.</p></div></div>
        <div className="settings-grid">
          <section><div className="section-bar"><h2><AppIcon name="spark" /> AI Engine</h2></div><span className="technical-label">Inference path</span><div className="provider-options"><button className={!useMockAi ? "is-active" : ""} onClick={() => setUseMockAi(false)} type="button"><strong>Gemini + cloud stores</strong><span>Production connector path</span></button><button className={useMockAi ? "is-active" : ""} onClick={() => setUseMockAi(true)} type="button"><strong>Local simulation</strong><span>Private, free, deterministic</span></button></div><div className="settings-action-row"><button className="primary-button" onClick={() => { setUseMockAi(true); seedMockWorkspace(); }} type="button">Seed local workspace</button>{useMockAi ? <button className="outline-button" onClick={clearMockWorkspace} type="button">Clear local data</button> : null}</div></section>
          <aside><div className="section-bar"><h2><AppIcon name="settings" /> Preferences</h2></div><label className="toggle-row"><span><strong>Graph animations</strong><small>Animate retrieved relationships.</small></span><input defaultChecked type="checkbox" /></label><label className="toggle-row"><span><strong>Technical trace</strong><small>Show retrieval metadata.</small></span><input defaultChecked type="checkbox" /></label><label className="toggle-row"><span><strong>Local fallback</strong><small>Keep mock workspace available.</small></span><input defaultChecked type="checkbox" /></label></aside>
          <section className="connection-settings"><div className="section-bar"><h2><AppIcon name="database" /> Data Topology</h2></div><div className="connection-row"><span className="connection-mark">N4J</span><div><strong>Neo4j AuraDB</strong><small>Relationship graph</small></div><em>{useMockAi ? "Simulated" : "Connected"}</em></div><div className="connection-row"><span className="connection-mark supabase">SUP</span><div><strong>Supabase pgvector</strong><small>Semantic document store</small></div><em>{useMockAi ? "Simulated" : "Connected"}</em></div></section>
          <section className="free-tools"><div className="section-bar"><h2>Free AI alternatives</h2></div>{freeAiToolkit.map((tool) => <Link href={tool.href} key={tool.name} rel="noreferrer" target="_blank"><div><strong>{tool.name}</strong><span>{tool.mode}</span></div><p>{tool.blurb}</p></Link>)}</section>
        </div>
      </div>
    );
  }

  function renderActiveView() {
    if (activeView === "query") return renderQueryView();
    if (activeView === "sources") return renderSourcesView();
    if (activeView === "schema") return renderSchemaView();
    if (activeView === "traces") return renderTracesView();
    if (activeView === "settings") return renderSettingsView();
    return renderMapView();
  }

  return (
    <main className="workspace-shell">
      <aside className="side-nav">
        <button className="brand-button" onClick={() => setActiveView("map")} type="button">
          <Image alt="InsightGraph logo" height={42} priority src="/insightgraph-logo.jpeg" width={42} />
          <span><strong>InsightGraph</strong><small>V0.2 AI-Native</small></span>
        </button>
        <button className="new-workspace-button" onClick={() => { setActiveView("sources"); setShowIngestPanel(true); }} type="button"><AppIcon name="plus" size={18} /> New Workspace</button>
        <nav aria-label="Workspace navigation">
          {navItems.map((item) => <button aria-current={activeView === item.id ? "page" : undefined} aria-label={item.label} className={activeView === item.id ? "is-active" : ""} key={item.id} onClick={() => setActiveView(item.id)} type="button"><AppIcon name={item.icon} /><span>{item.label}</span></button>)}
        </nav>
        <div className="side-nav-footer">
          <button onClick={() => setActiveView("settings")} type="button"><AppIcon name="document" size={18} /> Documentation</button>
          <div className="user-chip"><span>EA</span><div><strong>Workspace Admin</strong><small>{useMockAi ? "Local simulation" : "Production mode"}</small></div></div>
        </div>
      </aside>
      <section className="workspace-main">
        <header className="top-nav">
          <label className="workspace-search"><AppIcon name="search" size={18} /><input aria-label="Search current workspace" placeholder={activeView === "sources" ? "Search sources..." : "Search map..."} /></label>
          <nav aria-label="Primary workspace views">
            <button className={activeView === "map" ? "is-active" : ""} onClick={() => setActiveView("map")} type="button">Visualizer</button>
            <button className={activeView === "query" ? "is-active" : ""} onClick={() => setActiveView("query")} type="button">Query Engine</button>
            <button className={activeView === "traces" ? "is-active" : ""} onClick={() => setActiveView("traces")} type="button">History</button>
          </nav>
          <div className="top-actions">
            <button className="deploy-button" onClick={() => setActiveView("map")} type="button"><AppIcon name="play" size={16} /> Deploy Map</button>
            <span className={`mode-indicator ${useMockAi ? "is-mock" : ""}`}><i /> {useMockAi ? "Mock AI" : "Live AI"}</span>
          </div>
        </header>
        <div className={`system-banner ${statusVariant === "error" ? "is-error" : ""}`}><span>{statusText}</span>{statusVariant === "error" && !useMockAi ? <button onClick={() => setUseMockAi(true)} type="button">Switch to Mock AI</button> : null}</div>
        <div className="workspace-content" ref={workspaceContentRef}>{renderActiveView()}</div>
      </section>
    </main>
  );
}
