import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { ProviderAdapter, ChatResult, ChatDelta, OpenAiMessage, ProviderConfig } from "../../types.js";

export interface PlaywrightProviderConfig extends ProviderConfig {
  /** Cookie string from the target website */
  cookie: string;
  /** Target website URL */
  siteUrl: string;
  /** Cookie domain (e.g. ".chatgpt.com") */
  cookieDomain: string;
  /** User agent string */
  userAgent?: string;
  /** Path to Chromium/Chrome binary */
  browserPath?: string;
  /** Use headless mode (default: true) */
  headless?: boolean;
  /** Connect to existing Chrome via CDP URL (e.g. http://127.0.0.1:9222) */
  cdpUrl?: string;
}

/**
 * Base class for Playwright-based providers.
 * Handles browser lifecycle, cookie injection, and provides
 * a common interface for site-specific adapters.
 */
export abstract class PlaywrightProvider implements ProviderAdapter {
  protected cookie: string;
  protected siteUrl: string;
  protected cookieDomain: string;
  protected userAgent: string;
  protected browserPath?: string;
  protected headless: boolean;
  protected cdpUrl?: string;

  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;
  protected page: Page | null = null;
  protected initialized = false;

  constructor(config: PlaywrightProviderConfig) {
    this.cookie = config.cookie;
    this.siteUrl = config.siteUrl;
    this.cookieDomain = config.cookieDomain;
    this.userAgent = config.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    this.browserPath = config.browserPath;
    this.headless = config.headless !== false;
    this.cdpUrl = config.cdpUrl;
  }

  protected parseCookies(): Array<{ name: string; value: string; domain: string; path: string }> {
    return this.cookie
      .split(";")
      .filter((c) => c.trim().includes("="))
      .map((cookie) => {
        const [name, ...valueParts] = cookie.trim().split("=");
        return {
          name: name?.trim() ?? "",
          value: valueParts.join("=").trim(),
          domain: this.cookieDomain,
          path: "/",
        };
      })
      .filter((c) => c.name.length > 0);
  }

  protected async ensureBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    if (this.browser && this.context && this.page) {
      return { browser: this.browser, context: this.context, page: this.page };
    }

    if (this.cdpUrl) {
      // Connect to existing Chrome via CDP
      console.log(`[${this.constructor.name}] Connecting to Chrome at ${this.cdpUrl}`);
      this.browser = await chromium.connectOverCDP(this.cdpUrl);
      this.context = this.browser.contexts()[0] || (await this.browser.newContext());

      const existingPages = this.context.pages();
      const sitePage = existingPages.find((p) => p.url().includes(new URL(this.siteUrl).hostname));
      this.page = sitePage || (await this.context.newPage());
    } else {
      // Launch headless browser
      const launchOptions: Record<string, unknown> = {
        headless: this.headless,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
        ],
      };
      if (this.browserPath) {
        launchOptions.executablePath = this.browserPath;
      }

      console.log(`[${this.constructor.name}] Launching browser (headless=${this.headless})`);
      this.browser = await chromium.launch(launchOptions);
      this.context = await this.browser.newContext({
        userAgent: this.userAgent,
        viewport: { width: 1440, height: 900 },
      });
      this.page = await this.context.newPage();
    }

    // Inject cookies
    const cookies = this.parseCookies();
    if (cookies.length > 0) {
      try {
        await this.context.addCookies(cookies);
        console.log(`[${this.constructor.name}] Injected ${cookies.length} cookies`);
      } catch (e) {
        console.warn(`[${this.constructor.name}] Failed to add cookies:`, e);
      }
    }

    this.initialized = true;
    return { browser: this.browser, context: this.context, page: this.page };
  }

  /** Site-specific: type message and read response from DOM */
  protected abstract chatViaDOM(params: {
    message: string;
    model: string;
    signal?: AbortSignal;
  }): Promise<ChatResult>;

  /** Try API call via page.evaluate first, fall back to DOM */
  async chat(params: { messages: OpenAiMessage[]; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    await this.ensureBrowser();

    const prompt = this.buildPrompt(params.messages);
    if (!prompt) throw new Error("No message to send");

    return this.chatViaDOM({ message: prompt, model: params.model, signal: params.signal });
  }

  protected buildPrompt(messages: OpenAiMessage[]): string {
    return messages
      .map((m) => {
        const role = m.role === "system" ? "System" : m.role === "user" ? "User" : "Assistant";
        const content = typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content) ? m.content.filter((p: Record<string, unknown>) => p.type === "text").map((p: Record<string, unknown>) => p.text).join("") : "";
        return content ? `${role}: ${content}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
      this.initialized = false;
    }
  }
}

/**
 * Helper: create a ChatResult from a final text string.
 * DOM-based providers return the full text at once (not truly streaming).
 */
export function createDomChatResult(fullText: string): ChatResult {
  async function* generate(): AsyncGenerator<ChatDelta> {
    // Yield in chunks to simulate streaming
    const chunkSize = 50;
    for (let i = 0; i < fullText.length; i += chunkSize) {
      yield { type: "text", content: fullText.slice(i, i + chunkSize) };
      await new Promise((r) => setTimeout(r, 10));
    }
    yield { type: "done" };
  }

  return {
    stream: generate(),
    async fullText() {
      return fullText;
    },
  };
}

/**
 * Helper: poll DOM for response text until stable.
 */
export async function pollForResponse(
  page: Page,
  opts: {
    /** CSS selectors to find the last assistant message */
    responseSelectors: string[];
    /** Text to exclude from responses */
    excludePatterns?: string[];
    /** Max wait time in ms */
    maxWaitMs?: number;
    /** Poll interval in ms */
    pollIntervalMs?: number;
    /** Minimum stability count before returning */
    stableThreshold?: number;
  },
): Promise<string> {
  const {
    responseSelectors,
    excludePatterns = [],
    maxWaitMs = 120000,
    pollIntervalMs = 2000,
    stableThreshold = 3,
  } = opts;

  let lastText = "";
  let stableCount = 0;

  for (let elapsed = 0; elapsed < maxWaitMs; elapsed += pollIntervalMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const result = await page.evaluate(
      ({ selectors, excludes }: { selectors: string[]; excludes: string[] }) => {
        const clean = (t: string) => t.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

        let text = "";
        for (const sel of selectors) {
          try {
            const els = document.querySelectorAll(sel);
            const last = els.length > 0 ? els[els.length - 1] : null;
            if (last) {
              const t = clean((last as HTMLElement).textContent ?? "");
              if (t.length > 10 && !excludes.some((e) => t.includes(e))) {
                text = t;
                break;
              }
            }
          } catch { /* skip invalid selector */ }
        }

        // Check for stop/streaming button
        const stopBtn = document.querySelector(
          '[aria-label*="Stop"], [aria-label*="stop"], [data-testid*="stop"], button[aria-label*="Cancel"]'
        );
        const isStreaming = !!stopBtn;

        return { text, isStreaming };
      },
      { selectors: responseSelectors, excludes: excludePatterns },
    );

    if (result.text && result.text !== lastText) {
      lastText = result.text;
      stableCount = 0;
    } else if (result.text) {
      stableCount++;
      if (!result.isStreaming && stableCount >= stableThreshold) {
        break;
      }
    }
  }

  if (!lastText) {
    throw new Error("No response detected from page");
  }

  return lastText;
}
