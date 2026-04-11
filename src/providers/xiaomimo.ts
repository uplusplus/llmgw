/**
 * Xiaomi MiMo Web Provider — cookie + bearer auth, REST API.
 * Ported from openclaw-zero-token.
 *
 * Enhanced with conversation tracking and platform-specific SSE parsing.
 */

import type {
  ProviderAdapter,
  ModelDefinition,
  ChatCompletionRequest,
  StreamCallbacks,
} from "../types.js";
import { buildPrompt, DEFAULT_USER_AGENT, readSSEStream } from "./base.js";
import { createTagAwareBuffer } from "../streams/claude-parser.js";

export interface XiaomiMimoProviderOptions {
  cookie: string;
  bearer?: string;
  userAgent?: string;
}

export function createXiaomiMimoModels(): ModelDefinition[] {
  return [
    {
      id: "xiaomimo-chat",
      name: "MiMo Chat",
      provider: "xiaomimo-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 4096,
    },
    {
      id: "mimo-v2-pro",
      name: "MiMo V2 Pro",
      provider: "xiaomimo-web",
      reasoning: true,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 8192,
    },
  ];
}

const BASE_URL = "https://aistudio.xiaomimimo.com";

export class XiaomiMimoProvider implements ProviderAdapter {
  readonly id = "xiaomimo-web";
  readonly name = "Xiaomi MiMo Web";
  readonly models: ModelDefinition[];

  private cookie: string;
  private bearer: string;
  private userAgent: string;
  private conversationId?: string;

  constructor(opts: XiaomiMimoProviderOptions, models?: ModelDefinition[]) {
    this.cookie = opts.cookie;
    this.bearer = opts.bearer ?? "";
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.models = models ?? createXiaomiMimoModels();
  }

  async init(): Promise<void> {
    console.log("[xiaomimo-web] Initialized");
  }

  async close(): Promise<void> {
    this.conversationId = undefined;
  }

  async chat(request: ChatCompletionRequest, callbacks: StreamCallbacks): Promise<void> {
    try {
      const prompt = buildPrompt(request.messages);
      if (!prompt) throw new Error("No message to send");

      const headers = this.fetchHeaders();
      const botPhMatch = this.cookie.match(/xiaomichatbot_ph="([^"]*)"/);
      const botPh = botPhMatch?.[1] || "";

      let url = `${BASE_URL}/open-apis/bot/chat`;
      if (botPh) {
        url += `?xiaomichatbot_ph=${encodeURIComponent(botPh)}`;
      }

      const body: Record<string, unknown> = { message: prompt };
      if (this.conversationId) {
        body.conversation_id = this.conversationId;
      }

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Xiaomi MiMo API error: ${res.status} ${text.slice(0, 300)}`);
      }
      if (!res.body) throw new Error("No response body");

      // Use tag-aware buffer for think/thinking tag separation
      const tagBuffer = createTagAwareBuffer();

      for await (const jsonStr of readSSEStream(res.body)) {
        try {
          const data = JSON.parse(jsonStr);

          if (data.conversation_id) {
            this.conversationId = data.conversation_id;
          }

          // Extract text content from multiple possible fields
          const content = data.choices?.[0]?.delta?.content
            ?? data.choices?.[0]?.message?.content
            ?? data.text
            ?? data.content
            ?? data.message;

          if (typeof content === "string" && content) {
            for (const chunk of tagBuffer.push(content)) {
              switch (chunk.type) {
                case "text":
                  if (chunk.content) callbacks.onText(chunk.content);
                  break;
                case "thinking":
                  if (chunk.content) callbacks.onReasoning(chunk.content);
                  break;
              }
            }
          }

          // Direct reasoning content (without think tags)
          const thinking = data.choices?.[0]?.delta?.reasoning_content
            ?? data.thinking
            ?? data.reasoning_content;
          if (typeof thinking === "string" && thinking) {
            callbacks.onReasoning(thinking);
          }

          // Tool call extraction
          if (data.choices?.[0]?.delta?.tool_calls) {
            for (const tc of data.choices[0].delta.tool_calls) {
              if (tc.function?.name || tc.function?.arguments) {
                callbacks.onToolCall({
                  id: tc.id ?? `mimo_tool_${Date.now()}`,
                  type: "function" as const,
                  function: {
                    name: tc.function?.name ?? "",
                    arguments: tc.function?.arguments ?? "",
                  },
                });
              }
            }
          }
        } catch { /* ignore partial JSON */ }
      }

      // Flush remaining tag buffer
      for (const chunk of tagBuffer.flush()) {
        switch (chunk.type) {
          case "text":
            if (chunk.content) callbacks.onText(chunk.content);
            break;
          case "thinking":
            if (chunk.content) callbacks.onReasoning(chunk.content);
            break;
        }
      }

      callbacks.onDone();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private fetchHeaders(): Record<string, string> {
    // Extract serviceToken as Bearer token from cookie
    const serviceTokenMatch = this.cookie.match(/serviceToken="([^"]*)"/);
    const serviceToken = serviceTokenMatch?.[1] || this.bearer;

    const botPhMatch = this.cookie.match(/xiaomichatbot_ph="([^"]*)"/);
    const botPh = botPhMatch?.[1] || "";

    return {
      Cookie: this.cookie,
      "User-Agent": this.userAgent,
      "Content-Type": "application/json",
      Accept: "*/*",
      ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
      Referer: `${BASE_URL}/`,
      Origin: BASE_URL,
      "x-timezone": "Asia/Shanghai",
      ...(botPh ? { bot_ph: botPh } : {}),
    };
  }
}
