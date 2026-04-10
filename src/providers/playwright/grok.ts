import type { ChatResult } from "../../types.js";
import { PlaywrightProvider, createDomChatResult, pollForResponse, type PlaywrightProviderConfig } from "./base.js";

/**
 * Grok Web Provider - drives grok.com via Playwright
 */
export class GrokPlaywrightProvider extends PlaywrightProvider {
  constructor(config: PlaywrightProviderConfig) {
    super({
      ...config,
      siteUrl: config.siteUrl || "https://grok.com",
      cookieDomain: config.cookieDomain || ".grok.com",
    });
  }

  protected async chatViaDOM(params: { message: string; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const { page } = await this.ensureBrowser();

    if (!page.url().includes("grok.com")) {
      await page.goto("https://grok.com/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
    }

    const inputSelectors = [
      '[contenteditable="true"]',
      "textarea",
      'div[role="textbox"]',
    ];
    let inputHandle = null;
    for (const sel of inputSelectors) {
      inputHandle = await page.$(sel);
      if (inputHandle) break;
    }
    if (!inputHandle) throw new Error("Grok: cannot find input element");

    await inputHandle.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(params.message, { delay: 20 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    console.log("[Grok] Message sent, waiting for response...");

    const text = await pollForResponse(page, {
      responseSelectors: [
        '[data-role="assistant"]',
        '[class*="assistant"]',
        '[class*="response"]',
        '[class*="message"]',
        "article",
        ".prose",
      ],
      excludePatterns: ["Ask Grok"],
      maxWaitMs: 120000,
    });

    return createDomChatResult(text);
  }
}
