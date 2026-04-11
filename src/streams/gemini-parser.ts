/**
 * Gemini Web Stream Parser — DOM text extraction for Gemini web UI.
 *
 * Gemini web uses DOM interaction (not REST API), so this module provides
 * utilities for extracting text from Gemini's DOM elements.
 *
 * Note: Gemini is DOM-only — there's no REST API SSE stream to parse.
 * This module provides:
 * - Text extraction from DOM with multiple selector strategies
 * - Streaming detection (stop button presence)
 * - Strip trailing UI elements (Copy, Share, etc.)
 *
 * Ported from openclaw-zero-token/src/zero-token/streams/gemini-web-stream.ts (349 lines)
 */

import type { StreamChunk } from "./parsers.js";
import { createTagAwareBuffer, type TagAwareBuffer } from "./claude-parser.js";

// ── DOM Text Extraction ──

/**
 * Configuration for Gemini DOM text extraction.
 */
export interface GeminiDOMConfig {
  /** CSS selectors to try for finding model response elements */
  modelSelectors?: string[];
  /** CSS selectors for the stop/streaming indicator */
  stopSelectors?: string[];
  /** Patterns to strip from extracted text (UI elements) */
  stripPatterns?: RegExp[];
}

/** Default model response selectors */
export const GEMINI_MODEL_SELECTORS = [
  "model-response message-content",
  '[data-message-author="model"] .message-content',
  '[data-message-author="model"]',
  '[data-sender="model"]',
  '[class*="model-response"] [class*="markdown"]',
  '[class*="model-response"]',
];

/** Default stop button selectors */
export const GEMINI_STOP_SELECTORS = [
  '[aria-label*="Stop"]',
  '[aria-label*="停止"]',
  'button[aria-label*="stop"]',
];

/** UI text patterns to strip */
export const GEMINI_STRIP_PATTERNS = [
  /\n?\s*(复制|分享|修改|朗读|Copy|Share|Edit|Read aloud)[\s\n]*/gi,
];

/**
 * Clean extracted text by removing zero-width characters and trimming.
 */
export function cleanGeminiText(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

/**
 * Strip trailing UI elements from Gemini response text.
 */
export function stripGeminiUI(text: string, patterns?: RegExp[]): string {
  let result = text;
  const pats = patterns ?? GEMINI_STRIP_PATTERNS;
  for (const pattern of pats) {
    result = result.replace(pattern, "");
  }
  return result.replace(/\s+$/, "");
}

/**
 * Process Gemini DOM text through a TagAwareBuffer to extract
 * think/tool_call tags, yielding normalized StreamChunks.
 */
export function* processGeminiDOMText(
  text: string,
  tagBuffer?: TagAwareBuffer,
): Generator<StreamChunk> {
  const buffer = tagBuffer ?? createTagAwareBuffer();

  // Clean and strip UI elements
  const cleaned = stripGeminiUI(cleanGeminiText(text));
  if (!cleaned) return;

  // Push through tag buffer for think/tool_call extraction
  for (const chunk of buffer.push(cleaned)) {
    yield chunk;
  }

  // Flush remaining buffer
  for (const chunk of buffer.flush()) {
    yield chunk;
  }
}

/**
 * Extract the last model response from a page's DOM content.
 *
 * This is a pure text-processing function — actual DOM access is done
 * by the provider via page.evaluate().
 *
 * @param domContent - Raw text content from document.querySelectorAll
 * @param minLength - Minimum text length to consider valid (default: 30)
 * @returns Cleaned text or empty string if no valid response found
 */
export function extractLastModelResponse(domContent: string[], minLength = 30): string {
  for (let i = domContent.length - 1; i >= 0; i--) {
    const cleaned = cleanGeminiText(domContent[i]);
    if (cleaned.length >= minLength) {
      return stripGeminiUI(cleaned);
    }
  }
  return "";
}
