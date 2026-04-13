import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { loadConfig } from "./config.js";
import { buildCatalog } from "./bridge/catalog.js";
import { logger, setLogLevel } from "./logger.js";
import type { LogLevel } from "./logger.js";
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ErrorResponse,
  ModelListItem,
  ModelListResponse,
  ProviderAdapter,
} from "./types.js";

// ── Globals ──

const config = loadConfig();

// Init logger
setLogLevel(config.server.logging.level as LogLevel);

const app = new Hono();
let providers = new Map<string, ProviderAdapter>();
let modelIndex = new Map<string, ProviderAdapter>();

// ── Middleware: access log ──

if (config.server.logging.accessLog) {
  app.use("*", async (c, next) => {
    const start = Date.now();
    const { method } = c.req;
    const path = new URL(c.req.url).pathname;

    await next();

    const ms = Date.now() - start;
    const status = c.res.status;

    // Log level based on status code
    const level: LogLevel = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    const color = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
    const reset = "\x1b[0m";

    logger[level](
      `${method} ${path} ${color}${status}${reset} ${ms}ms`,
      "access",
    );
  });
}

// ── Middleware: error handler ──

app.onError((err, c) => {
  logger.error(err.message, "server", { stack: err.stack });
  const body: ErrorResponse = {
    error: {
      message: err.message,
      type: "internal_error",
    },
  };
  return c.json(body, 500);
});

// ── Health check ──

app.get("/health", (c) =>
  c.json({
    status: "ok",
    providers: [...providers.keys()],
    models: [...modelIndex.keys()],
  }),
);

// ── GET /v1/models ──

app.get("/v1/models", (c) => {
  const models: ModelListItem[] = [];

  for (const provider of providers.values()) {
    for (const model of provider.models) {
      models.push({
        id: model.id,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: provider.id,
      });
    }
  }

  const response: ModelListResponse = {
    object: "list",
    data: models,
  };

  return c.json(response);
});

// ── POST /v1/chat/completions ──

app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json<ChatCompletionRequest>();

  // Find provider for requested model
  const provider = modelIndex.get(body.model);
  if (!provider) {
    const err: ErrorResponse = {
      error: {
        message: `Model '${body.model}' not found. Available: ${[...modelIndex.keys()].join(", ")}`,
        type: "invalid_request_error",
        code: "model_not_found",
      },
    };
    return c.json(err, 404);
  }

  // Streaming response
  if (body.stream !== false) {
    return streamSSE(c, async (stream) => {
      const id = `chatcmpl-${generateId()}`;
      const created = Math.floor(Date.now() / 1000);

      await provider.chat(body, {
        onText: (text) => {
          const chunk: ChatCompletionChunk = {
            id,
            object: "chat.completion.chunk",
            created,
            model: body.model,
            choices: [
              {
                index: 0,
                delta: { content: text },
                finish_reason: null,
              },
            ],
          };
          stream.writeSSE({ data: JSON.stringify(chunk), event: "chunk" });
        },
        onReasoning: (text) => {
          // Send as reasoning_content in the delta
          const data = JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created,
            model: body.model,
            choices: [
              {
                index: 0,
                delta: { reasoning_content: text },
                finish_reason: null,
              },
            ],
          });
          stream.write(`data: ${data}\n\n`);
        },
        onToolCall: (toolCall) => {
          const chunk: ChatCompletionChunk = {
            id,
            object: "chat.completion.chunk",
            created,
            model: body.model,
            choices: [
              {
                index: 0,
                delta: { tool_calls: [toolCall] },
                finish_reason: null,
              },
            ],
          };
          stream.writeSSE({ data: JSON.stringify(chunk), event: "chunk" });
        },
        onDone: () => {
          const chunk: ChatCompletionChunk = {
            id,
            object: "chat.completion.chunk",
            created,
            model: body.model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
          };
          stream.writeSSE({ data: JSON.stringify(chunk), event: "chunk" });
          stream.writeSSE({ data: "[DONE]", event: "message" });
        },
        onError: (error) => {
          const chunk: ChatCompletionChunk = {
            id,
            object: "chat.completion.chunk",
            created,
            model: body.model,
            choices: [
              {
                index: 0,
                delta: { content: `\n[Error: ${error.message}]` },
                finish_reason: "stop",
              },
            ],
          };
          stream.writeSSE({ data: JSON.stringify(chunk), event: "chunk" });
          stream.writeSSE({ data: "[DONE]", event: "message" });
        },
      });
    });
  }

  // Non-streaming response: collect all text then return
  let content = "";
  let reasoning = "";

  await provider.chat(body, {
    onText: (text) => {
      content += text;
    },
    onReasoning: (text) => {
      reasoning += text;
    },
    onToolCall: () => {},
    onDone: () => {},
    onError: (err) => {
      content += `\n[Error: ${err.message}]`;
    },
  });

  const response: ChatCompletionResponse = {
    id: `chatcmpl-${generateId()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
  };

  return c.json(response);
});

// ── Helpers ──

function generateId(): string {
  return Math.random().toString(36).slice(2, 15);
}

// ── Start ──

async function main() {
  logger.info(`Config: ${config.providers.length} provider entries`, "boot");
  logger.info(`Log level: ${config.server.logging.level}`, "boot");

  // Build provider catalog from config
  const catalog = await buildCatalog(config);
  providers = catalog.providers;
  modelIndex = catalog.modelIndex;

  logger.info(`Active providers: ${[...providers.keys()].join(", ") || "none"}`, "boot");
  logger.info(`Available models: ${[...modelIndex.keys()].join(", ") || "none"}`, "boot");

  const { serve } = await import("@hono/node-server");
  serve(
    { fetch: app.fetch, hostname: config.server.host, port: config.server.port },
    (info) => {
      logger.info(`Zero Token Service running on http://localhost:${info.port}`, "boot");
      logger.info(`POST http://localhost:${info.port}/v1/chat/completions`, "boot");
      logger.info(`GET  http://localhost:${info.port}/v1/models`, "boot");
      logger.info(`GET  http://localhost:${info.port}/health`, "boot");
    },
  );
}

main().catch((err) => {
  logger.error(err.message, "boot", { stack: err.stack });
  process.exit(1);
});
