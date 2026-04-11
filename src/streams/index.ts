/**
 * Unified stream parsers.
 *
 * Each parser converts a platform-specific response stream into a
 * normalized AsyncGenerator<StreamChunk>.
 */

export { parseSSEStream, parseConnectJSONStream } from "./parsers.js";
export type { StreamChunk } from "./parsers.js";

export { parseClaudeSSEStream, createTagAwareBuffer } from "./claude-parser.js";
export type { TagAwareBuffer } from "./claude-parser.js";

export { parseDoubaoSSEStream } from "./doubao-parser.js";

// P0 enhanced parsers (ported from openclaw-zero-token)
export { parseChatGPTSSEStream } from "./chatgpt-parser.js";
export { parseGrokSSEStream } from "./grok-parser.js";
export { parseGLMSSEStream, parseGLMIntlSSEStream } from "./glm-parser.js";
export { parseQwenSSEStream, parseQwenCNSSEStream } from "./qwen-parser.js";
export { parsePerplexitySSEStream } from "./perplexity-parser.js";

// DOM-only providers (utilities for Gemini)
export {
  processGeminiDOMText,
  extractLastModelResponse,
  cleanGeminiText,
  stripGeminiUI,
  GEMINI_MODEL_SELECTORS,
  GEMINI_STOP_SELECTORS,
  GEMINI_STRIP_PATTERNS,
} from "./gemini-parser.js";
export type { GeminiDOMConfig } from "./gemini-parser.js";
