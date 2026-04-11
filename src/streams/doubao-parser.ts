/**
 * Doubao Web Stream Parser — enhanced SSE parser with event_type handling.
 *
 * Doubao uses a specific SSE format with event_type and event_data fields:
 * - event_type 2001: message content (event_data.message.content is JSON with text)
 * - event_type 2002: message created (no text)
 * - event_type 2003: content delta at top level
 * - event_type 2010: seed intention (no text)
 *
 * Ported from openclaw-zero-token/src/zero-token/streams/doubao-web-stream.ts (522 lines)
 */

import type { StreamChunk } from "./parsers.js";

// ── Doubao SSE Event Types ──

const EVENT_MESSAGE_CONTENT = 2001;
const EVENT_MESSAGE_CREATED = 2002;
const EVENT_CONTENT_DELTA = 2003;
const EVENT_SEED_INTENTION = 2010;

interface DoubaoEventData {
  message?: {
    content?: string;
    role?: string;
  };
  text?: string;
  content?: string;
  delta?: string;
}

interface DoubaoSSEEvent {
  event_type?: number;
  event_data?: string | DoubaoEventData;
  sessionId?: string;
  // Standard OpenAI-compatible fallbacks
  choices?: Array<{ delta?: { content?: string; reasoning_content?: string; thinking?: string }; finish_reason?: string | null }>;
  text?: string;
  content?: string;
  delta?: string;
  done?: boolean;
}

/**
 * Parse Doubao SSE stream with event_type-specific handling.
 */
export async function* parseDoubaoSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        yield* processDoubaoLine(buffer.trim());
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      yield* processDoubaoLine(line.trim());
    }
  }
}

function* processDoubaoLine(line: string): Generator<StreamChunk> {
  if (!line.startsWith("data:")) return;

  const dataStr = line.slice(5).trim();
  if (dataStr === "[DONE]" || !dataStr) return;

  let data: DoubaoSSEEvent;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return; // ignore malformed JSON
  }

  // ── Doubao event-based format ──
  if (data.event_type !== undefined) {
    let delta = "";

    if (data.event_type === EVENT_MESSAGE_CONTENT && data.event_data) {
      // event_data.message.content is a JSON string containing {text: "..."}
      const eventData = parseEventData(data.event_data);
      const msg = eventData.message;
      if (msg?.content && typeof msg.content === "string") {
        try {
          const contentObj = JSON.parse(msg.content);
          if (typeof contentObj.text === "string" && contentObj.text) {
            delta = contentObj.text;
          }
        } catch {
          // If content isn't JSON, use it directly
          if (msg.content) delta = msg.content;
        }
      }
    } else if (data.event_type === EVENT_CONTENT_DELTA && data.event_data) {
      // Content delta at top level
      const eventData = parseEventData(data.event_data);
      delta = eventData.text || eventData.content || eventData.delta || "";
    }
    // event_type 2002 (created) and 2010 (seed intention) have no text

    if (typeof delta === "string" && delta) {
      yield { type: "text", content: delta };
    }
    return;
  }

  // ── Standard OpenAI-compatible fallback ──
  if (data.choices?.[0]?.delta) {
    const delta = data.choices[0].delta;
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      yield { type: "thinking", content: delta.reasoning_content };
    }
    if (typeof delta.thinking === "string" && delta.thinking) {
      yield { type: "thinking", content: delta.thinking };
    }
    if (typeof delta.content === "string" && delta.content) {
      yield { type: "text", content: delta.content };
    }
    if (data.choices[0].finish_reason === "stop" || data.choices[0].finish_reason === "length") {
      yield { type: "done" };
    }
    return;
  }

  // ── Generic fallbacks ──
  if (typeof data.content === "string" && data.content) {
    yield { type: "text", content: data.content };
  }
  if (typeof data.text === "string" && data.text) {
    yield { type: "text", content: data.text };
  }
  if (typeof data.delta === "string" && data.delta) {
    yield { type: "text", content: data.delta };
  }
  if (data.done) {
    yield { type: "done" };
  }
}

/**
 * Parse event_data which may be a JSON string or already an object.
 */
function parseEventData(raw: string | DoubaoEventData): DoubaoEventData {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as DoubaoEventData;
    } catch {
      return {};
    }
  }
  return raw;
}
