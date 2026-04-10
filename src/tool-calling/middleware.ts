/**
 * Tool-calling middleware (standalone — no OpenClaw dependencies).
 *
 * Converts OpenAI function calling format (tools[] / tool_calls[])
 * to/from prompt-injected tool calling for web-based LLM providers.
 *
 * For platforms that don't support native tool calling (DeepSeek, Kimi),
 * this module injects tool definitions into the system prompt and parses
 * tool_call tags from the response text.
 */

import type { ToolDefinition, ToolCall, ChatMessage } from "../types.js";

// ── Tool Definitions (compact, ~350 chars total) ──

export interface WebToolDef {
  name: string;
  description: string;
  parameters: Record<string, string>;
}

const WEB_CORE_TOOLS: WebToolDef[] = [
  { name: "web_search", description: "Search web", parameters: { query: "string" } },
  { name: "web_fetch", description: "Fetch URL", parameters: { url: "string" } },
  { name: "exec", description: "Run command", parameters: { command: "string" } },
  { name: "read", description: "Read file", parameters: { path: "string" } },
  { name: "write", description: "Write file", parameters: { path: "string", content: "string" } },
  { name: "message", description: "Send msg", parameters: { text: "string", channel: "string" } },
];

function toolDefsJson(): string {
  return JSON.stringify(
    WEB_CORE_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  );
}

// ── Prompt Templates ──

const TOOL_DEFS = toolDefsJson();

const TOOL_EXAMPLE = `Example: to add 1 to number 5, return:
\`\`\`tool_json
{"tool":"plus_one","parameters":{"number":"5"}}
\`\`\`
(plus_one is just an example, not a real tool)`;

const EN_TEMPLATE = `Tools: ${TOOL_DEFS}

${TOOL_EXAMPLE}

Your actual tools are listed above. To use one, reply ONLY with the tool_json block.
No tool needed? Answer directly.

`;

const EN_STRICT_TEMPLATE = `Tools: ${TOOL_DEFS}

${TOOL_EXAMPLE}

Your actual tools are listed above. To use one, reply ONLY with the tool_json block. No extra text.
No tool needed? Answer directly.

`;

const CN_TEMPLATE = `工具: ${TOOL_DEFS}

示例: 要给数字5加1，返回:
\`\`\`tool_json
{"tool":"plus_one","parameters":{"number":"5"}}
\`\`\`
(plus_one仅为示例，非真实工具)

你的真实工具见上方列表。需要时只回复tool_json块。不需要则直接回答。

`;

// ── Model Classification ──

const EXCLUDED_MODELS = new Set(["perplexity-web", "doubao-web"]);

const CN_MODELS = new Set([
  "deepseek-web",
  "doubao-web",
  "qwen-web",
  "qwen-cn-web",
  "kimi-web",
  "glm-web",
  "xiaomimo-web",
]);

const STRICT_MODELS = new Set(["chatgpt-web"]);

// ── Tool Prompt Injection ──

export interface ToolInjectionResult {
  /** Whether tool prompt should be injected */
  inject: boolean;
  /** The final prompt to send */
  prompt: string;
}

/**
 * Determine if tool prompt should be injected for a given provider.
 */
export function shouldInjectToolPrompt(providerId: string): boolean {
  return !EXCLUDED_MODELS.has(providerId);
}

/**
 * Get the appropriate tool prompt template for a provider.
 */
export function getToolPrompt(providerId: string): string {
  if (STRICT_MODELS.has(providerId)) return EN_STRICT_TEMPLATE;
  if (CN_MODELS.has(providerId)) return CN_TEMPLATE;
  return EN_TEMPLATE;
}

/**
 * Inject tool prompt into user message if appropriate.
 * Returns the injection result with the final prompt.
 */
export function injectToolPrompt(
  providerId: string,
  userMessage: string,
  hasTools: boolean,
): ToolInjectionResult {
  if (!hasTools || !shouldInjectToolPrompt(providerId)) {
    return { inject: false, prompt: userMessage };
  }

  // Only inject when message likely needs tool use (keyword check)
  if (!needsToolInjection(userMessage)) {
    return { inject: false, prompt: userMessage };
  }

  return { inject: true, prompt: getToolPrompt(providerId) + userMessage };
}

/**
 * Format tool result for feedback to the model.
 */
