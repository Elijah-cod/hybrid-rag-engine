"use client";

import { FormEvent, startTransition, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { KnowledgeMap } from "@/components/knowledge-map";
import type { ChatApiResponse, ChatMessage, GraphPayload } from "@/lib/types";

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

export function DashboardShell() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [statusText, setStatusText] = useState("Warmup ping ready.");
  const [statusVariant, setStatusVariant] = useState<"default" | "error">("default");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [graph, setGraph] = useState<GraphPayload>(initialGraph);

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
    setStatusText("Retrieving vector context, traversing graph paths, and synthesizing an answer.");
    setMessages((current) => [...current, userMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ question: trimmed })
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
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: successPayload.answer,
            sources: successPayload.sources
          }
        ]);
        setStatusText("Answer ready. The graph panel reflects the retrieved entities and paths.");
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
              <textarea
                aria-label="Ask a hybrid retrieval question"
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="How is Project Atlas connected to the CEO's 2025 goals?"
                value={question}
              />
              <div className="composer-actions">
                <div className="composer-hint">
                  {pending
                    ? "Working through vector search, graph traversal, and synthesis."
                    : cooldownRemaining > 0
                      ? `Rate-limit guard active for ${cooldownSeconds}s.`
                      : "The frontend applies a small cooldown to reduce 429s on the Gemini free tier."}
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

          <div className="footnote">
            <div className="status-text" data-variant={statusVariant}>
              {statusText}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
