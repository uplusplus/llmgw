import type { ChatResult } from "../../types.js";
import { PlaywrightProvider, createDomChatResult, pollForResponse, type PlaywrightProviderConfig } from "./base.js";

/**
 * Gemini Web Provider - drives gemini.google.com via Playwright
 */
export class GeminiPlaywrightProvider extends PlaywrightProvider {
  constructor(config: PlaywrightProviderConfig) {
    super({
      ...config,
      siteUrl: config.siteUrl || "https://gemini.google.com",
      cookieDomain: config.cookieDomain || ".google.com",
    });
  }

  protected async chatViaDOM(params: { message: string; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const { page } = await this.ensureBrowser();

    if (!page.url().includes("gemini.google.com")) {
      await page.goto("https://gemini.google.com/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
    }

    const inputSelectors = [
      '[contenteditable="true"]',
      'textarea',
      'div[role="textbox"]',
      '.ql-editor',
    ];
    let inputHandle = null;
    for (const sel of inputSelectors) {
      inputHandle = await page.$(sel);
      if (inputHandle) break;
    }
    if (!inputHandle) throw new Error("Gemini: cannot find input element");

    await inputHandle.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(params.message, { delay: 20 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    console.log("[Gemini] Message sent, waiting for response...");

    const text = await pollForResponse(page, {
      responseSelectors: [
        '[class*="response-container"]',
        '[class*="model-response"]',
        '.message-content',
        '.markdown',
        'message-content',
      ],
      excludePatterns: ["Gemini", "New chat"],
      maxWaitMs: 120000,
    });

    return createDomChatResult(text);
  }
}
