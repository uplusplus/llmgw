# LLM Gateway (llmgw)

**Use LLMs without API tokens** — log in via browser once, then call ChatGPT, Claude, Gemini, DeepSeek, Qwen (intl/cn), Doubao, Kimi, Zhipu GLM, Grok, Xiaomi MiMo, Perplexity and more for free through a unified **OpenAI-compatible** gateway.

Based on [openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token), stripped down to a standalone service.

---

## Supported Providers

| Provider | Status | Type | Models (examples) |
|----------|--------|------|--------------------|
| DeepSeek | ✅ | HTTP | deepseek-chat, deepseek-reasoner |
| Qwen International | ✅ Playwright | Browser | Qwen 3.5 Plus, Qwen 3.5 Turbo |
| Qwen China | ✅ Playwright | Browser | Qwen 3.5 Plus, Qwen 3.5 Turbo |
| Kimi | ✅ HTTP + Playwright | Both | Moonshot v1 8K / 32K / 128K |
| Claude Web | ✅ | HTTP | claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-6 |
| Doubao | ✅ Playwright | Browser | doubao-seed-2.0, doubao-pro |
| ChatGPT Web | ✅ Playwright | Browser | GPT-4, GPT-4 Turbo |
| Gemini Web | ✅ Playwright | Browser | Gemini Pro, Gemini Ultra |
| Grok Web | ✅ Playwright | Browser | Grok 1, Grok 2 |
| GLM Web (Zhipu) | ✅ Playwright | Browser | glm-4-Plus, glm-4-Think |
| GLM Web (International) | ✅ Playwright | Browser | GLM-4 Plus, GLM-4 Think |
| Xiaomi MiMo | ✅ | HTTP | MiMo 2.0, MiMo 2.5 Pro |
| Perplexity | ✅ Playwright | Browser | perplexity-web, perplexity-pro |
| Manus API | ❌ not included | — | Manus 1.6 (API key, free quota) |
| Ollama | ✅ | HTTP | Any local model |
| vLLM | ✅ | HTTP | Any local model |
| OpenAI Compat | ✅ | HTTP | Any OpenAI-compatible API |

### Provider 实现对照

| Provider | 原项目实现 | 本项目 | 备注 |
|----------|-----------|--------|------|
| DeepSeek | HTTP + PoW (WASM) | ✅ HTTP | 保留 PoW + SHA3 WASM |
| Claude | HTTP + cookie | ✅ HTTP | sessionKey + orgId |
| Kimi | Playwright CDP | ✅ HTTP + Playwright | HTTP 版简化，Playwright 版完整 |
| ChatGPT | Playwright CDP | ✅ Playwright | DOM 交互 |
| Gemini | Playwright CDP | ✅ Playwright | DOM 交互 |
| Grok | Playwright CDP | ✅ Playwright | DOM 交互 + API fallback |
| Qwen intl | Playwright CDP | ✅ Playwright | |
| Qwen cn | Playwright CDP | ✅ Playwright | |
| GLM | Playwright CDP | ✅ Playwright | |
| GLM intl | Playwright CDP | ✅ Playwright | |
| Doubao | HTTP + 动态参数 | ✅ Playwright | HTTP 版需要 a_bogus/msToken 等动态参数 |
| Xiaomi MiMo | HTTP | ✅ HTTP | serviceToken + bot_ph |
| Perplexity | Playwright CDP | ✅ Playwright | |
| Manus | API key | ❌ | 需要 API key，非纯免费 |

### Tool Calling 支持

