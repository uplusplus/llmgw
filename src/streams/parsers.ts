/**
 * Stream parsers: platform-specific → normalized chunks.
 */

// ── Normalized chunk type ──

export interface StreamChunk {
  type: "text" | "thinking" | "tool_call" | "error" | "done";
  content?: string;
  toolCall?: { id: string; name: string; arguments: string };
  error?: string;
}

// ── SSE Parser (DeepSeek / Claude / Doubao / OpenAI-compat) ──

export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        for (const chunk of processSSELine(buffer.trim())) {
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
      if (!trimmed.startsWith("data: ")) continue;
      const dataStr = trimmed.slice(6).trim();
      if (dataStr === "[DONE]") return;
      for (const chunk of processSSEData(dataStr)) {
        yield chunk;
      }
    }
  }
}

function* processSSELine(line: string): Generator<StreamChunk> {
  if (!line.startsWith("data: ")) return;
  const dataStr = line.slice(6).trim();
  if (dataStr === "[DONE]") return;
  yield* processSSEData(dataStr);
}

function* processSSEData(jsonStr: string): Generator<StreamChunk> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    return; // ignore partial JSON
  }

  const delta = (data.choices as Array<{ delta?: Record<string, unknown> }>)?.[0]?.delta;

  // OpenAI-compatible: reasoning_content
  if (typeof delta?.reasoning_content === "string") {
    yield { type: "thinking", content: delta.reasoning_content };
  }

  // OpenAI-compatible: content
  if (typeof delta?.content === "string" && delta.content) {
    yield { type: "text", content: delta.content };
  }

  // OpenAI-compatible: tool_calls
  if (Array.isArray(delta?.tool_calls)) {
    for (const tc of delta.tool_calls) {
      yield {
        type: "tool_call",
        content: tc.function?.arguments ?? "",
        toolCall: {
          id: tc.id ?? `call_${Date.now()}`,
          name: tc.function?.name ?? "",
          arguments: tc.function?.arguments ?? "",
        },
      };
    }
  }

  // Claude-specific: content_block_delta
  if (data.type === "content_block_delta" && typeof (data.delta as Record<string, unknown>)?.text === "string") {
    yield { type: "text", content: (data.delta as Record<string, unknown>).text as string };
  }
  if (data.type === "content_block_delta" && typeof (data.delta as Record<string, unknown>)?.thinking === "string") {
    yield { type: "thinking", content: (data.delta as Record<string, unknown>).thinking as string };
  }

  // DeepSeek-specific: v field with reasoning/content path
  if (typeof data.v === "string") {
    const isReasoning = data.p && String(data.p).includes("reasoning");
    if (isReasoning) {
      yield { type: "thinking", content: data.v };
    } else {
      yield { type: "text", content: data.v };
    }
  }

  // Generic fallbacks
  if (typeof data.content === "string" && data.content) {
    yield { type: "text", content: data.content };
  }
  if (typeof data.text === "string" && data.text) {
    yield { type: "text", content: data.text };
  }
}

// ── Connect-JSON Parser (Kimi) ──

export async function* parseConnectJSONStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  let buffer = new Uint8Array(0);

  const appendBuffer = (chunk: Uint8Array) => {
    const merged = new Uint8Array(buffer.length + chunk.length);
    merged.set(buffer);
    merged.set(chunk, buffer.length);
    buffer = merged;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    appendBuffer(value);

    while (buffer.length >= 5) {
      const flag = buffer[0];
      const lenView = new DataView(buffer.buffer, buffer.byteOffset + 1, 4);
      const msgLen = lenView.getUint32(0, false); // big-endian

      if (buffer.length < 5 + msgLen) break; // incomplete frame

      const jsonBytes = buffer.slice(5, 5 + msgLen);
      buffer = buffer.slice(5 + msgLen);

      try {
        const obj = JSON.parse(new TextDecoder().decode(jsonBytes));

        if (obj.error) {
          yield { type: "error", error: obj.error.message ?? JSON.stringify(obj.error) };
          continue;
        }

        const op = obj.op ?? "";

        // Text content from append/set ops
        if (obj.block?.text?.content && (op === "append" || op === "set")) {
          yield { type: "text", content: obj.block.text.content };
        }

        // Thinking content
        if (obj.block?.thinking?.content && (op === "append" || op === "set")) {
          yield { type: "thinking", content: obj.block.thinking.content };
        }

        // Complete message (no op field)
        if (!op && obj.message?.role === "assistant" && obj.message?.blocks) {
          for (const blk of obj.message.blocks) {
            if (blk.thinking?.content) {
              yield { type: "thinking", content: blk.thinking.content };
            }
            if (blk.text?.content) {
              yield { type: "text", content: blk.text.content };
            }
          }
        }

        if (obj.done) {
          yield { type: "done" };
          return;
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  yield { type: "done" };
}
