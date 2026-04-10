/**
 * Tool-calling middleware.
 *
 * Converts OpenAI function calling format (tools[] / tool_calls[])
 * to/from platform-specific representations.
 *
 * For platforms that don't support native tool calling (DeepSeek, Kimi),
 * this module injects tool definitions into the system prompt and parses
 * tool_call tags from the response text.
 */

export {
  injectToolPrompt,
  extractToolCalls,
  hasToolCall,
  shouldInjectToolPrompt,
  getToolPrompt,
  formatToolResult,
} from "./middleware.js";
export type { ToolInjectionResult, WebToolDef } from "./middleware.js";
