import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import type {
  GatewayConfig,
  OpenAiChatRequest,
  OpenAiMessage,
  ProviderAdapter,
  ChatDelta,
} from "./types.js";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { ClaudeProvider } from "./providers/claude.js";
import { KimiProvider } from "./providers/kimi.js";
import { OpenAICompatProvider } from "./providers/openai-compat.js";
import { XiaomiMimoProvider } from "./providers/xiaomimo.js";
import {
  ChatGPTPlaywrightProvider,
  GeminiPlaywrightProvider,
  GrokPlaywrightProvider,
  QwenPlaywrightProvider,
  QwenCNPlaywrightProvider,
  GlmPlaywrightProvider,
  GlmIntlPlaywrightProvider,
  DoubaoPlaywrightProvider,
  PerplexityPlaywrightProvider,
  KimiPlaywrightProvider,
} from "./providers/playwright/index.js";

// ── Provider registry ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProviderFactory = (config: any) => ProviderAdapter;

const providerFactories: Record<string, ProviderFactory> = {
  // HTTP-based providers (no browser needed)
  deepseek: (cfg) => new DeepSeekProvider(cfg),
  claude: (cfg) => new ClaudeProvider(cfg),
  kimi: (cfg) => new KimiProvider(cfg),
  "openai-compat": (cfg) => new OpenAICompatProvider(cfg),
  ollama: (cfg) => new OpenAICompatProvider({ ...cfg, baseUrl: cfg.baseUrl || "http://localhost:11434" }),
  vllm: (cfg) => new OpenAICompatProvider({ ...cfg, baseUrl: cfg.baseUrl || "http://localhost:8000" }),
  xiaomimo: (cfg) => new XiaomiMimoProvider(cfg),

  // Playwright-based providers (require browser)
  chatgpt: (cfg) => new ChatGPTPlaywrightProvider(cfg),
  gemini: (cfg) => new GeminiPlaywrightProvider(cfg),
  grok: (cfg) => new GrokPlaywrightProvider(cfg),
  qwen: (cfg) => new QwenPlaywrightProvider(cfg),
  "qwen-cn": (cfg) => new QwenCNPlaywrightProvider(cfg),
  glm: (cfg) => new GlmPlaywrightProvider(cfg),
  "glm-intl": (cfg) => new GlmIntlPlaywrightProvider(cfg),
  doubao: (cfg) => new DoubaoPlaywrightProvider(cfg),
  perplexity: (cfg) => new PerplexityPlaywrightProvider(cfg),
  "kimi-pw": (cfg) => new KimiPlaywrightProvider(cfg),
};

function createProviders(gwConfig: GatewayConfig): Map<string, ProviderAdapter> {
  const map = new Map<string, ProviderAdapter>();
  for (const [key, providerConfig] of Object.entries(gwConfig.providers)) {
    // Determine provider type from config or key name
    const cfg = providerConfig as unknown as Record<string, unknown>;
    const type = (cfg._type as string) || key;
    const factory = providerFactories[type];
    if (!factory) {
      console.warn(`[Providers] Unknown provider type "${type}" for key "${key}", skipping`);
      continue;
    }
    map.set(key, factory(cfg));
  }
  return map;
}

// ── Model → Provider mapping ────────────────────────────────────────

function resolveProvider(
  model: string,
  modelMapping: Record<string, string>,
  providers: Map<string, ProviderAdapter>,
): { provider: ProviderAdapter; actualModel: string } | null {
  // Direct mapping
  if (modelMapping[model]) {
    const key = modelMapping[model];
    const provider = providers.get(key);
    if (provider) return { provider, actualModel: model };
  }

  // Prefix matching: model like "deepseek-chat" → match "deepseek-*"
  for (const [pattern, providerKey] of Object.entries(modelMapping)) {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (model.startsWith(prefix)) {
        const provider = providers.get(providerKey);
        if (provider) return { provider, actualModel: model };
      }
    }
  }

  // Try to find provider by model name prefix
  for (const [pattern, providerKey] of Object.entries(modelMapping)) {
    if (model.startsWith(pattern) || pattern.startsWith(model.split("-")[0])) {
      const provider = providers.get(providerKey);
      if (provider) return { provider, actualModel: model };
    }
  }

  return null;
}

