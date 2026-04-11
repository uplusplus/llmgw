/**
 * Doubao (ByteDance) Web Provider — sessionid + ttwid cookie auth.
 * Ported from openclaw-zero-token.
 *
 * Uses enhanced Doubao SSE parser with event_type handling (2001/2002/2003/2010).
 */

import type {
  ProviderAdapter,
  ModelDefinition,
  ChatCompletionRequest,
  StreamCallbacks,
} from "../types.js";
import { extractText, DEFAULT_USER_AGENT } from "./base.js";
import { parseDoubaoSSEStream } from "../streams/doubao-parser.js";

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

      // Use enhanced Doubao SSE parser with event_type handling
      for await (const chunk of parseDoubaoSSEStream(res.body)) {
        switch (chunk.type) {
          case "text":
            if (chunk.content) callbacks.onText(chunk.content);
            break;
          case "thinking":
            if (chunk.content) callbacks.onReasoning(chunk.content);
            break;
          case "done":
            callbacks.onDone();
            return;
          case "error":
            callbacks.onError(new Error(chunk.error ?? "Unknown stream error"));
            return;
        }
      }

      callbacks.onDone();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
