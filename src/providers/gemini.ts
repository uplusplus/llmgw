/// <reference lib="dom" />
/**
 * Gemini Web Provider — cookie auth, DOM interaction via Playwright CDP.
 * Ported from openclaw-zero-token.
 */

import { chromium, type BrowserContext, type Page } from "playwright-core";
import type {
  ProviderAdapter,
  ModelDefinition,
  ChatCompletionRequest,
  StreamCallbacks,
} from "../types.js";
import { buildPrompt, DEFAULT_USER_AGENT } from "./base.js";
import {
  getChromeWebSocketUrl,
  isChromeReachable,
  cdpUrlForPort,
} from "../browser/cdp.js";
import {
  cleanGeminiText,
  stripGeminiUI,
  GEMINI_MODEL_SELECTORS,
  GEMINI_STOP_SELECTORS,
} from "../streams/gemini-parser.js";

export interface GeminiProviderOptions {
  cookie: string;
  userAgent?: string;
  cdpPort?: number;
  cdpUrl?: string;
}

export function createGeminiModels(): ModelDefinition[] {
  return [
    {
      id: "gemini-pro",
      name: "Gemini Pro",
      provider: "gemini-web",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 32768,
      maxTokens: 8192,
    },
    {
      id: "gemini-ultra",
      name: "Gemini Ultra",
      provider: "gemini-web",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 128000,
      maxTokens: 8192,
    },
  ];
}

export class GeminiProvider implements ProviderAdapter {
  readonly id = "gemini-web";
  readonly name = "Gemini Web";
  readonly models: ModelDefinition[];

  private cookie: string;
  private userAgent: string;
  private cdpPort: number;
  private cdpUrl: string;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(opts: GeminiProviderOptions, models?: ModelDefinition[]) {
    this.cookie = opts.cookie;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.cdpPort = opts.cdpPort ?? 9222;
    this.cdpUrl = opts.cdpUrl ?? cdpUrlForPort(this.cdpPort);
    this.models = models ?? createGeminiModels();
  }

  async init(): Promise<void> {
    await this.ensureBrowser();
    console.log("[gemini-web] Initialized");
  }

  async close(): Promise<void> {
    this.page = null;
    this.context = null;
  }

  async chat(request: ChatCompletionRequest, callbacks: StreamCallbacks): Promise<void> {
    try {
      const { page } = await this.ensureBrowser();
      const prompt = buildPrompt(request.messages);
      if (!prompt) throw new Error("No message to send");

      // Navigate if needed
      if (!page.url().includes("gemini.google.com")) {
        await page.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded" });
      }

      // Find input
      const inputSelectors = [
        'textarea[placeholder*="Gemini"]',
        'textarea[placeholder*="问问"]',
        'textarea[aria-label*="prompt"]',
        "textarea",
        'div[role="textbox"]',
        '[contenteditable="true"]',
      ];
      let inputHandle = null;
      for (const sel of inputSelectors) {
        inputHandle = await page.$(sel);
        if (inputHandle) break;
      }
      if (!inputHandle) throw new Error("Gemini: input not found on page");

      await inputHandle.click();
      await page.waitForTimeout(300);
      await page.keyboard.type(prompt, { delay: 20 });
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");

      const maxWaitMs = 120000;
      let lastText = "";
      let stableCount = 0;

      for (let elapsed = 0; elapsed < maxWaitMs; elapsed += 2000) {
        await page.waitForTimeout(2000);

        const result = await page.evaluate(() => {
          const clean = (t: string) => t.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
          const stripTrailingUI = (t: string) =>
            t.replace(/\n?\s*(复制|分享|修改|朗读|Copy|Share|Edit|Read aloud)[\s\n]*/gi, "").replace(/\s+$/, "");

          const modelSelectors = [
            "model-response message-content",
            '[data-message-author="model"] .message-content',
            '[data-message-author="model"]',
            '[data-sender="model"]',
            '[class*="model-response"] [class*="markdown"]',
            '[class*="model-response"]',
          ];

          let text = "";
          for (const sel of modelSelectors) {
            const els = document.querySelectorAll(sel);
            for (let i = els.length - 1; i >= 0; i--) {
              const t = clean((els[i] as HTMLElement).innerText ?? "");
              if (t.length >= 30) {
                text = stripTrailingUI(t);
                break;
              }
            }
            if (text) break;
          }

          const isStreaming = !!document.querySelector('[aria-label*="Stop"], [aria-label*="停止"]');
          return { text, isStreaming };
        });

        if (result.text && result.text.length >= 40) {
          if (result.text !== lastText) {
            lastText = result.text;
            stableCount = 0;
          } else {
            stableCount++;
            if (!result.isStreaming && stableCount >= 2) break;
          }
        }
      }

      if (!lastText) throw new Error("Gemini: no response detected");

      callbacks.onText(lastText);
      callbacks.onDone();
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async ensureBrowser(): Promise<{ context: BrowserContext; page: Page }> {
    if (this.context && this.page) return { context: this.context, page: this.page };

    const reachable = await isChromeReachable(this.cdpUrl, 2000);
    if (!reachable) {
      throw new Error(`Gemini: Chrome not reachable at ${this.cdpUrl}. Start with --remote-debugging-port=9222.`);
    }

    const wsUrl = await getChromeWebSocketUrl(this.cdpUrl, 5000);
    if (!wsUrl) throw new Error(`Gemini: cannot get WebSocket URL`);

    const browser = await chromium.connectOverCDP(wsUrl);
    this.context = browser.contexts()[0];
    if (!this.context) this.context = await browser.newContext();

    const pages = this.context.pages();
    this.page = pages.find(p => p.url().includes("gemini.google.com")) ?? null;
    if (!this.page) {
      this.page = await this.context.newPage();
      await this.page.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded" });
    }

    if (this.cookie) {
      const cookies = this.cookie.split(";").map(c => {
        const [name, ...valueParts] = c.trim().split("=");
        return { name: name.trim(), value: valueParts.join("=").trim(), domain: ".google.com", path: "/" };
      }).filter(c => c.name);
      if (cookies.length > 0) await this.context.addCookies(cookies).catch(() => {});
    }

    return { context: this.context, page: this.page };
  }
}
