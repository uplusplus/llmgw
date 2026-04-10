// Xiaomi MiMo Web Provider - HTTP fetch with cookies
import type { ProviderAdapter, ChatResult, ChatDelta, OpenAiMessage, ProviderConfig } from "../types.js";

const XIAOMIMO_BASE_URL = "https://aistudio.xiaomimimo.com";

export class XiaomiMimoProvider implements ProviderAdapter {
  private cookie: string;
  private bearer: string;
  private userAgent: string;
  private conversationId: string | null = null;

  constructor(config: ProviderConfig & { bearer?: string }) {
    this.cookie = config.cookie;
    this.bearer = config.bearer || "";
    this.userAgent = config.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
  }

  private headers() {
    const serviceTokenMatch = this.cookie.match(/serviceToken="([^"]*)"/);
    const serviceToken = serviceTokenMatch?.[1] || "";
    const botPhMatch = this.cookie.match(/xiaomichatbot_ph="([^"]*)"/);
    const botPh = botPhMatch?.[1] || "";

    return {
      Cookie: this.cookie,
      "User-Agent": this.userAgent,
      "Content-Type": "application/json",
      Accept: "*/*",
      ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
      ...(this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}),
      Referer: `${XIAOMIMO_BASE_URL}/`,
      Origin: XIAOMIMO_BASE_URL,
      "x-timezone": "Asia/Shanghai",
      ...(botPh ? { bot_ph: botPh } : {}),
    };
  }

  private buildPrompt(messages: OpenAiMessage[]): string {
    return messages
      .map((m) => {
        const role = m.role === "user" ? "User" : m.role === "system" ? "System" : "Assistant";
        const content = typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content) ? m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("") : "";
        return content ? `${role}: ${content}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  async chat(params: { messages: OpenAiMessage[]; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const prompt = this.buildPrompt(params.messages);
    if (!prompt) throw new Error("No message to send to MiMo");

    const botPhMatch = this.cookie.match(/xiaomichatbot_ph="([^"]*)"/);
    const botPh = botPhMatch?.[1] || "";

    let url = `${XIAOMIMO_BASE_URL}/open-apis/bot/chat`;
    if (botPh) url += `?xiaomichatbot_ph=${encodeURIComponent(botPh)}`;

    const body: Record<string, unknown> = { message: prompt };
    if (this.conversationId) body.conversation_id = this.conversationId;

    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) throw new Error(`MiMo API error: ${res.status} ${await res.text()}`);
    if (!res.body) throw new Error("No response body");

    return createStreamResult(res.body, this, (id) => { this.conversationId = id; });
  }
}

function createStreamResult(
  body: ReadableStream<Uint8Array>,
  _provider: XiaomiMimoProvider,
  setConversationId: (id: string) => void,
): ChatResult {
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
          if (!line) continue;

          // MiMo SSE format
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (dataStr === "[DONE]") continue;
            try {
              const data = JSON.parse(dataStr);

              // Track conversation ID
              if (data.conversation_id) setConversationId(data.conversation_id);

              // Various content formats
              if (typeof data.content === "string" && data.content) {
                yield { type: "text", content: data.content };
              } else if (typeof data.delta === "string" && data.delta) {
                yield { type: "text", content: data.delta };
              } else if (data.choices?.[0]?.delta?.content) {
                yield { type: "text", content: data.choices[0].delta.content };
              } else if (typeof data.message === "string" && data.message) {
                yield { type: "text", content: data.message };
              }
            } catch { /* ignore parse errors */ }
          } else if (line.startsWith("{") || line.startsWith("[")) {
            // Direct JSON
            try {
              const data = JSON.parse(line);
              if (typeof data.content === "string" && data.content) {
                yield { type: "text", content: data.content };
              } else if (typeof data.message === "string" && data.message) {
                yield { type: "text", content: data.message };
              } else if (data.data?.message) {
                yield { type: "text", content: data.data.message };
              }
            } catch { /* ignore */ }
          }
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
