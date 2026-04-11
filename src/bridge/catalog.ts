/**
 * Bridge: model catalog & provider factory.
 * Maps config provider entries to ProviderAdapter instances.
 */

import type { Config, ProviderConfig } from "../config.js";
import type { ProviderAdapter, ModelDefinition } from "../types.js";
import {
  DeepSeekProvider,
  createDeepSeekModels,
  ClaudeProvider,
  createClaudeModels,
  KimiProvider,
  createKimiModels,
  DoubaoProvider,
  createDoubaoModels,
  OpenAICompatProvider,
  XiaomiMimoProvider,
  createXiaomiMimoModels,
  QwenProvider,
  createQwenModels,
  QwenCNProvider,
  createQwenCNModels,
  GLMProvider,
  createGLMModels,
  GLMIntlProvider,
  createGLMIntlModels,
  PerplexityProvider,
  createPerplexityModels,
  ChatGPTProvider,
  createChatGPTModels,
  GeminiProvider,
  createGeminiModels,
  GrokProvider,
  createGrokModels,
} from "../providers/index.js";

// ── Default model catalogs for API-based providers ──

function defaultModelsFor(providerId: string): ModelDefinition[] {
  const catalog: Record<string, Array<{ id: string; name: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number }>> = {
    ollama: [
      { id: "llama3", name: "Llama 3", contextWindow: 8192, maxTokens: 4096 },
      { id: "qwen2.5", name: "Qwen 2.5", contextWindow: 32000, maxTokens: 4096 },
      { id: "mistral", name: "Mistral", contextWindow: 32000, maxTokens: 4096 },
    ],
    vllm: [
      { id: "default", name: "vLLM Default", contextWindow: 4096, maxTokens: 2048 },
    ],
    openrouter: [
      { id: "auto", name: "OpenRouter Auto", contextWindow: 200000, maxTokens: 8192 },
      { id: "openrouter/hunter-alpha", name: "Hunter Alpha", reasoning: true, contextWindow: 1048576, maxTokens: 65536 },
    ],
    together: [
      { id: "meta-llama/Llama-3-70b-chat-hf", name: "Llama 3 70B", contextWindow: 8192, maxTokens: 4096 },
      { id: "mistralai/Mixtral-8x7B-Instruct-v0.1", name: "Mixtral 8x7B", contextWindow: 32000, maxTokens: 4096 },
    ],
    qianfan: [
      { id: "deepseek-v3.2", name: "DeepSeek V3.2", reasoning: true, contextWindow: 98304, maxTokens: 32768 },
      { id: "ernie-5.0-thinking-preview", name: "ERNIE 5.0 Thinking", reasoning: true, contextWindow: 119000, maxTokens: 64000 },
    ],
    volcengine: [
      { id: "doubao-seed-1-8-251228", name: "Doubao Seed 1.8", contextWindow: 256000, maxTokens: 4096 },
      { id: "deepseek-v3-2-251201", name: "DeepSeek V3.2", contextWindow: 128000, maxTokens: 4096 },
    ],
    manus: [
      { id: "manus-1.6", name: "Manus 1.6", reasoning: true, contextWindow: 128000, maxTokens: 65536 },
      { id: "manus-1.6-lite", name: "Manus 1.6 Lite", contextWindow: 64000, maxTokens: 32768 },
    ],
    sglang: [
      { id: "default", name: "SGLang Default", contextWindow: 4096, maxTokens: 2048 },
    ],
    xai: [
      { id: "grok-2", name: "Grok 2", contextWindow: 131072, maxTokens: 4096 },
      { id: "grok-2-mini", name: "Grok 2 Mini", contextWindow: 131072, maxTokens: 4096 },
    ],
    nvidia: [
      { id: "nemotron-4-340b-instruct", name: "Nemotron 4 340B", contextWindow: 4096, maxTokens: 2048 },
    ],
    perplexity: [
      { id: "llama-3.1-sonar-huge-128k-online", name: "Sonar Huge", contextWindow: 127072, maxTokens: 4096 },
    ],
    chutes: [
      { id: "default", name: "Chutes Default", contextWindow: 4096, maxTokens: 2048 },
    ],
    minimax: [
      { id: "abab6.5s-chat", name: "ABAB 6.5s", contextWindow: 245760, maxTokens: 4096 },
    ],
  };

  const entries = catalog[providerId] ?? [{ id: "default", name: `${providerId} Default`, contextWindow: 4096, maxTokens: 2048 }];
  return entries.map((e) => ({
    ...e,
    provider: providerId,
    reasoning: e.reasoning ?? false,
    input: ["text"] as ("text" | "image")[],
    contextWindow: e.contextWindow ?? 4096,
    maxTokens: e.maxTokens ?? 2048,
  }));
}

// ── Default URLs for API-based providers ──

const DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: "http://localhost:11434",
  vllm: "http://localhost:8000",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
  qianfan: "https://qianfan.baidubce.com/v2",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  sglang: "http://localhost:30000/v1",
  xai: "https://api.x.ai/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  perplexity: "https://api.perplexity.ai",
  chutes: "https://llm.chutes.ai/v1",
  minimax: "https://api.minimax.chat/v1",
  manus: "https://api.manus.im/v1",
};

// ── Provider factory ──

function parseAuth(authStr?: string): Record<string, string> {
  if (!authStr) return {};
  try {
    return JSON.parse(authStr) as Record<string, string>;
  } catch {
    return { cookie: authStr };
  }
}