原项目通过 prompt-injected tool definitions 实现工具调用（基于 [arXiv:2407.04997](https://arxiv.org/html/2407.04997v1)）。

| Model | Tool Calling | Chat | Notes |
|-------|-------------|------|-------|
| DeepSeek | ✅ | ✅ | exec: list desktop files |
| Kimi | ✅ | ✅ | All 6 tools verified |
| Claude | ✅ | ✅ | web_search OK |
| ChatGPT | ✅ | ✅ | web_search OK |
| Qwen CN | ✅ | ✅ | web_search OK |
| Qwen Web | ✅ | ✅ | web_search OK |
| Grok | ✅ | ✅ | web_search OK |
| Gemini | ✅ | ⚠️ | web_search OK, DOM polling unstable |
| Xiaomi MiMo | ✅ | ✅ | web_search OK |
| GLM | ✅ | ✅ | Tool calling and chat OK |
| GLM Intl | ✅ | ✅ | Tool calling and chat OK |
| Doubao | ❌ | ⚠️ | Excluded (stream parser limitation) |
| Perplexity | — | ✅ | Search engine, no tool injection |

> **Note:** 本项目当前未实现 tool calling 中间件。如需此功能，可使用原项目。

---

## Quick Start

```bash
npm install

# Playwright providers only
npx playwright install chromium

cp config.example.json config.json
# Edit config.json with your browser cookies

npm start
```

## Getting Cookies

### DeepSeek
1. Open [chat.deepseek.com](https://chat.deepseek.com), log in
2. DevTools → Network → copy `Cookie` header

### Claude
1. Open [claude.ai](https://claude.ai), log in
2. Copy cookies + organization UUID

### Playwright providers (ChatGPT, Gemini, Grok, etc.)
1. Open the website, log in
2. DevTools → Application → Cookies → copy all as string

---

## API Usage

OpenAI-compatible endpoints:

```bash
# Chat completions (streaming)
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Hello!"}],"stream":true}'

# List models
curl http://localhost:3456/v1/models

# Health check
curl http://localhost:3456/health
```

### Python SDK

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3456/v1", api_key="key")
for chunk in client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
):
    print(chunk.choices[0].delta.content or "", end="")
```

---

## Configuration

```jsonc
{
  "port": 3456,
  "apiKey": "your-api-key",
  "providers": {
    "deepseek": { "_type": "deepseek", "cookie": "..." },
    "chatgpt": { "_type": "chatgpt", "cookie": "...", "headless": true }
  },
  "modelMapping": {
    "deepseek-chat": "deepseek",
    "gpt-4": "chatgpt"
  }
}
```

### Playwright Options

```jsonc
{
  "_type": "chatgpt",
  "cookie": "...",
  "headless": true,                    // default: true
  "browserPath": "/usr/bin/chromium",  // optional
  "cdpUrl": "http://127.0.0.1:9222"   // connect to existing Chrome
}
```

### Environment Variables

- `PORT` — server port
- `CONFIG_PATH` — config file path
- `API_KEY` — API key

---

## Adding New Platforms

To add a new web provider:

### 1. Provider class

```ts
// src/providers/myprovider.ts
export class MyProvider implements ProviderAdapter {
  async chat(params: { messages: OpenAiMessage[]; model: string }) {
    // Call platform web API or interact with DOM
  }
}
```

### 2. Register in server.ts

```ts
providerFactories["myprovider"] = (cfg) => new MyProvider(cfg);
```

### 3. Add to config.example.json

---

## Architecture

```
Client (OpenAI SDK)
    ↓
HTTP Server (/v1/chat/completions)
    ↓
Model Router (modelMapping)
    ↓
Provider (HTTP / Playwright)
    ↓
Web API (free, cookie-based auth)
```

### 与原项目的关系

```
openclaw-zero-token          llmgw (本项目)
├── Agent Core (PI-AI)       └── 纯 HTTP 网关
├── Channels (Telegram...)       无 Agent / 无 Channel
├── CLI / TUI                    无 CLI
├── Skills / Plugins             无插件系统
├── Gateway + OpenAI API     ──→ 保留 OpenAI 兼容接口
└── Zero Token Providers     ──→ 保留 Provider 实现
```

---

## Security Notes

1. **Cookie 安全**: cookies 仅存本地 `config.json`，不要提交到 git
2. **Session 过期**: web session 会过期，需重新登录
3. **Rate limiting**: web 端点有频率限制，不适合重度生产使用
4. **合规**: 仅供学习和实验，请遵守各平台服务条款

---

## License

MIT
