/**
 * Claude Web Provider — cookie + org ID auth.
 * Ported from openclaw-zero-token.
 */

import type {
  ProviderAdapter,
  ModelDefinition,
  ChatCompletionRequest,
  StreamCallbacks,
} from "../types.js";
import { buildPrompt, DEFAULT_USER_AGENT, readSSEStream } from "./base.js";

export interface ClaudeProviderOptions {
  cookie: string;
  organizationId?: string;
  deviceId?: string;
  userAgent?: string;
}

export function createClaudeModels(): ModelDefinition[] {
  return [
    {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      provider: "claude-web",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 8192,
    },
    {
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      provider: "claude-web",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 8192,
    },
    {
      id: "claude-haiku-4-6",
      name: "Claude Haiku 4.6",
      provider: "claude-web",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 8192,
    },
  ];
}

export class ClaudeProvider implements ProviderAdapter {
  readonly id = "claude-web";
  readonly name = "Claude Web";
  readonly models: ModelDefinition[];

  private cookie: string;
  private userAgent: string;
  private organizationId?: string;
  private deviceId: string;
  private baseUrl = "https://claude.ai/api";
  private sessionMap = new Map<string, string>();

  constructor(opts: ClaudeProviderOptions, models?: ModelDefinition[]) {
    this.cookie = opts.cookie;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.organizationId = opts.organizationId;
    this.deviceId = opts.deviceId ?? crypto.randomUUID();
    this.models = models ?? createClaudeModels();
  }

  async init(): Promise<void> {
    await this.ensureOrgId();
    console.log(`[claude-web] Initialized (org: ${this.organizationId ?? "auto"})`);
  }

  async close(): Promise<void> {
    this.sessionMap.clear();
  }

  async chat(request: ChatCompletionRequest, callbacks: StreamCallbacks): Promise<void> {
    try {
      const sessionKey = "default";
      let conversationId = this.sessionMap.get(sessionKey);

      if (!conversationId) {
        conversationId = await this.createConversation();
        this.sessionMap.set(sessionKey, conversationId);
      }

      await this.ensureOrgId();
      const prompt = buildPrompt(request.messages);
      if (!prompt) throw new Error("No message to send");

      const url = this.organizationId
        ? `${this.baseUrl}/organizations/${this.organizationId}/chat_conversations/${conversationId}/completion`
        : `${this.baseUrl}/chat_conversations/${conversationId}/completion`;

      const res = await fetch(url, {
        method: "POST",
        headers: await this.fetchHeaders(),
        body: JSON.stringify({
          prompt,
          parent_message_uuid: "00000000-0000-4000-8000-000000000000",
          model: request.model || "claude-sonnet-4-6",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          rendering_mode: "messages",
          attachments: [],
          files: [],
          locale: "en-US",
          personalized_styles: [],
          sync_sources: [],
          tools: [],
        }),
      });

      if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
      if (!res.body) throw new Error("No response body");

      for await (const jsonStr of readSSEStream(res.body)) {
        try {
          const data = JSON.parse(jsonStr);

          // Claude SSE format: content_block_delta with delta.text
          if (data.type === "content_block_delta" && data.delta?.text) {
            callbacks.onText(data.delta.text);
          }

          // Claude thinking
          if (data.type === "content_block_delta" && data.delta?.thinking) {
            callbacks.onReasoning(data.delta.thinking);
          }

          // Standard fallback
          const content = data.choices?.[0]?.delta?.content || data.text || data.content;
          if (typeof content === "string" && content) {
            callbacks.onText(content);
          }
        } catch { /* ignore */ }
      }

      callbacks.onDone();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // ── Private ──

  private async fetchHeaders(): Promise<Record<string, string>> {
    return {
      "Content-Type": "application/json",
      Cookie: this.cookie,
      "User-Agent": this.userAgent,
      Accept: "text/event-stream",
      Referer: "https://claude.ai/",
      Origin: "https://claude.ai",
      "anthropic-client-platform": "web_claude_ai",
      "anthropic-device-id": this.deviceId,
    };
  }

  private async ensureOrgId(): Promise<void> {
    if (this.organizationId) return;
    try {
      const res = await fetch(`${this.baseUrl}/organizations`, {
        headers: await this.fetchHeaders(),
      });
      if (res.ok) {
        const orgs = (await res.json()) as Array<{ uuid: string }>;
        if (orgs?.length > 0 && orgs[0].uuid) {
          this.organizationId = orgs[0].uuid;
        }
      }
    } catch { /* optional */ }
  }

  private async createConversation(): Promise<string> {
    await this.ensureOrgId();
    const url = this.organizationId
      ? `${this.baseUrl}/organizations/${this.organizationId}/chat_conversations`
      : `${this.baseUrl}/chat_conversations`;

    const res = await fetch(url, {
      method: "POST",
      headers: await this.fetchHeaders(),
      body: JSON.stringify({
        name: `Conversation ${new Date().toISOString()}`,
        uuid: crypto.randomUUID(),
      }),
    });
    if (!res.ok) throw new Error(`Claude create conversation failed: ${res.status}`);
    const data = (await res.json()) as { uuid: string };
    return data.uuid;
  }
}
