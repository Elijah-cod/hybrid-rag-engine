function extractRetryDelay(raw: string) {
  const quotedDelay = raw.match(/"retryDelay"\s*:\s*"([^"]+)"/i)?.[1];
  if (quotedDelay) {
    return quotedDelay;
  }

  const inlineSeconds = raw.match(/Please retry in\s+([0-9.]+)s/i)?.[1];
  if (!inlineSeconds) {
    return null;
  }

  const seconds = Math.ceil(Number.parseFloat(inlineSeconds));
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return `${seconds}s`;
}

function formatRetryDelay(delay: string | null) {
  if (!delay) {
    return "in a little while";
  }

  if (delay.endsWith("s")) {
    const seconds = Number.parseInt(delay, 10);
    if (Number.isFinite(seconds)) {
      if (seconds < 60) {
        return `in about ${seconds} second${seconds === 1 ? "" : "s"}`;
      }

      const minutes = Math.ceil(seconds / 60);
      return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
  }

  return `in about ${delay}`;
}

export function toUserFacingErrorMessage(
  error: unknown,
  context: "chat" | "ingestion" | "readiness" = "chat"
) {
  const raw = error instanceof Error ? error.message : String(error ?? "");

  if (/429|RESOURCE_EXHAUSTED|quota exceeded|rate[- ]?limit/i.test(raw)) {
    const retryDelay = formatRetryDelay(extractRetryDelay(raw));
    const action =
      context === "readiness"
        ? "Your Gemini connection is set up, but the account has hit its current usage limit."
        : "InsightGraph has reached the current Gemini usage limit for live AI requests.";

    return `${action} Please try again ${retryDelay}, or switch on Mock AI if you want to keep exploring the app right now.`;
  }

  if (/401|403|API key|PERMISSION_DENIED|unauthorized|forbidden/i.test(raw)) {
    return "InsightGraph could not use Gemini because the AI credentials were rejected. Please check the Gemini API key and billing settings, then try again.";
  }

  if (/404|NOT_FOUND|model.*not found|supported for embedContent/i.test(raw)) {
    return "InsightGraph could not use the selected Gemini model. Please check the model names in your environment settings and try again.";
  }

  if (/fetch failed|network|ECONNREFUSED|ENOTFOUND|timed out|timeout/i.test(raw)) {
    return "InsightGraph could not reach Gemini right now. Please check the network connection and server settings, then try again.";
  }

  if (/Gemini/i.test(raw)) {
    return "InsightGraph could not complete the live AI request right now. Please try again in a moment, or switch on Mock AI to keep exploring.";
  }

  return raw || "Something went wrong. Please try again.";
}
