// Kimi Web Provider - HTTP fetch with cookies
import type { ProviderAdapter, ChatResult, ChatDelta, OpenAiMessage, ProviderConfig } from "../types.js";

export class KimiProvider implements ProviderAdapter {
  private cookie: string;
  private userAgent: string;
  private accessToken: string;
  private conversationMap = new Map<string, string>();

  constructor(config: ProviderConfig & { accessToken?: string }) {
    this.cookie = config.cookie;
    this.accessToken = config.accessToken || "";
    this.userAgent = config.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  }

  private async headers() {
    return {
      "Content-Type": "application/json",
      Cookie: this.cookie,
      "User-Agent": this.userAgent,
      Referer: "https://kimi.moonshot.cn/",
      Origin: "https://kimi.moonshot.cn",
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
    };
  }

  private buildPrompt(messages: OpenAiMessage[]): string {
    return messages
      .filter((m) => m.role !== "system" || true)
      .map((m) => {
        const role = m.role === "user" ? "User" : m.role === "system" ? "System" : "Assistant";
        const content = typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content) ? m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("") : "";
        return `${role}: ${content}`;
      })
      .filter(Boolean)
      .join("\n\n");
  }

  async chat(params: { messages: OpenAiMessage[]; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const prompt = this.buildPrompt(params.messages);
    if (!prompt) throw new Error("No message to send to Kimi");

    // Kimi uses a chat + SSE endpoint
    const res = await fetch("https://kimi.moonshot.cn/api/chat/completions", {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({
        messages: params.messages.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : "",
        })),
        model: params.model || "moonshot-v1-128k",
        stream: true,
      }),
      signal: params.signal,
    });

    if (!res.ok) throw new Error(`Kimi API error: ${res.status}`);
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
            const content = data.choices?.[0]?.delta?.content;
            if (typeof content === "string" && content) {
              yield { type: "text", content };
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
