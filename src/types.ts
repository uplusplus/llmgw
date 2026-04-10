/**
 * Core type definitions for zero-token-service.
 * Independent of OpenClaw internal types.
 */

// ── Model & Provider ──

export interface ModelDefinition {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
}

export interface ProviderAuth {
  /** JSON-stringified auth payload (cookies, session keys, etc.) */
  sessionData: string;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  models: ModelDefinition[];
  auth?: ProviderAuth;
}

// ── Chat Messages (OpenAI-compatible) ──

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: "low" | "high" | "auto" };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[] | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

// ── Request / Response (OpenAI-compatible) ──

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string | string[];
  tools?: ToolDefinition[];
  tool_choice?: string | { type: string; function: { name: string } };
  user?: string;
}

export interface ChatCompletionChoice {
  index: number;
  message?: ChatMessage;
  delta?: Partial<ChatMessage>;
  finish_reason: "stop" | "length" | "tool_calls" | null;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: UsageInfo;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: UsageInfo | null;
}

export interface ModelListResponse {
  object: "list";
  data: ModelListItem[];
}

export interface ModelListItem {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface ErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}

// ── Stream Parser ──

export interface StreamCallbacks {
  onText: (text: string) => void;
  onReasoning: (text: string) => void;
  onToolCall: (toolCall: ToolCall) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

// ── Provider Adapter Interface ──

/**
 * Each provider implements this interface to bridge between
 * OpenAI-format requests and platform-specific browser interactions.
 */
export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly models: ModelDefinition[];

  /** Initialize browser session (login / attach) */
  init(): Promise<void>;

  /** Send a chat completion request, streaming chunks via callbacks */
  chat(request: ChatCompletionRequest, callbacks: StreamCallbacks): Promise<void>;

  /** Clean up resources */
  close(): Promise<void>;
}