function createProvider(pCfg: ProviderConfig): ProviderAdapter | null {
  const auth = parseAuth(pCfg.auth);
  const customModels = pCfg.models?.map((m) => ({
    ...m,
    provider: pCfg.id,
    input: ["text"] as ("text" | "image")[],
  }));

  switch (pCfg.id) {
    case "deepseek-web":
      return new DeepSeekProvider(
        { cookie: auth.cookie ?? "", bearer: auth.bearer, userAgent: auth.userAgent },
        customModels,
      );

    case "claude-web":
      return new ClaudeProvider(
        {
          cookie: auth.cookie ?? "",
          organizationId: auth.organizationId,
          deviceId: auth.deviceId,
          userAgent: auth.userAgent,
        },
        customModels,
      );

    case "kimi-web":
      return new KimiProvider(
        {
          cookie: auth.cookie,
          accessToken: auth.accessToken,
          userAgent: auth.userAgent,
        },
        customModels,
      );

    case "doubao-web":
      return new DoubaoProvider(
        {
          cookie: auth.cookie,
          sessionid: auth.sessionid,
          ttwid: auth.ttwid,
          userAgent: auth.userAgent,
        },
        customModels,
      );

    case "xiaomimo-web":
      return new XiaomiMimoProvider(
        {
          cookie: auth.cookie ?? "",
          bearer: auth.bearer,
          userAgent: auth.userAgent,
        },
        customModels,
      );

    case "qwen-web":
      return new QwenProvider(
        {
          cookie: auth.cookie ?? "",
          sessionToken: auth.sessionToken,
          userAgent: auth.userAgent,
          cdpPort: auth.cdpPort ? parseInt(auth.cdpPort) : undefined,
        },
        customModels,
      );

    case "qwen-cn-web":
      return new QwenCNProvider(
        {
          cookie: auth.cookie ?? "",
          xsrfToken: auth.xsrfToken,
          userAgent: auth.userAgent,
          deviceId: auth.deviceId,
          ut: auth.ut,
          cdpPort: auth.cdpPort ? parseInt(auth.cdpPort) : undefined,
        },
        customModels,
      );

    case "glm-web":
      return new GLMProvider(
        {
          cookie: auth.cookie ?? "",
          userAgent: auth.userAgent,
          cdpPort: auth.cdpPort ? parseInt(auth.cdpPort) : undefined,
        },
        customModels,
      );

    case "glm-intl-web":
      return new GLMIntlProvider(
        {
          cookie: auth.cookie ?? "",
          userAgent: auth.userAgent,
          cdpPort: auth.cdpPort ? parseInt(auth.cdpPort) : undefined,
        },
        customModels,
      );

    case "perplexity-web":
      return new PerplexityProvider(
        {
          cookie: auth.cookie ?? "",
          userAgent: auth.userAgent,
          cdpPort: auth.cdpPort ? parseInt(auth.cdpPort) : undefined,
        },
        customModels,
      );

    case "chatgpt-web":
      return new ChatGPTProvider(
        {
          cookie: auth.cookie ?? "",
          accessToken: auth.accessToken,
          userAgent: auth.userAgent,
          cdpPort: auth.cdpPort ? parseInt(auth.cdpPort) : undefined,
        },
        customModels,
      );

    case "gemini-web":
      return new GeminiProvider(
        {
          cookie: auth.cookie ?? "",
          userAgent: auth.userAgent,
          cdpPort: auth.cdpPort ? parseInt(auth.cdpPort) : undefined,
        },
        customModels,
      );

    case "grok-web":
      return new GrokProvider(
        {
          cookie: auth.cookie ?? "",
          userAgent: auth.userAgent,
          cdpPort: auth.cdpPort ? parseInt(auth.cdpPort) : undefined,
        },
        customModels,
      );

    default: {
      // API-based providers: ollama, vllm, openrouter, etc.
      const baseUrl = auth.baseUrl ?? DEFAULT_BASE_URLS[pCfg.id] ?? `http://localhost:8080`;
      const apiKey = auth.apiKey ?? auth.bearer;
      const models = customModels ?? defaultModelsFor(pCfg.id);
      return new OpenAICompatProvider(
        pCfg.id,
        pCfg.id.charAt(0).toUpperCase() + pCfg.id.slice(1),
        { baseUrl, apiKey, userAgent: auth.userAgent },
        models,
      );
    }
  }
}

// ── Public API ──

export interface CatalogResult {
  providers: Map<string, ProviderAdapter>;
  modelIndex: Map<string, ProviderAdapter>; // model id → provider
}

export async function buildCatalog(config: Config): Promise<CatalogResult> {
  const providers = new Map<string, ProviderAdapter>();
  const modelIndex = new Map<string, ProviderAdapter>();

  for (const pCfg of config.providers) {
    if (!pCfg.enabled) continue;

    const adapter = createProvider(pCfg);
    if (!adapter) {
      console.warn(`[catalog] Unknown provider: ${pCfg.id}, skipping`);
      continue;
    }

    try {
      await adapter.init();
      providers.set(adapter.id, adapter);

      for (const model of adapter.models) {
        modelIndex.set(model.id, adapter);
      }

      console.log(`[catalog] ${adapter.id}: ${adapter.models.length} models`);
    } catch (err) {
      console.error(`[catalog] Failed to init ${pCfg.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { providers, modelIndex };
}