// ── OpenAI message builder ──────────────────────────────────────────

function buildPrompt(messages: OpenAiMessage[]): { prompt: string; systemPrompt?: string } {
  const systemParts: string[] = [];
  const conversationParts: string[] = [];

  for (const m of messages) {
    const content = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content.filter((p: Record<string, unknown>) => p.type === "text").map((p: Record<string, unknown>) => p.text).join("\n")
        : "";

    if (!content) continue;

    if (m.role === "system") {
      systemParts.push(content);
    } else if (m.role === "user") {
      conversationParts.push(`User: ${content}`);
    } else if (m.role === "assistant") {
      conversationParts.push(`Assistant: ${content}`);
    } else if (m.role === "tool" || m.role === "function") {
      conversationParts.push(`Tool: ${content}`);
    }
  }

  const prompt = conversationParts.join("\n\n");
  const systemPrompt = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

  return { prompt, systemPrompt };
}

// ── SSE helpers ─────────────────────────────────────────────────────

function setSseHeaders(res: ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

function writeSse(res: ServerResponse, data: unknown) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeDone(res: ServerResponse) {
  res.write("data: [DONE]\n\n");
}

// ── Request handlers ────────────────────────────────────────────────

async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  config: GatewayConfig,
  providers: Map<string, ProviderAdapter>,
) {
  // Read body
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const bodyStr = Buffer.concat(chunks).toString();

  let body: OpenAiChatRequest;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }));
    return;
  }

  const model = body.model || "";
  const stream = body.stream !== false; // Default to streaming

  if (!model) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Missing 'model' field", type: "invalid_request_error" } }));
    return;
  }

  if (!body.messages || body.messages.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Missing 'messages' field", type: "invalid_request_error" } }));
    return;
  }

  const resolved = resolveProvider(model, config.modelMapping, providers);
  if (!resolved) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: {
        message: `No provider found for model "${model}". Available models: ${Object.keys(config.modelMapping).join(", ")}`,
        type: "invalid_request_error",
      },
    }));
    return;
  }

  const { provider, actualModel } = resolved;
  const runId = `chatcmpl_${randomUUID()}`;
  const createdAt = Math.floor(Date.now() / 1000);

  try {
    const result = await provider.chat({
      messages: body.messages,
      model: actualModel,
    });

    if (!stream) {
      // Non-streaming: accumulate all text
      const fullText = await result.fullText();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: runId,
        object: "chat.completion",
        created: createdAt,
        model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: fullText },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }));
      return;
    }

    // Streaming SSE
    setSseHeaders(res);

    // Send initial role chunk
    writeSse(res, {
      id: runId,
      object: "chat.completion.chunk",
      created: createdAt,
      model,
      choices: [{ index: 0, delta: { role: "assistant" } }],
    });

    let closed = false;
    req.on("close", () => { closed = true; });

    try {
      for await (const delta of result.stream) {
        if (closed) break;

        if (delta.type === "text" && delta.content) {
          writeSse(res, {
            id: runId,
            object: "chat.completion.chunk",
            created: createdAt,
            model,
            choices: [{ index: 0, delta: { content: delta.content }, finish_reason: null }],
          });
        } else if (delta.type === "thinking" && delta.content) {
          // Send thinking content as reasoning_content in the delta
          writeSse(res, {
            id: runId,
            object: "chat.completion.chunk",
            created: createdAt,
            model,
            choices: [{ index: 0, delta: { reasoning_content: delta.content }, finish_reason: null }],
          });
        } else if (delta.type === "tool_call_start" && delta.toolCall) {
          writeSse(res, {
            id: runId,
            object: "chat.completion.chunk",
            created: createdAt,
            model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  id: delta.toolCall.id,
                  type: "function",
                  function: { name: delta.toolCall.name, arguments: delta.toolCall.arguments },
                }],
              },
              finish_reason: null,
            }],
          });
        } else if (delta.type === "tool_call_delta" && delta.toolCall) {
          writeSse(res, {
            id: runId,
            object: "chat.completion.chunk",
            created: createdAt,
            model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { arguments: delta.toolCall.arguments },
                }],
              },
              finish_reason: null,
            }],
          });
        } else if (delta.type === "tool_call_end") {
          writeSse(res, {
            id: runId,
            object: "chat.completion.chunk",
            created: createdAt,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          });
        } else if (delta.type === "done") {
          writeSse(res, {
            id: runId,
            object: "chat.completion.chunk",
            created: createdAt,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          });
        } else if (delta.type === "error") {
          writeSse(res, {
            id: runId,
            object: "chat.completion.chunk",
            created: createdAt,
            model,
            choices: [{ index: 0, delta: { content: `[Error: ${delta.error || "unknown error"}]` }, finish_reason: "stop" }],
          });
        }
      }
    } catch (streamErr) {
      if (!closed) {
        writeSse(res, {
          id: runId,
          object: "chat.completion.chunk",
          created: createdAt,
          model,
          choices: [{ index: 0, delta: { content: `[Stream error: ${streamErr instanceof Error ? streamErr.message : "unknown"}]` }, finish_reason: "stop" }],
        });
      }
    }

    if (!closed) {
      writeDone(res);
      res.end();
    }
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: {
          message: err instanceof Error ? err.message : "Internal server error",
          type: "api_error",
        },
      }));
    } else {
      writeSse(res, {
        id: runId,
        object: "chat.completion.chunk",
        created: createdAt,
        model,
        choices: [{ index: 0, delta: { content: `[Error: ${err instanceof Error ? err.message : "unknown"}]` }, finish_reason: "stop" }],
      });
      writeDone(res);
      res.end();
    }
  }
}

