/**
 * POST /v1/chat/completions — OpenAI-compatible chat endpoint.
 */

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ErrorResponse,
  ProviderAdapter,
} from "../types.js";

export function chatCompletionsHandler(
  modelIndex: Map<string, ProviderAdapter>,
  availableModels: () => string[],
) {
  return async (c: Context) => {
    const body = await c.req.json<ChatCompletionRequest>();

    // Find provider for requested model
    const provider = modelIndex.get(body.model);
    if (!provider) {
      const err: ErrorResponse = {
        error: {
          message: `Model '${body.model}' not found. Available: ${availableModels().join(", ")}`,
          type: "invalid_request_error",
          code: "model_not_found",
        },
      };
      return c.json(err, 404);
    }

    // Streaming response
    if (body.stream !== false) {
      return streamSSE(c, async (stream) => {
        const id = `chatcmpl-${generateId()}`;
        const created = Math.floor(Date.now() / 1000);

        await provider.chat(body, {
          onText: (text) => {
            writeSSEChunk(stream, buildDelta(id, created, body.model, { content: text }));
          },
          onReasoning: (text) => {
            writeSSEChunk(stream, buildDelta(id, created, body.model, { reasoning_content: text }));
          },
          onToolCall: (toolCall) => {
            writeSSEChunk(stream, buildDelta(id, created, body.model, { tool_calls: [toolCall] }));
          },
          onDone: () => {
            writeSSEChunk(stream, buildDelta(id, created, body.model, {}, "stop"));
            stream.write("data: [DONE]\n\n");
          },
          onError: (error) => {
            writeSSEChunk(stream, buildDelta(id, created, body.model, { content: `\n[Error: ${error.message}]` }, "stop"));
            stream.write("data: [DONE]\n\n");
          },
        });
      });
    }

    // Non-streaming response
    let content = "";
    let reasoning = "";

    await provider.chat(body, {
      onText: (text) => { content += text; },
      onReasoning: (text) => { reasoning += text; },
      onToolCall: () => {},
      onDone: () => {},
      onError: (err) => { content += `\n[Error: ${err.message}]`; },
    });

    const response: ChatCompletionResponse = {
      id: `chatcmpl-${generateId()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
    };

    return c.json(response);
  };
}

// ── Helpers ──

function generateId(): string {
  return Math.random().toString(36).slice(2, 15);
}

function buildDelta(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason?: string,
): string {
  return JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason ?? null,
      },
    ],
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeSSEChunk(stream: any, data: string) {
  stream.write(`data: ${data}\n\n`);
}
