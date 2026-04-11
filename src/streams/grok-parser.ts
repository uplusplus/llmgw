/**
 * Grok Web Stream Parser — enhanced SSE/NDJSON parser for Grok web API.
 *
 * Handles Grok's specific format:
 * - NDJSON (newline-delimited JSON without "data:" prefix)
 * - contentDelta field (accumulated content)
 * - sessionId tracking
 * - Think/tool_call tag extraction via TagAwareBuffer
 * - REST API + DOM fallback support
 *
 * Ported from openclaw-zero-token/src/zero-token/streams/grok-web-stream.ts (415 lines)
 */

import type { StreamChunk } from "./parsers.js";
import { createTagAwareBuffer, type TagAwareBuffer } from "./claude-parser.js";

// ── Grok Event Types ──

interface GrokSSEEvent {
  sessionId?: string;
  contentDelta?: string;
  choices?: Array<{ delta?: { content?: string } }>;
  text?: string;
  content?: string;
  delta?: string;
  v?: string;
  p?: string;
}

// ── Grok Stream Parser ──

/**
 * Parse a Grok web API stream (SSE or NDJSON format).
 *
 * Grok sends full accumulated content in contentDelta on each event.
 * We track accumulated content and emit only the new portion.
 *
 * Supports:
 * - NDJSON (no "data:" prefix) — primary format
 * - SSE with "data:" prefix — fallback
 * - Think/thinking/thought tag extraction
 * - Tool call XML tag extraction
 */
export async function* parseGrokSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Track accumulated content to compute deltas
  let accumulatedContent = "";

  // Tag-aware buffer for think/tool_call extraction
  const tagBuffer: TagAwareBuffer = createTagAwareBuffer();

  // State tracking
  let sessionId: string | undefined;

  const processLine = (line: string): StreamChunk[] => {
    if (!line) return [];

    // Grok returns raw NDJSON without SSE "data:" prefix.
    // Try parsing as-is first, then fall back to "data:" prefix.
    let dataStr: string;
    if (line.startsWith("data: ")) {
      dataStr = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataStr = line.slice(5).trim();
    } else {
      dataStr = line.trim();
    }

    if (dataStr === "[DONE]" || !dataStr) return [];

    let data: GrokSSEEvent;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return []; // ignore partial JSON
    }

    const chunks: StreamChunk[] = [];

    // Track session ID
    if (data.sessionId) {
      sessionId = data.sessionId;
    }

    // Extract content delta — Grok uses contentDelta field
    const delta =
      data.contentDelta ??
      data.choices?.[0]?.delta?.content ??
      data.text ??
      data.content ??
      data.delta;

    if (typeof delta === "string" && delta) {
      // Grok sends full accumulated content in each event — only emit the new portion
      if (delta.length > accumulatedContent.length && delta.startsWith(accumulatedContent)) {
        const newDelta = delta.slice(accumulatedContent.length);
        accumulatedContent = delta;
        if (newDelta) {
          for (const chunk of tagBuffer.push(newDelta)) {
            chunks.push(chunk);
          }
        }
      }
    }

    // Also try v field (alternative API format)
    if (typeof data.v === "string" && data.v) {
      const isReasoning = data.p && String(data.p).includes("reasoning");
      if (isReasoning) {
        chunks.push({ type: "thinking", content: data.v });
      } else {
        for (const chunk of tagBuffer.push(data.v)) {
          chunks.push(chunk);
        }
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

  // Flush remaining tag buffer
  for (const chunk of tagBuffer.flush()) {
    yield chunk;
  }

  yield { type: "done" };
}
