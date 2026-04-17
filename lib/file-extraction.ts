import { PDFParse } from "pdf-parse";

export type ExtractedFilePayload = {
  fileName: string;
  title: string;
  sourceId: string;
  sourceType: string;
  text: string;
};

function slugifySourceId(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function inferSourceTypeFromName(fileName: string) {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".pdf")) {
    return "pdf";
  }
  if (lowerName.endsWith(".md")) {
    return "notes";
  }
  if (lowerName.endsWith(".csv")) {
    return "data";
  }
  if (lowerName.endsWith(".json")) {
    return "memo";
  }
  return "article";
}

function extractJsonText(rawText: string) {
  try {
    const parsed = JSON.parse(rawText) as
      | { text?: unknown; content?: unknown; body?: unknown }
      | Array<unknown>;

    if (!Array.isArray(parsed)) {
      const candidate = [parsed.text, parsed.content, parsed.body].find(
        (value) => typeof value === "string" && value.trim().length > 0
      );
      if (typeof candidate === "string") {
        return candidate;
      }
    }
  } catch {
    return rawText;
  }

  return rawText;
}

export async function extractTextFromUploadedFile(file: File) {
  const lowerName = file.name.toLowerCase();
  let text = "";

  if (lowerName.endsWith(".pdf")) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse({ data: buffer });

    try {
      const result = await parser.getText();
      text = result.text;
    } finally {
      await parser.destroy();
    }
  } else {
    const rawText = await file.text();
    text = lowerName.endsWith(".json") ? extractJsonText(rawText) : rawText;
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error("The uploaded file did not contain readable text.");
  }

  const title = file.name.replace(/\.[^.]+$/, "");

  return {
    fileName: file.name,
    title,
    sourceId: slugifySourceId(title) || "uploaded-source",
    sourceType: inferSourceTypeFromName(file.name),
    text: trimmedText
  } satisfies ExtractedFilePayload;
}