function handleModels(res: ServerResponse, config: GatewayConfig) {
  const models = Object.entries(config.modelMapping).map(([modelId]) => ({
    id: modelId,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "zero-token-gateway",
  }));

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ object: "list", data: models }));
}

// ── Auth middleware ──────────────────────────────────────────────────

function checkAuth(req: IncomingMessage, config: GatewayConfig): boolean {
  if (!config.apiKey) return true; // No auth required

  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  return match[1] === config.apiKey;
}

// ── Main server ─────────────────────────────────────────────────────

async function main() {
  const config = loadConfig();
  const providers = createProviders(config);

  console.log(`[Server] Loaded providers: ${Array.from(providers.keys()).join(", ")}`);
  console.log(`[Server] Model mappings: ${Object.keys(config.modelMapping).length} models`);
  console.log(`[Server] Auth: ${config.apiKey ? "API key required" : "open (no API key)"}`);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const method = req.method?.toUpperCase();

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check for API endpoints
    if (url.pathname.startsWith("/v1/") && !checkAuth(req, config)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key", type: "authentication_error" } }));
      return;
    }

    // Routes
    if (method === "POST" && url.pathname === "/v1/chat/completions") {
      await handleChatCompletions(req, res, config, providers);
      return;
    }

    if (method === "GET" && url.pathname === "/v1/models") {
      handleModels(res, config);
      return;
    }

    if (method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        providers: Array.from(providers.keys()),
        models: Object.keys(config.modelMapping),
      }));
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Not found", type: "invalid_request_error" } }));
  });

  server.listen(config.port, () => {
    console.log(`\n🚀 Zero Token Gateway running on http://localhost:${config.port}`);
    console.log(`\nOpenAI-compatible endpoints:`);
    console.log(`  POST http://localhost:${config.port}/v1/chat/completions`);
    console.log(`  GET  http://localhost:${config.port}/v1/models`);
    console.log(`  GET  http://localhost:${config.port}/health`);
    console.log(`\nExample curl:`);
    console.log(`  curl -X POST http://localhost:${config.port}/v1/chat/completions \\`);
    if (config.apiKey) {
      console.log(`    -H "Authorization: Bearer ${config.apiKey}" \\`);
    }
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"model":"${Object.keys(config.modelMapping)[0] || "deepseek-chat"}","messages":[{"role":"user","content":"Hello!"}],"stream":true}'`);
    console.log("");
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
