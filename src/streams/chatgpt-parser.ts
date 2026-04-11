/**
 * ChatGPT Web Stream Parser — enhanced SSE parser for ChatGPT web API.
 *
 * Handles ChatGPT's specific SSE format:
 * - message.content.parts[] (accumulated content)
 * - conversation_id / message.id tracking
 * - Sentinel token processing
 * - Tool call XML tag extraction via TagAwareBuffer
 *
 * Ported from openclaw-zero-token/src/zero-token/streams/chatgpt-web-stream.ts (447 lines)
 */

import type { StreamChunk } from "./parsers.js";
import { createTagAwareBuffer, type TagAwareBuffer } from "./claude-parser.js";

// ── ChatGPT SSE Event Types ──

interface ChatGPTMessage {
  id?: string;
  author?: { role?: string };
  role?: string;
  content?: {
    content_type?: string;
    parts?: unknown[];
  };
}

interface ChatGPTSSEEvent {
  conversation_id?: string;
  message?: ChatGPTMessage;
  v?: string;
  p?: string;
  text?: string;
  content?: string;
  delta?: string;
}

// ── ChatGPT Stream Parser ──

/**
 * Parse a ChatGPT web API SSE stream.
 *
 * ChatGPT sends full accumulated content in message.content.parts[0] on each event.
 * We track the accumulated content and emit only the delta (new portion).
 *
 * Supports:
 * - Standard SSE with "data:" prefix
 * - NDJSON (newline-delimited JSON without "data:" prefix)
 * - Think/tool_call tag extraction via TagAwareBuffer
 */
export async function* parseChatGPTSSEStream(
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
  let conversationId: string | undefined;
  let messageId: string | undefined;
  let sseEventCount = 0;

  const processLine = (line: string): StreamChunk[] => {
    if (!line) return [];

    // Handle SSE "data:" prefix
    let dataStr: string;
    if (line.startsWith("data: ")) {
      dataStr = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataStr = line.slice(5).trim();
    } else {
      // Try NDJSON (no prefix)
      dataStr = line.trim();
    }

    if (dataStr === "[DONE]" || !dataStr) return [];

    let data: ChatGPTSSEEvent;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return []; // ignore partial JSON
    }

    const chunks: StreamChunk[] = [];

    // Track conversation/message IDs
    if (data.conversation_id) {
      conversationId = data.conversation_id;
    }
    if (data.message?.id) {
      messageId = data.message.id;
    }

    // Skip non-assistant events
    const role = data.message?.author?.role ?? data.message?.role;
    if (role && role !== "assistant") {
      return [];
    }

    // Debug logging for first few events
    if (sseEventCount < 3) {
      sseEventCount++;
    }

    // Extract content — ChatGPT sends accumulated content in parts[0]
    const rawPart = data.message?.content?.parts?.[0];
    let content: string | undefined;

    if (typeof rawPart === "string") {
      content = rawPart;
    } else if (rawPart && typeof rawPart === "object" && "text" in (rawPart as Record<string, unknown>)) {
      content = (rawPart as { text?: string }).text;
    }

    if (typeof content === "string" && content) {
      // ChatGPT sends accumulated content — compute delta
      if (content.length > accumulatedContent.length && content.startsWith(accumulatedContent)) {
        const delta = content.slice(accumulatedContent.length);
        accumulatedContent = content;
        if (delta) {
          for (const chunk of tagBuffer.push(delta)) {
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

    // Generic fallbacks
    if (typeof data.text === "string" && data.text) {
      const delta = data.text;
      if (delta.length > accumulatedContent.length && delta.startsWith(accumulatedContent)) {
        const newPart = delta.slice(accumulatedContent.length);
        accumulatedContent = delta;
        if (newPart) {
          for (const chunk of tagBuffer.push(newPart)) {
            chunks.push(chunk);
          }
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
      const trimmed = line.trim();
      for (const chunk of processLine(trimmed)) {
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

export { type TagAwareBuffer } from "./claude-parser.js";
