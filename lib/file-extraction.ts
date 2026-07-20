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

function parseCsvRows(rawText: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < rawText.length; index += 1) {
    const character = rawText[index];
    const nextCharacter = rawText[index + 1];

    if (character === '"' && quoted && nextCharacter === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

function extractCsvText(rawText: string) {
  const rows = parseCsvRows(rawText);
  const headers = rows[0]?.map((header) => header.toLowerCase().replace(/\s+/g, "_"));
  const narrativeHeaders = ["relationship_statement", "text", "content", "description", "summary", "notes"];
  const narrativeIndex = narrativeHeaders
    .map((header) => headers?.indexOf(header) ?? -1)
    .find((index) => index >= 0);

  if (narrativeIndex === undefined) {
    return rawText;
  }

  const narrative = rows
    .slice(1)
    .map((csvRow) => csvRow[narrativeIndex]?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return narrative || rawText;
}

export async function extractTextFromUploadedFile(file: File) {
  const lowerName = file.name.toLowerCase();
  let text = "";

  if (lowerName.endsWith(".pdf")) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse({ data: buffer });

    try {
      try {
        const result = await parser.getText();
        text = result.text;
      } catch {
        throw new Error(
          "This PDF could not be read automatically. If it is scanned or image-based, paste extracted text into the raw text box instead."
        );
      }
    } finally {
      await parser.destroy();
    }
  } else {
    const rawText = await file.text();
    if (lowerName.endsWith(".json")) {
      text = extractJsonText(rawText);
    } else if (lowerName.endsWith(".csv")) {
      text = extractCsvText(rawText);
    } else {
      text = rawText;
    }
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error(
      "The uploaded file did not contain readable text. If this is a scanned PDF, paste OCR text into the raw text box instead."
    );
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
