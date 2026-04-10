import type { ChatResult } from "../../types.js";
import { PlaywrightProvider, createDomChatResult, pollForResponse, type PlaywrightProviderConfig } from "./base.js";

/**
 * Qwen Web Provider (International) - drives chat.qwen.ai via Playwright
 */
export class QwenPlaywrightProvider extends PlaywrightProvider {
  constructor(config: PlaywrightProviderConfig) {
    super({
      ...config,
      siteUrl: config.siteUrl || "https://chat.qwen.ai",
      cookieDomain: config.cookieDomain || ".qwen.ai",
    });
  }

  protected async chatViaDOM(params: { message: string; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const { page } = await this.ensureBrowser();

    if (!page.url().includes("qwen.ai")) {
      await page.goto("https://chat.qwen.ai/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
    }

    const inputSelectors = [
      '#chat-input',
      '[contenteditable="true"]',
      "textarea",
      'div[role="textbox"]',
    ];
    let inputHandle = null;
    for (const sel of inputSelectors) {
      inputHandle = await page.$(sel);
      if (inputHandle) break;
    }
    if (!inputHandle) throw new Error("Qwen: cannot find input element");

    await inputHandle.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(params.message, { delay: 15 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    console.log("[Qwen] Message sent, waiting for response...");

    const text = await pollForResponse(page, {
      responseSelectors: [
        '[class*="assistant"]',
        '[class*="response"]',
        ".markdown-body",
        ".message-content",
        "article",
      ],
      maxWaitMs: 120000,
    });

    return createDomChatResult(text);
  }
}

/**
 * Qwen CN Web Provider - drives chat2.qianwen.com via Playwright
 */
export class QwenCNPlaywrightProvider extends PlaywrightProvider {
  constructor(config: PlaywrightProviderConfig) {
    super({
      ...config,
      siteUrl: config.siteUrl || "https://chat2.qianwen.com",
      cookieDomain: config.cookieDomain || ".qianwen.com",
    });
  }

  protected async chatViaDOM(params: { message: string; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const { page } = await this.ensureBrowser();

    if (!page.url().includes("qianwen.com")) {
      await page.goto("https://chat2.qianwen.com/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
    }

    const inputSelectors = [
      '#chat-input',
      '[contenteditable="true"]',
      "textarea",
      'div[role="textbox"]',
    ];
    let inputHandle = null;
    for (const sel of inputSelectors) {
      inputHandle = await page.$(sel);
      if (inputHandle) break;
    }
    if (!inputHandle) throw new Error("Qwen CN: cannot find input element");

    await inputHandle.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(params.message, { delay: 15 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    console.log("[Qwen CN] Message sent, waiting for response...");

    const text = await pollForResponse(page, {
      responseSelectors: [
        '[class*="assistant"]',
        '[class*="response"]',
        ".markdown-body",
        ".message-content",
      ],
      maxWaitMs: 120000,
    });

    return createDomChatResult(text);
  }
}
