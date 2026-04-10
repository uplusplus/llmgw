/**
 * OpenAI-compatible API provider — proxies to any OpenAI-compat endpoint.
 * Covers: Ollama, vLLM, OpenRouter, Together, Qianfan, Volcengine, xAI, etc.
 */

import type {
  ProviderAdapter,
  ModelDefinition,
  ChatCompletionRequest,
  StreamCallbacks,
} from "../types.js";
import { DEFAULT_USER_AGENT, readSSEStream } from "./base.js";

export interface OpenAICompatProviderOptions {
  baseUrl: string;
  apiKey?: string;
  userAgent?: string;
}

export class OpenAICompatProvider implements ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly models: ModelDefinition[];

  private baseUrl: string;
  private apiKey: string;
  private userAgent: string;

  constructor(
    id: string,
    name: string,
    opts: OpenAICompatProviderOptions,
    models: ModelDefinition[],
  ) {
    this.id = id;
    this.name = name;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey ?? "no-key";
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.models = models;
  }

  async init(): Promise<void> {
    console.log(`[${this.id}] Initialized → ${this.baseUrl}`);
  }

  async close(): Promise<void> {}

  async chat(request: ChatCompletionRequest, callbacks: StreamCallbacks): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "User-Agent": this.userAgent,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map((m) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : m.content,
            ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
            ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          })),
          stream: true,
          ...(request.temperature != null ? { temperature: request.temperature } : {}),
          ...(request.max_tokens != null ? { max_tokens: request.max_tokens } : {}),
          ...(request.tools ? { tools: request.tools } : {}),
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`[${this.id}] API error: ${res.status} ${text.slice(0, 300)}`);
      }
      if (!res.body) throw new Error("No response body");

      for await (const jsonStr of readSSEStream(res.body)) {
        try {
          const data = JSON.parse(jsonStr);
          const delta = data.choices?.[0]?.delta;

          if (delta?.reasoning_content) {
            callbacks.onReasoning(delta.reasoning_content);
          }

          if (typeof delta?.content === "string" && delta.content) {
            callbacks.onText(delta.content);
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.name || tc.function?.arguments) {
                callbacks.onToolCall({
                  id: tc.id ?? `call_${Date.now()}`,
                  type: "function",
                  function: {
                    name: tc.function?.name ?? "",
                    arguments: tc.function?.arguments ?? "",
                  },
                });
              }
            }
          }

          if (data.choices?.[0]?.finish_reason === "stop") {
            break;
          }
        } catch { /* ignore */ }
      }

      callbacks.onDone();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
