import type { ChatResult } from "../../types.js";
import { PlaywrightProvider, createDomChatResult, pollForResponse, type PlaywrightProviderConfig } from "./base.js";

/**
 * Doubao (ByteDance) Web Provider - drives doubao.com via Playwright
 */
export class DoubaoPlaywrightProvider extends PlaywrightProvider {
  constructor(config: PlaywrightProviderConfig) {
    super({
      ...config,
      siteUrl: config.siteUrl || "https://www.doubao.com",
      cookieDomain: config.cookieDomain || ".doubao.com",
    });
  }

  protected async chatViaDOM(params: { message: string; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const { page } = await this.ensureBrowser();

    if (!page.url().includes("doubao.com")) {
      await page.goto("https://www.doubao.com/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
    }

    const inputSelectors = [
      '#chat-input',
      '[contenteditable="true"]',
      "textarea",
      'div[role="textbox"]',
      'textarea[data-testid]',
    ];
    let inputHandle = null;
    for (const sel of inputSelectors) {
      inputHandle = await page.$(sel);
      if (inputHandle) break;
    }
    if (!inputHandle) throw new Error("Doubao: cannot find input element");

    await inputHandle.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(params.message, { delay: 15 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    console.log("[Doubao] Message sent, waiting for response...");

    const text = await pollForResponse(page, {
      responseSelectors: [
        '[class*="assistant"]',
        '[class*="response"]',
        '[class*="bot-message"]',
        ".markdown-body",
        ".message-content",
      ],
      maxWaitMs: 120000,
    });

    return createDomChatResult(text);
  }
}

/**
 * Perplexity Web Provider - drives perplexity.ai via Playwright
 */
export class PerplexityPlaywrightProvider extends PlaywrightProvider {
  constructor(config: PlaywrightProviderConfig) {
    super({
      ...config,
      siteUrl: config.siteUrl || "https://www.perplexity.ai",
      cookieDomain: config.cookieDomain || ".perplexity.ai",
    });
  }

  protected async chatViaDOM(params: { message: string; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const { page } = await this.ensureBrowser();

    if (!page.url().includes("perplexity.ai")) {
      await page.goto("https://www.perplexity.ai/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
    }

    const inputSelectors = [
      '#ask-input',
      '[contenteditable="true"]',
      "textarea",
      'div[role="textbox"]',
    ];
    let inputHandle = null;
    for (const sel of inputSelectors) {
      inputHandle = await page.$(sel);
      if (inputHandle) break;
    }
    if (!inputHandle) throw new Error("Perplexity: cannot find input element");

    await inputHandle.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(params.message, { delay: 15 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    console.log("[Perplexity] Message sent, waiting for response...");

    const text = await pollForResponse(page, {
      responseSelectors: [
        '[class*="prose"]',
        '[class*="answer"]',
        ".markdown",
        '[class*="response"]',
      ],
      excludePatterns: ["Perplexity", "Focus", "Pro"],
      maxWaitMs: 120000,
    });

    return createDomChatResult(text);
  }
}
