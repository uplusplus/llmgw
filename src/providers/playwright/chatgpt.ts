import type { ChatResult } from "../../types.js";
import { PlaywrightProvider, createDomChatResult, pollForResponse, type PlaywrightProviderConfig } from "./base.js";

export interface ChatGPTConfig extends PlaywrightProviderConfig {
  accessToken?: string;
}

/**
 * ChatGPT Web Provider - drives chatgpt.com via Playwright
 */
export class ChatGPTPlaywrightProvider extends PlaywrightProvider {
  private accessToken: string;

  constructor(config: ChatGPTConfig) {
    super({
      ...config,
      siteUrl: config.siteUrl || "https://chatgpt.com",
      cookieDomain: config.cookieDomain || ".chatgpt.com",
    });
    this.accessToken = config.accessToken || "";
  }

  protected async chatViaDOM(params: { message: string; model: string; signal?: AbortSignal }): Promise<ChatResult> {
    const { page } = await this.ensureBrowser();

    // Navigate if needed
    if (!page.url().includes("chatgpt.com")) {
      await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
    }

    // Find input
    const inputSelectors = [
      '#prompt-textarea',
      '[contenteditable="true"]',
      'textarea[data-id]',
      'textarea[placeholder]',
      'div[role="textbox"]',
    ];
    let inputHandle = null;
    for (const sel of inputSelectors) {
      inputHandle = await page.$(sel);
      if (inputHandle) break;
    }
    if (!inputHandle) throw new Error("ChatGPT: cannot find input element");

    // Type message
    await inputHandle.click();
    await page.waitForTimeout(300);

    // Use clipboard paste for reliability
    await page.evaluate((text: string) => {
      const el = document.querySelector('[contenteditable="true"]') as HTMLElement;
      if (el) {
        el.focus();
        document.execCommand("insertText", false, text);
      }
    }, params.message);
    await page.waitForTimeout(500);

    // Press Enter to send
    await page.keyboard.press("Enter");
    console.log("[ChatGPT] Message sent, waiting for response...");

    // Poll for response
    const text = await pollForResponse(page, {
      responseSelectors: [
        '[data-message-author-role="assistant"]',
        '.markdown',
        '[class*="response"]',
        'article',
        '.prose',
      ],
      excludePatterns: ["ChatGPT", "New chat"],
      maxWaitMs: 120000,
      pollIntervalMs: 2000,
    });

    return createDomChatResult(text);
  }
}
