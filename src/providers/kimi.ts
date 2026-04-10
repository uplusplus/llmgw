/**
 * Kimi Web Provider — Connect-JSON protocol via cookie / accessToken auth.
 * Ported from openclaw-zero-token.
 */

import type {
  ProviderAdapter,
  ModelDefinition,
  ChatCompletionRequest,
  StreamCallbacks,
} from "../types.js";
import { extractText, DEFAULT_USER_AGENT } from "./base.js";

export interface KimiProviderOptions {
  cookie?: string;
  accessToken?: string;
  userAgent?: string;
}

export function createKimiModels(): ModelDefinition[] {
  return [
    {
      id: "moonshot-v1-8k",
      name: "Moonshot v1 8K",
      provider: "kimi-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 8192,
      maxTokens: 4096,
    },
    {
      id: "moonshot-v1-32k",
      name: "Moonshot v1 32K",
      provider: "kimi-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 32000,
      maxTokens: 4096,
    },
    {
      id: "moonshot-v1-128k",
      name: "Moonshot v1 128K",
      provider: "kimi-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 4096,
    },
    {
      id: "kimi-search",
      name: "Kimi Search",
      provider: "kimi-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 4096,
    },
    {
      id: "kimi-reasoner",
      name: "Kimi Reasoner",
      provider: "kimi-web",
      reasoning: true,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 4096,
    },
  ];
}

export class KimiProvider implements ProviderAdapter {
  readonly id = "kimi-web";
  readonly name = "Kimi Web";
  readonly models: ModelDefinition[];

  private cookie: string;
  private accessToken: string;
  private userAgent: string;
  private baseUrl = "https://www.kimi.com";

  constructor(opts: KimiProviderOptions, models?: ModelDefinition[]) {
    this.cookie = opts.cookie ?? "";
    this.accessToken = opts.accessToken ?? "";
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.models = models ?? createKimiModels();
  }

  async init(): Promise<void> {
    console.log("[kimi-web] Initialized");
  }

  async close(): Promise<void> {}

  async chat(request: ChatCompletionRequest, callbacks: StreamCallbacks): Promise<void> {
    try {
      const authToken = this.extractAuth();
      if (!authToken) {
        throw new Error("Kimi: no auth found. Provide 'cookie' (with kimi-auth=...) or 'accessToken' in config.");
      }

      // Kimi web only supports last user message
      const userMessages = request.messages.filter((m) => m.role === "user");
      const lastUser = userMessages[userMessages.length - 1];
      if (!lastUser) throw new Error("No user message found");

      const content = extractText(lastUser.content);
      if (!content) throw new Error("Empty user message");

      // Prepend system prompt
      const systemParts = request.messages
        .filter((m) => m.role === "system")
        .map((m) => extractText(m.content))
        .filter(Boolean);

      const prompt = systemParts.length > 0
        ? `[System: ${systemParts.join("\n")}]\n\n${content}`
        : content;

      const scenario = this.resolveScenario(request.model);
      const isThinking = request.model.includes("reasoner") || request.model.includes("thinking");

      // Build Connect-JSON frame
      const reqBody = {
        scenario,
        message: {
          role: "user" as const,
          blocks: [{ message_id: "", text: { content: prompt } }],
          scenario,
        },
        options: { thinking: isThinking },
      };

      const enc = new TextEncoder().encode(JSON.stringify(reqBody));
      const buf = new ArrayBuffer(5 + enc.byteLength);
      const dv = new DataView(buf);
      dv.setUint8(0, 0x00);
      dv.setUint32(1, enc.byteLength, false);
      new Uint8Array(buf).set(enc, 5);

      const res = await fetch(
        `${this.baseUrl}/apiv2/kimi.gateway.chat.v1.ChatService/Chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/connect+json",
            "Connect-Protocol-Version": "1",
            Accept: "*/*",
            Origin: this.baseUrl,
            Referer: `${this.baseUrl}/`,
            "X-Language": "zh-CN",
            "X-Msh-Platform": "web",
            Authorization: `Bearer ${authToken}`,
            "User-Agent": this.userAgent,
          },
          body: buf,
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Kimi API error: ${res.status} ${text.slice(0, 300)}`);
      }
      if (!res.body) throw new Error("No response body");

      // Parse Connect-JSON binary stream
      const reader = res.body.getReader();
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
          const lenView = new DataView(buffer.buffer, buffer.byteOffset + 1, 4);
          const msgLen = lenView.getUint32(0, false);
          if (buffer.length < 5 + msgLen) break;

          const jsonBytes = buffer.slice(5, 5 + msgLen);
          buffer = buffer.slice(5 + msgLen);

          try {
            const obj = JSON.parse(new TextDecoder().decode(jsonBytes));
            if (obj.error) {
              callbacks.onError(new Error(obj.error.message ?? JSON.stringify(obj.error)));
              continue;
            }

            const op = obj.op ?? "";
            if (obj.block?.text?.content && (op === "append" || op === "set")) {
              callbacks.onText(obj.block.text.content);
            }
            if (obj.block?.thinking?.content && (op === "append" || op === "set")) {
              callbacks.onReasoning(obj.block.thinking.content);
            }
            if (!op && obj.message?.role === "assistant" && obj.message?.blocks) {
              for (const blk of obj.message.blocks) {
                if (blk.thinking?.content) callbacks.onReasoning(blk.thinking.content);
                if (blk.text?.content) callbacks.onText(blk.text.content);
              }
            }
            if (obj.done) break;
          } catch { /* ignore */ }
        }
      }

      callbacks.onDone();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // ── Private ──

  private extractAuth(): string {
    if (this.accessToken) return this.accessToken;
    const cookies = this.cookie.split(";");
    for (const c of cookies) {
      const [name, ...valueParts] = c.trim().split("=");
      if (name === "kimi-auth") return valueParts.join("=").trim();
    }
    return "";
  }

  private resolveScenario(model: string): string {
    if (model.includes("search")) return "SCENARIO_SEARCH";
    if (model.includes("research")) return "SCENARIO_RESEARCH";
    if (model.includes("k1")) return "SCENARIO_K1";
    if (model.includes("explore")) return "SCENARIO_EXPLORE";
    return "SCENARIO_K2";
  }
}
