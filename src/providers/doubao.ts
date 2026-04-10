/**
 * Doubao (ByteDance) Web Provider — sessionid + ttwid cookie auth.
 * Ported from openclaw-zero-token.
 */

import type {
  ProviderAdapter,
  ModelDefinition,
  ChatCompletionRequest,
  StreamCallbacks,
} from "../types.js";
import { extractText, DEFAULT_USER_AGENT, readSSEStream } from "./base.js";

export interface DoubaoProviderOptions {
  cookie?: string;
  sessionid?: string;
  ttwid?: string;
  userAgent?: string;
}

export function createDoubaoModels(): ModelDefinition[] {
  return [
    {
      id: "doubao-seed-1-8",
      name: "Doubao Seed 1.8",
      provider: "doubao-web",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 256000,
      maxTokens: 4096,
    },
    {
      id: "doubao-seed-code",
      name: "Doubao Seed Code",
      provider: "doubao-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 256000,
      maxTokens: 4096,
    },
    {
      id: "deepseek-v3",
      name: "DeepSeek V3 (via Doubao)",
      provider: "doubao-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 4096,
    },
    {
      id: "kimi-k2",
      name: "Kimi K2 (via Doubao)",
      provider: "doubao-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 256000,
      maxTokens: 4096,
    },
    {
      id: "glm-4",
      name: "GLM 4 (via Doubao)",
      provider: "doubao-web",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 4096,
    },
  ];
}

export class DoubaoProvider implements ProviderAdapter {
  readonly id = "doubao-web";
  readonly name = "Doubao Web";
  readonly models: ModelDefinition[];

  private cookie: string;
  private userAgent: string;
  private baseUrl = "https://www.doubao.com";

  constructor(opts: DoubaoProviderOptions, models?: ModelDefinition[]) {
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;

    // Build cookie from parts if provided separately
    if (opts.cookie) {
      this.cookie = opts.cookie;
    } else {
      const parts: string[] = [];
      if (opts.sessionid) parts.push(`sessionid=${opts.sessionid}`);
      if (opts.ttwid) parts.push(`ttwid=${opts.ttwid}`);
      this.cookie = parts.join("; ");
    }

    this.models = models ?? createDoubaoModels();
  }

  async init(): Promise<void> {
    console.log("[doubao-web] Initialized");
  }

  async close(): Promise<void> {}

  async chat(request: ChatCompletionRequest, callbacks: StreamCallbacks): Promise<void> {
    try {
      if (!this.cookie) {
        throw new Error("Doubao: no auth found. Provide 'cookie' or 'sessionid'+'ttwid' in config.");
      }

      const res = await fetch(`${this.baseUrl}/samantha/chat/completion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: this.cookie,
          "User-Agent": this.userAgent,
          Accept: "*/*",
          Referer: "https://www.doubao.com/",
          Origin: "https://www.doubao.com",
        },
        body: JSON.stringify({
          messages: request.messages.map((m) => ({
            role: m.role,
            content: extractText(m.content),
          })),
          model: request.model,
          stream: true,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Doubao API error: ${res.status} ${text.slice(0, 300)}`);
      }
      if (!res.body) throw new Error("No response body");

      for await (const jsonStr of readSSEStream(res.body)) {
        try {
          const data = JSON.parse(jsonStr);

          const content = data.choices?.[0]?.delta?.content
            ?? data.choices?.[0]?.message?.content
            ?? data.content
            ?? data.text;
          if (typeof content === "string" && content) {
            callbacks.onText(content);
          }

          const thinking = data.choices?.[0]?.delta?.reasoning_content
            ?? data.choices?.[0]?.delta?.thinking
            ?? data.thinking;
          if (typeof thinking === "string" && thinking) {
            callbacks.onReasoning(thinking);
          }

          if (data.choices?.[0]?.finish_reason === "stop" || data.done) {
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
