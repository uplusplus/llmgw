// Shared types for the zero-token gateway

export interface ProviderConfig {
  cookie: string;
  bearer?: string;
  userAgent?: string;
  // Doubao-specific
  sessionid?: string;
  ttwid?: string;
  // Claude-specific
  sessionKey?: string;
  organizationId?: string;
  deviceId?: string;
}

export interface GatewayConfig {
  port: number;
  apiKey?: string;
  providers: Record<string, ProviderConfig>;
  /** Maps model names → provider key in `providers` */
  modelMapping: Record<string, string>;
}

export interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool" | "function";
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  name?: string;
  tool_call_id?: string;
}

export interface OpenAiChatRequest {
  model: string;
  messages: OpenAiMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

export interface ProviderAdapter {
  /** Send a chat request and return an async iterable of text chunks */
  chat(params: {
    messages: OpenAiMessage[];
    model: string;
    signal?: AbortSignal;
  }): Promise<ChatResult>;
}

export interface ChatResult {
  /** Async iterable of text content deltas */
  stream: AsyncIterable<ChatDelta>;
  /** For non-streaming: accumulate full text */
  fullText(): Promise<string>;
}

export interface ChatDelta {
  type: "text" | "thinking" | "tool_call_start" | "tool_call_delta" | "tool_call_end" | "done" | "error";
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  error?: string;
}
