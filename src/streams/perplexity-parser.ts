/**
 * Perplexity Web Stream Parser — enhanced SSE parser for Perplexity web API.
 *
 * Handles Perplexity's SSE format:
 * - Simple text/content/delta extraction
 * - Search engine (no tool calling)
 *
 * Ported from openclaw-zero-token/src/zero-token/streams/perplexity-web-stream.ts (197 lines)
 */

import type { StreamChunk } from "./parsers.js";

// ── Perplexity SSE Event Types ──

interface PerplexitySSEEvent {
  text?: string;
  content?: string;
  delta?: string;
  v?: string;
  p?: string;
}

// ── Perplexity Stream Parser ──

/**
 * Parse a Perplexity web API SSE stream.
 *
 * Perplexity is a search engine, not a chat model.
 * It uses simple SSE format with text/content/delta fields.
 * No tool calling or think tag extraction needed.
 */
export async function* parsePerplexitySSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = (line: string): StreamChunk[] => {
    if (!line || !line.startsWith("data:")) return [];

    const dataStr = line.slice(5).trim();
    if (dataStr === "[DONE]" || !dataStr) return [];

    let data: PerplexitySSEEvent;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return [];
    }

    const chunks: StreamChunk[] = [];

    // Simple text extraction
    const delta = data.text ?? data.content ?? data.delta;

    if (typeof delta === "string" && delta) {
      chunks.push({ type: "text", content: delta });
    }

    // Also try v field
    if (typeof data.v === "string" && data.v) {
      const isReasoning = data.p && String(data.p).includes("reasoning");
      if (isReasoning) {
        chunks.push({ type: "thinking", content: data.v });
      } else {
        chunks.push({ type: "text", content: data.v });
      }
    }

    return chunks;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        for (const chunk of processLine(buffer.trim())) {
          yield chunk;
        }
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      for (const chunk of processLine(line.trim())) {
        yield chunk;
      }
    }
  }

  yield { type: "done" };
}
