type ChunkingOptions = {
  chunkSize?: number;
  overlap?: number;
};

const DEFAULT_CHUNK_SIZE = 1_500;
const DEFAULT_OVERLAP = 220;

export function chunkText(text: string, options: ChunkingOptions = {}) {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= chunkSize) {
    return [normalized];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const upperBound = Math.min(cursor + chunkSize, normalized.length);
    let end = upperBound;

    if (upperBound < normalized.length) {
      const lastSentence = normalized.lastIndexOf(". ", upperBound);
      const lastBreak = normalized.lastIndexOf(" ", upperBound);
      end = Math.max(lastSentence > cursor ? lastSentence + 1 : cursor, lastBreak > cursor ? lastBreak : cursor);
      if (end <= cursor) {
        end = upperBound;
      }
    }

    chunks.push(normalized.slice(cursor, end).trim());

    if (end >= normalized.length) {
      break;
    }

    cursor = Math.max(0, end - overlap);
  }

  return chunks.filter(Boolean);
}
