// Claude Web Provider - uses HTTP fetch with cookies
import type { ProviderAdapter, ChatResult, ChatDelta, OpenAiMessage, ProviderConfig } from "../types.js";

export class ClaudeProvider implements ProviderAdapter {
  private cookie: string;
  private userAgent: string;
  private organizationId?: string;
  private deviceId: string;
  private baseUrl = "https://claude.ai/api";
  private sessionMap = new Map<string, string>();

  constructor(config: ProviderConfig) {
    this.cookie = config.cookie;
    this.userAgent = config.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    this.organizationId = config.organizationId;
    this.deviceId = config.deviceId || crypto.randomUUID();
  }

  private async fetchHeaders() {
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
        const orgs = await res.json() as Array<{ uuid: string }>;
        if (orgs?.length > 0 && orgs[0].uuid) {
          this.organizationId = orgs[0].uuid;
        }
      }
    } catch {
      // Organization discovery is optional
    }
  }

  private async createConversation(): Promise<string> {
    await this.ensureOrgId();
    const url = this.organizationId
      ? `${this.baseUrl}/organizations/${this.organizationId}/chat_conversations`
      : `${this.baseUrl}/chat_conversations`;

    const res = await fetch(url, {
      method: "POST",
      headers: await this.fetchHeaders(),
      body: JSON.stringify({ name: `Conversation ${new Date().toISOString()}`, uuid: crypto.randomUUID() }),
    });
    if (!res.ok) throw new Error(`Claude create conversation failed: ${res.status}`);
    const data = await res.json() as { uuid: string };
    return data.uuid;
  }

  private buildPrompt(messages: OpenAiMessage[]): string {
    const parts: string[] = [];
    for (const m of messages) {
      const role = m.role === "user" || m.role === "system" ? "User" : "Assistant";
      const content = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter((p) => p.type === "text").map((p) => p.text).join("")
          : "";
      if (content) parts.push(`${role}: ${content}`);
    }
    return parts.join("\n\n");
  }

  async chat(params: { messages: OpenAiMessage[]; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const sessionKey = "default";
    let conversationId = this.sessionMap.get(sessionKey);

    if (!conversationId) {
      conversationId = await this.createConversation();
      this.sessionMap.set(sessionKey, conversationId);
    }

    await this.ensureOrgId();
    const prompt = this.buildPrompt(params.messages);
    if (!prompt) throw new Error("No message to send to Claude");

    const url = this.organizationId
      ? `${this.baseUrl}/organizations/${this.organizationId}/chat_conversations/${conversationId}/completion`
      : `${this.baseUrl}/chat_conversations/${conversationId}/completion`;

    const res = await fetch(url, {
      method: "POST",
      headers: await this.fetchHeaders(),
      body: JSON.stringify({
        prompt,
        parent_message_uuid: "00000000-0000-4000-8000-000000000000",
        model: params.model || "claude-sonnet-4-6",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        rendering_mode: "messages",
        attachments: [],
        files: [],
        locale: "en-US",
        personalized_styles: [],
        sync_sources: [],
        tools: [],
      }),
      signal: params.signal,
    });

    if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
    if (!res.body) throw new Error("No response body from Claude");

    return createClaudeStreamResult(res.body);
  }
}

function createClaudeStreamResult(body: ReadableStream<Uint8Array>): ChatResult {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  async function* generate(): AsyncGenerator<ChatDelta> {
    let buffer = "";

    const processLine = (line: string): ChatDelta | null => {
      if (!line || !line.startsWith("data: ")) return null;
      const dataStr = line.slice(6).trim();
      if (dataStr === "[DONE]" || !dataStr) return null;

      try {
        const data = JSON.parse(dataStr);

        // Claude SSE format: content_block_delta with delta.text
        if (data.type === "content_block_delta" && data.delta?.text) {
          return { type: "text", content: data.delta.text };
        }

        // Claude thinking
        if (data.type === "content_block_delta" && data.delta?.thinking) {
          return { type: "thinking", content: data.delta.thinking };
        }

        // Standard format fallback
        const content = data.choices?.[0]?.delta?.content || data.text || data.content || data.delta;
        if (typeof content === "string" && content) {
          return { type: "text", content };
        }
      } catch {
        // Ignore parse errors
      }
      return null;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            const delta = processLine(buffer.trim());
            if (delta) yield delta;
          }
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const combined = buffer + chunk;
        const parts = combined.split("\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const delta = processLine(part.trim());
          if (delta) yield delta;
        }
      }
    } finally {
      yield { type: "done" };
    }
  }

  return {
    stream: generate(),
    async fullText(): Promise<string> {
      let text = "";
      for await (const delta of generate()) {
        if (delta.type === "text" && delta.content) text += delta.content;
      }
      return text;
    },
  };
}
