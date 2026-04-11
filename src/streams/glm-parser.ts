/**
 * GLM Web Stream Parser — enhanced SSE parser for ChatGLM (chatglm.cn).
 *
 * Handles ChatGLM's specific SSE format:
 * - parts[].content[] with text extraction
 * - conversation_id tracking
 * - Accumulated content delta computation
 * - Think/tool_call tag extraction via TagAwareBuffer
 *
 * Ported from openclaw-zero-token/src/zero-token/streams/glm-web-stream.ts (500+ lines)
 */

import type { StreamChunk } from "./parsers.js";
import { createTagAwareBuffer, type TagAwareBuffer } from "./claude-parser.js";

// ── GLM SSE Event Types ──

interface GLMContentPart {
  type?: string;
  text?: string;
}

interface GLMMessage {
  content?: string | GLMContentPart[];
  parts?: Array<{ content?: GLMContentPart[] }>;
}

interface GLMSSEEvent {
  conversation_id?: string;
  sessionId?: string;
  parts?: Array<{ content?: GLMContentPart[] }>;
  messages?: GLMMessage[];
  text?: string;
  content?: string;
  delta?: string;
  v?: string;
  p?: string;
  data?: {
    messages?: GLMMessage[];
    text?: string;
    content?: string;
    delta?: string;
  };
}

// ── GLM Stream Parser ──

/**
 * Parse a ChatGLM web API SSE stream.
 *
 * GLM sends full accumulated content in each event — we compute the delta
 * by comparing with previously received content.
 *
 * Supports:
 * - SSE with "data:" prefix
 * - parts[].content[] format (new ChatGLM format)
 * - data.messages[] format
 * - Legacy text/content/delta fallbacks
 * - Think/tool_call tag extraction
 */
export async function* parseGLMSSEStream(
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

  const extractDelta = (data: GLMSSEEvent): string => {
    let delta = "";

    // Try parts[].content[] format (new ChatGLM format)
    if (data.parts && Array.isArray(data.parts)) {
      for (const part of data.parts) {
        if (part && typeof part === "object") {
          const content = part.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c && typeof c === "object" && c.type === "text" && typeof c.text === "string") {
                delta = c.text;
                break;
              }
            }
          }
          if (delta) break;
        }
      }
    }

    // Try data.messages[] format
    if (!delta && data.data?.messages && Array.isArray(data.data.messages)) {
      for (let i = data.data.messages.length - 1; i >= 0; i--) {
        const msg = data.data.messages[i];
        if (msg?.content && typeof msg.content === "string") {
          delta = msg.content;
          break;
        }
      }
    }

    // Try data fields
    if (!delta && data.data) {
      delta = data.data.text ?? data.data.content ?? data.data.delta ?? "";
    }

    // Legacy fallbacks
    if (!delta) {
      delta = data.text ?? data.content ?? data.delta ?? "";
    }

    return delta;
  };

  const processLine = (line: string): StreamChunk[] => {
    if (!line || !line.startsWith("data:")) return [];

    const dataStr = line.slice(5).trim();
    if (dataStr === "[DONE]" || !dataStr) return [];

    let data: GLMSSEEvent;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return []; // ignore partial JSON
    }

    const chunks: StreamChunk[] = [];

    // Track conversation ID
    if (data.conversation_id) {
      conversationId = data.conversation_id;
    }
    if (data.sessionId) {
      conversationId = data.sessionId;
    }

    const delta = extractDelta(data);

    if (typeof delta === "string" && delta) {
      // GLM sends full accumulated content — compute delta
      if (delta.length > accumulatedContent.length && delta.startsWith(accumulatedContent)) {
        const newPart = delta.slice(accumulatedContent.length);
        accumulatedContent = delta;
        if (newPart) {
          for (const chunk of tagBuffer.push(newPart)) {
            chunks.push(chunk);
          }
        }
      } else if (delta !== accumulatedContent) {
        // Completely different content — emit as-is
        accumulatedContent = delta;
        for (const chunk of tagBuffer.push(delta)) {
          chunks.push(chunk);
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

/**
 * Parse GLM International web API SSE stream.
 *
 * GLM Intl uses a simpler SSE format compared to the China version.
 */
export async function* parseGLMIntlSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let accumulatedContent = "";
  const tagBuffer: TagAwareBuffer = createTagAwareBuffer();
  let conversationId: string | undefined;

  const processLine = (line: string): StreamChunk[] => {
    if (!line || !line.startsWith("data:")) return [];

    const dataStr = line.slice(5).trim();
    if (dataStr === "[DONE]" || !dataStr) return [];

    let data: GLMSSEEvent;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return [];
    }

    const chunks: StreamChunk[] = [];

    // Track conversation ID
    if (data.conversation_id) {
      conversationId = data.conversation_id;
    }

    // Extract delta — GLM Intl format
    let delta = "";

    // Try parts[].content[] format
    if (data.parts && Array.isArray(data.parts)) {
      for (const part of data.parts) {
        if (part && typeof part === "object") {
          const content = part.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c && typeof c === "object" && c.type === "text" && typeof c.text === "string") {
                delta = c.text;
                break;
              }
            }
          }
          if (delta) break;
        }
      }
    }

    // Fallbacks
    if (!delta) {
      delta = data.text ?? data.content ?? data.delta ?? "";
    }

    if (typeof delta === "string" && delta) {
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
      for (const chunk of processLine(line.trim())) {
        yield chunk;
      }
    }
  }

  for (const chunk of tagBuffer.flush()) {
    yield chunk;
  }

  yield { type: "done" };
}