export function formatToolResult(toolName: string, result: string): string {
  return `Tool ${toolName} returned: ${result}\nPlease continue answering based on this result.`;
}

// ── Tool Call Extraction ──

interface ParsedToolCall {
  tool: string;
  parameters: Record<string, unknown>;
}

// Fenced code block format (most reliable)
const FENCED_REGEX = /```tool_json\s*\n?\s*(\{[\s\S]*?\})\}?\s*\n?\s*```/;

// Bare JSON format
const BARE_JSON_REGEX = /\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"parameters"\s*:\s*(\{[\s\S]*?\})\s*\}/;

// XML tool_call format
const XML_TOOL_REGEX = /<tool_call[^>]*>([\s\S]*?)<\/tool_call>/;

/**
 * Extract a tool call from response text.
 * Supports fenced JSON, bare JSON, and XML formats.
 * Returns null if no tool call found.
 */
export function extractToolCalls(text: string): ToolCall | null {
  // 1. Try fenced format
  const fenced = FENCED_REGEX.exec(text);
  if (fenced) {
    const parsed = parseToolJson(fenced[1]);
    if (parsed) return toToolCall(parsed);
  }

  // 2. Try bare JSON
  const bare = BARE_JSON_REGEX.exec(text);
  if (bare) {
    try {
      const params = JSON.parse(bare[2]);
      return toToolCall({ tool: bare[1], parameters: params });
    } catch {
      // ignore
    }
  }

  // 3. Try XML format
  const xml = XML_TOOL_REGEX.exec(text);
  if (xml) {
    const parsed = parseToolJson(xml[1]);
    if (parsed) return toToolCall(parsed);
  }

  // 4. Fuzzy repair: truncated JSON (common with SSE stream drops)
  const fuzzyMatch = text.match(/\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"parameters"\s*:\s*\{([^}]*)\}/);
  if (fuzzyMatch) {
    const repaired = `{"tool":"${fuzzyMatch[1]}","parameters":{${fuzzyMatch[2]}}}`;
    const parsed = parseToolJson(repaired);
    if (parsed) return toToolCall(parsed);
  }

  return null;
}

/**
 * Quick check if text likely contains a tool call (without full parsing).
 */
export function hasToolCall(text: string): boolean {
  return FENCED_REGEX.test(text) || BARE_JSON_REGEX.test(text) || XML_TOOL_REGEX.test(text);
}

// ── Internal Helpers ──

function parseToolJson(raw: string): ParsedToolCall | null {
  try {
    let cleaned = raw.trim();

    // Auto-repair: if JSON has unbalanced braces, try appending }
    const opens = (cleaned.match(/\{/g) || []).length;
    const closes = (cleaned.match(/\}/g) || []).length;
    if (opens > closes) {
      cleaned += "}".repeat(opens - closes);
    }

    const obj = JSON.parse(cleaned);

    // Format 1: {"tool":"name","parameters":{...}} (ComfyUI LLM Party format)
    if (obj.tool && typeof obj.tool === "string") {
      return {
        tool: obj.tool,
        parameters: obj.parameters ?? {},
      };
    }

    // Format 2: {"name":"...","arguments":{...}} (OpenAI format)
    if (obj.name && typeof obj.name === "string") {
      return {
        tool: obj.name,
        parameters: obj.arguments ?? {},
      };
    }

    return null;
  } catch {
    return null;
  }
}

function toToolCall(parsed: ParsedToolCall): ToolCall {
  return {
    id: `web_tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: {
      name: parsed.tool,
      arguments: JSON.stringify(parsed.parameters),
    },
  };
}

/**
 * Quick keyword check: does this message likely need tool use?
 */
function needsToolInjection(message: string): boolean {
  const lower = message.toLowerCase();
  const keywords = [
    "文件", "file", "read", "write", "创建", "写入", "读取", "打开", "保存",
    "桌面", "desktop", "目录", "directory", "folder", "文件夹",
    "执行", "运行", "命令", "command", "run", "exec", "terminal", "终端", "shell",
    "搜索", "search", "查找", "查询", "fetch", "抓取", "网页", "url", "http",
    "天气", "weather", "新闻", "news",
    "发送", "send", "消息", "message", "通知", "notify",
    "帮我", "help me", "查看", "check", "look", "看看", "show",
    "下载", "download", "安装", "install", "更新", "update",
  ];
  return keywords.some((kw) => lower.includes(kw));
}
