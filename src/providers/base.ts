/**
 * Shared utilities for provider implementations.
 */

import type { ChatMessage, ContentPart } from "../types.js";

/**
 * Extract plain text from OpenAI ChatMessage content.
 */
export function extractText(content: string | ContentPart[] | null): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

/**
 * Build a prompt string from messages for providers that need it.
 */
export function buildPrompt(messages: ChatMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    const text = extractText(m.content);
    if (!text) continue;
    const label =
      m.role === "system" ? "System"
      : m.role === "user" ? "User"
      : m.role === "tool" ? "Tool"
      : "Assistant";
    parts.push(`${label}: ${text}`);
  }
  return parts.join("\n\n");
}

/**
 * Default User-Agent header.
 */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * SSE stream reader: parses `data: ...\n\n` lines from a ReadableStream.
 */
export async function* readSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) yield buffer.trim();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6).trim();
        if (data === "[DONE]") return;
        yield data;
      }
    }
  }
}

/**
 * Convert a raw string (accumulated SSE/NDJSON) to a ReadableStream<Uint8Array>.
 * Useful for feeding accumulated page.evaluate() responses into stream parsers.
 */
export function stringToReadableStream(raw: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}
