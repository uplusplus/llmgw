/**
 * Qwen Web Stream Parser — enhanced SSE parser for Qwen (international & CN).
 *
 * Handles Qwen's specific SSE format:
 * - choices[0].delta.content (standard OpenAI-like)
 * - Accumulated content delta computation (Qwen CN)
 * - data.messages[] content extraction (Qwen CN v2)
 * - conversation/session ID tracking
 * - Think/tool_call tag extraction via TagAwareBuffer
 *
 * Ported from openclaw-zero-token:
 * - qwen-web-stream.ts (400+ lines)
 * - qwen-cn-web-stream.ts (460+ lines)
 */

import type { StreamChunk } from "./parsers.js";
import { createTagAwareBuffer, type TagAwareBuffer } from "./claude-parser.js";

// ── Qwen SSE Event Types ──

interface QwenSSEEvent {
  sessionId?: string;
  conversationId?: string;
  conversation_id?: string;
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
    };
    finish_reason?: string | null;
  }>;
  text?: string;
  content?: string;
  delta?: string;
  v?: string;
  p?: string;
  data?: {
    messages?: Array<{ content?: string }>;
    text?: string;
    content?: string;
    delta?: string;
  };
  communication?: {
    text?: string;
    content?: string;
  };
  event?: string;
}

// ── Qwen International Stream Parser ──

/**
 * Parse a Qwen International web API SSE stream.
 *
 * Qwen Intl uses standard SSE with choices[0].delta.content format.
 */
export async function* parseQwenSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const tagBuffer: TagAwareBuffer = createTagAwareBuffer();
  let conversationId: string | undefined;

  const processLine = (line: string): StreamChunk[] => {
    if (!line || !line.startsWith("data:")) return [];

    const dataStr = line.slice(5).trim();
    if (dataStr === "[DONE]" || !dataStr) return [];

    let data: QwenSSEEvent;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return [];
    }

    const chunks: StreamChunk[] = [];

    // Track conversation ID
    if (data.sessionId || data.conversationId || data.conversation_id) {
      conversationId = data.sessionId || data.conversationId || data.conversation_id;
    }

    // Extract delta — Qwen v2 uses choices[0].delta.content
    const delta =
      data.choices?.[0]?.delta?.content ??
      data.choices?.[0]?.delta?.reasoning_content ??
      data.text ??
      data.content ??
      data.delta;

    // Check if this is reasoning content
    const isReasoning = !!data.choices?.[0]?.delta?.reasoning_content;

    if (typeof delta === "string" && delta) {
      if (isReasoning) {
        chunks.push({ type: "thinking", content: delta });
      } else {
        for (const chunk of tagBuffer.push(delta)) {
          chunks.push(chunk);
        }
      }
    }

    // Also try v field
    if (typeof data.v === "string" && data.v) {
      const isVReasoning = data.p && String(data.p).includes("reasoning");
      if (isVReasoning) {
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

  for (const chunk of tagBuffer.flush()) {
    yield chunk;
  }

  yield { type: "done" };
}

// ── Qwen China Stream Parser ──

/**
 * Parse a Qwen China web API SSE stream.
 *
 * Qwen CN sends accumulated content (not incremental deltas).
 * We compute the delta by comparing with previously received content.
 *
 * Supports:
 * - data.data.messages[] content extraction
 * - Accumulated content delta computation
 * - event:/data: SSE format
 */
export async function* parseQwenCNSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let accumulatedContent = "";
  const tagBuffer: TagAwareBuffer = createTagAwareBuffer();
  let sessionId: string | undefined;
  let debugCount = 0;

  const processLine = (line: string): StreamChunk[] => {
    if (!line) return [];

    // Parse SSE format: event: xxx\ndata: yyy
    if (line.startsWith("event:")) return [];
    if (!line.startsWith("data:")) return [];

    const dataStr = line.slice(5).trim();
    if (dataStr === "[DONE]" || !dataStr) return [];

    let data: QwenSSEEvent;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return [];
    }

    const chunks: StreamChunk[] = [];

    // Track session ID
    if (data.sessionId) {
      sessionId = data.sessionId;
    }

    // Debug logging for first few events
    if (debugCount < 3) {
      debugCount++;
    }

    // Extract delta — Qwen CN Web specific extraction
    let delta = "";

    // Try data.messages[] format (Qwen CN v2)
    if (data.data?.messages && Array.isArray(data.data.messages)) {
      for (let i = data.data.messages.length - 1; i >= 0; i--) {
        const msg = data.data.messages[i];
        if (msg?.content && typeof msg.content === "string") {
          delta = msg.content;
          break;
        }
      }
    }

    // Fallback to other fields
    if (!delta) {
      delta = data.choices?.[0]?.delta?.content ?? "";
      if (!delta && data.data) {
        delta = data.data.text ?? data.data.content ?? data.data.delta ?? "";
      }
      if (!delta && data.communication) {
        delta = data.communication.text ?? data.communication.content ?? "";
      }
      if (!delta) {
        delta = data.text ?? data.content ?? data.delta ?? "";
      }
    }

    if (typeof delta === "string" && delta) {
      // Qwen CN sends accumulated content — compute delta
      if (
        delta.length > accumulatedContent.length &&
        delta.startsWith(accumulatedContent)
      ) {
        const newPart = delta.slice(accumulatedContent.length);
        accumulatedContent = delta;
        if (newPart) {
          for (const chunk of tagBuffer.push(newPart)) {
            chunks.push(chunk);
          }
        }
      } else if (delta !== accumulatedContent) {
        // Completely different content — emit as-is (new message)
        accumulatedContent = delta;
        for (const chunk of tagBuffer.push(delta)) {
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

  for (const chunk of tagBuffer.flush()) {
    yield chunk;
  }

  yield { type: "done" };
}
