import type { ChatResult } from "../../types.js";
import { PlaywrightProvider, createDomChatResult, pollForResponse, type PlaywrightProviderConfig } from "./base.js";

/**
 * GLM Web Provider (Zhipu) - drives chatglm.cn via Playwright
 */
export class GlmPlaywrightProvider extends PlaywrightProvider {
  constructor(config: PlaywrightProviderConfig) {
    super({
      ...config,
      siteUrl: config.siteUrl || "https://chatglm.cn",
      cookieDomain: config.cookieDomain || ".chatglm.cn",
    });
  }

  protected async chatViaDOM(params: { message: string; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const { page } = await this.ensureBrowser();

    if (!page.url().includes("chatglm.cn")) {
      await page.goto("https://chatglm.cn/", { waitUntil: "domcontentloaded" });
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
    if (!inputHandle) throw new Error("GLM: cannot find input element");

    await inputHandle.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(params.message, { delay: 15 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    console.log("[GLM] Message sent, waiting for response...");

    const text = await pollForResponse(page, {
      responseSelectors: [
        '[class*="assistant"]',
        '[class*="response"]',
        ".markdown-body",
        ".message-content",
        ".chat-content",
      ],
      maxWaitMs: 120000,
    });

    return createDomChatResult(text);
  }
}

/**
 * GLM International Web Provider - drives chat.z.ai via Playwright
 */
export class GlmIntlPlaywrightProvider extends PlaywrightProvider {
  constructor(config: PlaywrightProviderConfig) {
    super({
      ...config,
      siteUrl: config.siteUrl || "https://chat.z.ai",
      cookieDomain: config.cookieDomain || ".z.ai",
    });
  }

  protected async chatViaDOM(params: { message: string; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const { page } = await this.ensureBrowser();

    if (!page.url().includes("chat.z.ai")) {
      await page.goto("https://chat.z.ai/", { waitUntil: "domcontentloaded" });
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
    if (!inputHandle) throw new Error("GLM Intl: cannot find input element");

    await inputHandle.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(params.message, { delay: 15 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    console.log("[GLM Intl] Message sent, waiting for response...");

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
