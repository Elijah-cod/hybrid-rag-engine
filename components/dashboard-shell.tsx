"use client";

import { FormEvent, startTransition, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { KnowledgeMap } from "@/components/knowledge-map";
import type {
  ChatApiResponse,
  ChatMessage,
  GraphPayload,
  IngestionResult,
  ReadinessResponse,
  RetrievalMode,
  RetrievedSource,
  SourceLibraryDetail,
  SourceLibraryItem
} from "@/lib/types";

const MIN_REQUEST_INTERVAL_MS = 4_500;

const starterMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Ask about a project, person, or concept. I’ll blend semantic retrieval from Supabase with graph relationships from Neo4j so you can inspect both the answer and the path behind it."
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

function slugifySourceId(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function DashboardShell() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [statusText, setStatusText] = useState("Warmup ping ready.");
  const [statusVariant, setStatusVariant] = useState<"default" | "error">("default");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [graph, setGraph] = useState<GraphPayload>(initialGraph);
  const [sourceId, setSourceId] = useState("strategy-memo");
  const [sourceTitle, setSourceTitle] = useState("Strategy Memo");
  const [sourceType, setSourceType] = useState("article");
  const [articleUrl, setArticleUrl] = useState("");
  const [documentText, setDocumentText] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestionResult | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [latestSources, setLatestSources] = useState<RetrievedSource[]>([]);
  const [libraryItems, setLibraryItems] = useState<SourceLibraryItem[]>([]);
  const [libraryPending, setLibraryPending] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedLibrarySourceId, setSelectedLibrarySourceId] = useState<string | null>(null);
  const [selectedLibraryDetail, setSelectedLibraryDetail] = useState<SourceLibraryDetail | null>(null);
  const [libraryDetailPending, setLibraryDetailPending] = useState(false);
  const [libraryDetailError, setLibraryDetailError] = useState<string | null>(null);
  const [activeChatSourceId, setActiveChatSourceId] = useState<string | null>(null);
  const [retrievalMode, setRetrievalMode] = useState<RetrievalMode>("hybrid");
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [readinessPending, setReadinessPending] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [useMockAi, setUseMockAi] = useState(false);

  useEffect(() => {
    startTransition(() => {
      fetch("/api/health")
        .then(() => {
          setStatusVariant("default");
          setStatusText("Backend is awake and ready.");
        })
        .catch(() => {
          setStatusVariant("error");
          setStatusText("Warmup ping failed. The first real request may be slower.");
        });
    });
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, []);

  useEffect(() => {
    if (cooldownUntil <= now) {
      return;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => window.clearInterval(timer);
  }, [cooldownUntil, now]);

  const cooldownRemaining = Math.max(0, cooldownUntil - now);
  const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);

  const graphStats = useMemo(
    () => ({
      nodes: graph.nodes.length,
      links: graph.links.length,
      paths: graph.paths.length
    }),
    [graph]
  );

  const suggestedQuestions = useMemo(() => {
    if (!selectedLibraryDetail) {
      return [];
    }

    const sourceLabel =
      selectedLibraryDetail.source.title || selectedLibraryDetail.source.sourceId;
    const entities = selectedLibraryDetail.chunks.flatMap((chunk) => chunk.entityNames).slice(0, 3);

    return [
      `Summarize the key themes in ${sourceLabel}.`,
      `Which people, teams, or programs are most connected in ${sourceLabel}?`,
      entities.length >= 2
        ? `How is ${entities[0]} related to ${entities[1]} in ${sourceLabel}?`
        : `What relationships stand out in ${sourceLabel}?`
    ];
  }, [selectedLibraryDetail]);

  async function loadLibrary() {
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

      const successPayload = payload as { sources: SourceLibraryItem[] };
      setLibraryItems(successPayload.sources);
      if (!selectedLibrarySourceId && successPayload.sources.length > 0) {
        const firstSourceId = successPayload.sources[0].sourceId;
        setSelectedLibrarySourceId(firstSourceId);
        void loadLibraryDetail(firstSourceId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected library error.";
      setLibraryError(message);
    } finally {
      setLibraryPending(false);
    }
  }

  async function loadLibraryDetail(sourceIdToLoad: string) {
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

      setSelectedLibraryDetail(payload as SourceLibraryDetail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected library detail error.";
      setLibraryDetailError(message);
    } finally {
      setLibraryDetailPending(false);
    }
  }

  async function runReadinessCheck() {
    setReadinessPending(true);
    setReadinessError(null);

    try {
      const response = await fetch("/api/readiness");
      const payload = (await response.json()) as ReadinessResponse | { error?: string };

      if (!response.ok && !("status" in payload)) {
        throw new Error(
          "error" in payload && payload.error ? payload.error : "Readiness check failed unexpectedly."
        );
      }

      if (!("status" in payload)) {
        throw new Error("Readiness response was malformed.");
      }

      setReadiness(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected readiness check error.";
      setReadinessError(message);
    } finally {
      setReadinessPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = question.trim();
    if (!trimmed || pending) {
      return;
    }

    if (cooldownRemaining > 0) {
      setStatusVariant("error");
      setStatusText(`Cooling down to avoid Gemini rate limits. Try again in ${cooldownSeconds}s.`);
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
      activeChatSourceId
        ? `${describeRetrievalMode(retrievalMode)} Source scope: ${activeChatSourceId}.`
        : describeRetrievalMode(retrievalMode)
    );
    setMessages((current) => [...current, userMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question: trimmed,
          sourceId: activeChatSourceId,
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

      const successPayload = payload as ChatApiResponse;

      startTransition(() => {
        setGraph(successPayload.graph);
        setLatestSources(successPayload.sources);
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: successPayload.answer,
            sources: successPayload.sources
          }
        ]);
        setStatusText(
          activeChatSourceId
            ? `Answer ready using ${successPayload.retrievalMode} mode for ${activeChatSourceId}. The graph panel reflects the retrieved entities and paths.`
            : `Answer ready using ${successPayload.retrievalMode} mode. The graph panel reflects the retrieved entities and paths.`
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
          content: `I couldn't complete the hybrid retrieval request.\n\n${message}`
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
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceId: trimmedSourceId,
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

      const successPayload = payload as IngestionResult;
      setIngestResult(successPayload);
      setSelectedLibrarySourceId(successPayload.sourceId);
      void loadLibraryDetail(successPayload.sourceId);
      void loadLibrary();
      setStatusVariant("default");
      setStatusText(
        `Ingested ${successPayload.chunkCount} chunk${successPayload.chunkCount === 1 ? "" : "s"} into Supabase and Neo4j.`
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

      const payload = (await response.json()) as
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

      setSelectedFileName(successPayload.fileName);
      setSourceTitle(successPayload.title);
      setSourceId(successPayload.sourceId || slugifySourceId(successPayload.title) || "uploaded-source");
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

      const payload = (await response.json()) as
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

      setSelectedFileName(null);
      setSourceTitle(successPayload.title);
      setSourceId(successPayload.sourceId);
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

  function loadDemoSource(sourceIdToLoad: string) {
    const demoSource = demoSources.find((source) => source.sourceId === sourceIdToLoad);
    if (!demoSource) {
      return;
    }

    setSourceId(demoSource.sourceId);
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
    if (selectedLibraryDetail) {
      setActiveChatSourceId(selectedLibraryDetail.source.sourceId);
      setStatusVariant("default");
      setStatusText(
        `Prepared a scoped question for ${selectedLibraryDetail.source.sourceId}.`
      );
    }
  }

  function describeRetrievalMode(mode: RetrievalMode) {
    if (mode === "vector") {
      return "Retrieving semantic matches only and skipping graph traversal.";
    }
    if (mode === "graph") {
      return "Traversing the graph only and skipping vector search.";
    }
    return "Retrieving vector context, traversing graph paths, and synthesizing an answer.";
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-eyebrow">Hybrid RAG Dashboard</div>
        <h1>InsightGraph connects context to structure.</h1>
        <p>
          Semantic chunks explain what matters. Graph relationships reveal how ideas,
          people, and projects connect. This workspace lets both retrieval paths show up
          side by side so answers feel inspectable instead of magical.
        </p>
        <div className="top-controls">
          <button
            className={`mode-button ${useMockAi ? "mode-button-active" : ""}`}
            onClick={() => setUseMockAi((current) => !current)}
            type="button"
          >
            {useMockAi ? "Mock AI On" : "Mock AI Off"}
          </button>
          <span className="composer-hint">
            {useMockAi
              ? "Mock AI mode skips live Gemini calls so you can explore the app without quota."
              : "Live AI mode uses your Gemini key for ingestion and chat."}
          </span>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="panel chat-panel">
          <header className="panel-header">
            <div className="panel-title">
              <h2>Chat Interface</h2>
              <p>Ask a question that needs both evidence and relationships.</p>
            </div>
            <div className="badge">{pending ? "Retrieving..." : "Ready"}</div>
          </header>

          <div className="messages">
            {messages.map((message) => (
              <div
                className={`message ${
                  message.role === "user" ? "message-user" : "message-assistant"
                }`}
                key={message.id}
              >
                <div className="message-label">
                  {message.role === "user" ? "Question" : "Answer"}
                </div>
                <ReactMarkdown>{message.content}</ReactMarkdown>
                {message.sources && message.sources.length > 0 ? (
                  <div className="sources">
                    <strong>Retrieved sources</strong>
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
              <div className="mode-strip">
                {(["hybrid", "vector", "graph"] as RetrievalMode[]).map((mode) => (
                  <button
                    className={`mode-button ${retrievalMode === mode ? "mode-button-active" : ""}`}
                    key={mode}
                    onClick={() => setRetrievalMode(mode)}
                    type="button"
                  >
                    {mode}
                  </button>
                ))}
              </div>
              {activeChatSourceId ? (
                <div className="active-scope">
                  <span className="badge">Scoped to {activeChatSourceId}</span>
                  <button
                    className="ghost-button"
                    onClick={() => setActiveChatSourceId(null)}
                    type="button"
                  >
                    Remove Scope
                  </button>
                </div>
              ) : null}
              <textarea
                aria-label="Ask a hybrid retrieval question"
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="How is Project Atlas connected to the CEO's 2025 goals?"
                value={question}
              />
              <div className="composer-actions">
                <div className="composer-hint">
                  {pending
                    ? describeRetrievalMode(retrievalMode)
                    : cooldownRemaining > 0
                      ? `Rate-limit guard active for ${cooldownSeconds}s.`
                      : `Mode: ${retrievalMode}. AI: ${useMockAi ? "mock" : "live"}. The frontend applies a small cooldown to reduce 429s on the Gemini free tier.`}
                </div>
                <button className="submit-button" disabled={pending || cooldownRemaining > 0} type="submit">
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
              <p>Visualize the entities and relationships returned by retrieval.</p>
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
                  Shortest-path results will appear here when Neo4j finds a direct or near-direct connection.
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
                        <span>{(source.similarity * 100).toFixed(1)}% match</span>
                      </div>
                      <p>{source.content.slice(0, 180)}{source.content.length > 180 ? "..." : ""}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ingest-muted">
                  The top vector matches for the latest question will appear here after retrieval.
                </p>
              )}
            </div>
          </div>

          <div className="footnote">
            <div className="status-text" data-variant={statusVariant}>
              {statusText}
            </div>
          </div>
        </aside>
      </section>

      <section className="panel readiness-panel">
        <header className="panel-header">
          <div className="panel-title">
            <h2>Deployment Readiness</h2>
            <p>Run live connector checks before you deploy or right after the app goes live.</p>
          </div>
          <button className="ghost-button" onClick={() => void runReadinessCheck()} type="button">
            {readinessPending ? "Checking..." : "Run Readiness Check"}
          </button>
        </header>

        <div className="readiness-grid">
          <div className="readiness-summary">
            <div className="stat-card">
              <span>Overall</span>
              <strong>{readiness?.status ?? "idle"}</strong>
            </div>
            <div className="stat-card">
              <span>Checked</span>
              <strong>{readiness ? new Date(readiness.checkedAt).toLocaleTimeString() : "--:--"}</strong>
            </div>
          </div>

          <div className="readiness-list">
            {readiness?.checks.length ? (
              readiness.checks.map((check) => (
                <div className="readiness-card" key={check.name}>
                  <div className="readiness-card-header">
                    <strong>{check.name}</strong>
                    <span className={`readiness-pill readiness-pill-${check.status}`}>{check.status}</span>
                  </div>
                  <p>{check.message}</p>
                </div>
              ))
            ) : (
              <div className="readiness-card">
                <p>
                  Run the readiness check after setting production environment variables and applying the Supabase migration.
                </p>
              </div>
            )}
          </div>
        </div>

        {readinessError ? (
          <div className="footnote">
            <div className="status-text" data-variant="error">
              {readinessError}
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel ingest-panel">
        <header className="panel-header">
          <div className="panel-title">
            <h2>Ingestion Console</h2>
            <p>Seed the vector store and graph directly from raw text without exposing secrets in the client.</p>
          </div>
          <div className="badge">{ingesting ? "Seeding stores..." : "Ready to ingest"}</div>
        </header>

        <div className="ingest-grid">
          <form className="composer-shell ingest-form" onSubmit={handleIngest}>
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

            <div className="field-grid">
              <label className="field">
                <span>Source ID</span>
                <input onChange={(event) => setSourceId(event.target.value)} value={sourceId} />
              </label>
              <label className="field">
                <span>Title</span>
                <input onChange={(event) => setSourceTitle(event.target.value)} value={sourceTitle} />
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
                {articleLoading ? "Loading Article..." : "Load Article"}
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
                onChange={(event) => setDocumentText(event.target.value)}
                placeholder="Paste the extracted text from a PDF, article, or transcript here."
                value={documentText}
              />
            </label>

            <div className="composer-actions">
              <div className="composer-hint">
                {ingesting
                  ? "Chunking text, extracting entities, embedding chunks, and writing to both stores."
                  : useMockAi
                    ? "Mock AI mode uses deterministic local extraction and embeddings before writing to Neo4j and Supabase."
                    : "This route runs server-side so Neo4j and Supabase credentials never leave the backend."}
              </div>
              <button className="submit-button" disabled={ingesting || !sourceId.trim() || !documentText.trim()} type="submit">
                {ingesting ? "Ingesting..." : "Ingest Document"}
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
                  ? `${ingestResult.title || ingestResult.sourceId} was chunked, embedded, and seeded into Neo4j successfully.`
                  : "No documents ingested yet. Paste a sample source to populate the graph and vector index."}
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
                  <p className="ingest-muted">Entities extracted from the latest ingestion will appear here.</p>
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

            {ingestError ? <div className="status-text" data-variant="error">{ingestError}</div> : null}
          </div>
        </div>
      </section>

      <section className="panel library-panel">
        <header className="panel-header">
          <div className="panel-title">
            <h2>Source Library</h2>
            <p>Track ingested sources and recent document activity from the Supabase store.</p>
          </div>
          <button className="ghost-button" onClick={() => void loadLibrary()} type="button">
            {libraryPending ? "Refreshing..." : "Refresh Library"}
          </button>
        </header>

        <div className="library-grid">
          {libraryItems.length > 0 ? (
            <>
              <div className="library-list">
                {libraryItems.map((item) => (
                  <button
                    className={`library-card ${
                      selectedLibrarySourceId === item.sourceId ? "library-card-active" : ""
                    }`}
                    key={item.sourceId}
                    onClick={() => {
                      setSelectedLibrarySourceId(item.sourceId);
                      void loadLibraryDetail(item.sourceId);
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
                {selectedLibraryDetail ? (
                  <>
                    <div className="library-detail-card">
                      <h3>{selectedLibraryDetail.source.title || selectedLibraryDetail.source.sourceId}</h3>
                      <p>{selectedLibraryDetail.source.sourceId}</p>
                      <div className="library-meta">
                        <span>{selectedLibraryDetail.source.sourceType || "unknown type"}</span>
                        <span>
                          {new Date(selectedLibraryDetail.source.latestIngestedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="library-actions">
                        <button
                          className="ghost-button"
                          onClick={() =>
                            setActiveChatSourceId((current) =>
                              current === selectedLibraryDetail.source.sourceId
                                ? null
                                : selectedLibraryDetail.source.sourceId
                            )
                          }
                          type="button"
                        >
                          {activeChatSourceId === selectedLibraryDetail.source.sourceId
                            ? "Clear Chat Scope"
                            : "Use In Chat"}
                        </button>
                      </div>
                    </div>

                    <div className="library-detail-card">
                      <h3>Suggested questions</h3>
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
                        {selectedLibraryDetail.chunks.map((chunk) => (
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
                        : "Select a source to inspect its latest chunks and extracted entity names."}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="library-empty">
              <p>
                {libraryPending
                  ? "Loading ingested sources..."
                  : "No library items yet. Ingest a document and it will appear here."}
              </p>
            </div>
          )}
        </div>

        {libraryError ? (
          <div className="footnote">
            <div className="status-text" data-variant="error">
              {libraryError}
            </div>
          </div>
        ) : null}

        {libraryDetailError ? (
          <div className="footnote">
            <div className="status-text" data-variant="error">
              {libraryDetailError}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
