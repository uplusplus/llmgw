import type { ChatResult } from "../../types.js";
import { PlaywrightProvider, createDomChatResult, pollForResponse, type PlaywrightProviderConfig } from "./base.js";

/**
 * Kimi Web Provider - drives kimi.moonshot.cn via Playwright
 */
export class KimiPlaywrightProvider extends PlaywrightProvider {
  constructor(config: PlaywrightProviderConfig) {
    super({
      ...config,
      siteUrl: config.siteUrl || "https://kimi.moonshot.cn",
      cookieDomain: config.cookieDomain || ".moonshot.cn",
    });
  }

  protected async chatViaDOM(params: { message: string; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const { page } = await this.ensureBrowser();

    if (!page.url().includes("kimi.moonshot.cn") && !page.url().includes("kimi.ai")) {
      await page.goto("https://kimi.moonshot.cn/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
    }

    const inputSelectors = [
      '#chat-input',
      '[contenteditable="true"]',
      "textarea",
      'div[role="textbox"]',
      ".chat-input-editor",
    ];
    let inputHandle = null;
    for (const sel of inputSelectors) {
      inputHandle = await page.$(sel);
      if (inputHandle) break;
    }
    if (!inputHandle) throw new Error("Kimi: cannot find input element");

    await inputHandle.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(params.message, { delay: 15 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    console.log("[Kimi] Message sent, waiting for response...");

    const text = await pollForResponse(page, {
      responseSelectors: [
        '.message-content',
        '[class*="assistant"]',
        '[class*="response"]',
        ".markdown-body",
        ".prose",
      ],
      excludePatterns: ["Kimi", "新对话"],
      maxWaitMs: 120000,
    });

    return createDomChatResult(text);
  }
}
