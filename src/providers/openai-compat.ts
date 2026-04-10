// Generic OpenAI-compatible Provider - proxies to any OpenAI-compatible API
// Useful for local LLMs (Ollama, vLLM, LMStudio) or other OpenAI-compatible services
import type { ProviderAdapter, ChatResult, ChatDelta, OpenAiMessage, ProviderConfig } from "../types.js";

export interface OpenAICompatProviderConfig extends ProviderConfig {
  baseUrl: string;
  apiKey?: string;
}

export class OpenAICompatProvider implements ProviderAdapter {
  private baseUrl: string;
  private apiKey: string;
  private userAgent: string;

  constructor(config: OpenAICompatProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey || config.bearer || "no-key";
    this.userAgent = config.userAgent || "zero-token-gateway/1.0";
  }

  async chat(params: { messages: OpenAiMessage[]; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "User-Agent": this.userAgent,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        stream: true,
      }),
      signal: params.signal,
    });

    if (!res.ok) throw new Error(`OpenAI compat API error: ${res.status}`);
    if (!res.body) throw new Error("No response body");

    return createStreamResult(res.body);
  }
}

function createStreamResult(body: ReadableStream<Uint8Array>): ChatResult {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  async function* generate(): AsyncGenerator<ChatDelta> {
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const combined = buffer + chunk;
        const parts = combined.split("\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") continue;
          try {
            const data = JSON.parse(dataStr);
            const delta = data.choices?.[0]?.delta;
            if (delta?.reasoning_content) {
              yield { type: "thinking", content: delta.reasoning_content };
            }
            if (typeof delta?.content === "string" && delta.content) {
              yield { type: "text", content: delta.content };
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name) {
                  yield {
                    type: "tool_call_start",
                    toolCall: { id: tc.id || "", name: tc.function.name, arguments: tc.function.arguments || "" },
                  };
                } else if (tc.function?.arguments) {
                  yield {
                    type: "tool_call_delta",
                    toolCall: { id: tc.id || "", name: "", arguments: tc.function.arguments },
                  };
                }
              }
            }
            if (data.choices?.[0]?.finish_reason === "tool_calls") {
              yield { type: "tool_call_end" };
            }
          } catch { /* ignore */ }
        }
      }
    } finally {
      yield { type: "done" };
    }
  }

  return {
    stream: generate(),
    async fullText() {
      let text = "";
      for await (const d of generate()) {
        if (d.type === "text" && d.content) text += d.content;
      }
      return text;
    },
  };
}
