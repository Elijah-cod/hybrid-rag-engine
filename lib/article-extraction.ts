import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export type ExtractedArticlePayload = {
  url: string;
  title: string;
  sourceId: string;
  sourceType: "article";
  text: string;
};

function slugifySourceId(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function extractArticleFromUrl(url: string) {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new Error("An article URL is required.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error("The article URL is not valid.");
  }

  const response = await fetch(parsedUrl.toString(), {
    headers: {
      "User-Agent": "InsightGraphBot/1.0 (+https://example.com)"
    }
  });

  if (!response.ok) {
    throw new Error(`Article request failed with ${response.status}.`);
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url: parsedUrl.toString() });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const rawText =
    article?.textContent ||
    dom.window.document.body?.textContent ||
    "";

  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) {
    throw new Error("The article page did not contain readable text.");
  }

  const title = (article?.title || dom.window.document.title || parsedUrl.hostname).trim();

  return {
    url: parsedUrl.toString(),
    title,
    sourceId: slugifySourceId(title) || slugifySourceId(parsedUrl.hostname) || "article-source",
    sourceType: "article",
    text
  } satisfies ExtractedArticlePayload;
}
