# ZeroToken

> **[中文](./README.zh.md)** | English

Core features extracted from [openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token), standalone lightweight service with OpenAI-compatible API.

**Zero Token Cost** — Drives LLM platform Web UIs via browser, no API Key required.

---

## Supported Platforms

| Platform | Status | Auth Method | Protocol | Example Models |
|---|---|---|---|---|
| DeepSeek | ✅ Ready | Cookie + Bearer + PoW | REST SSE | deepseek-chat, deepseek-reasoner |
| Claude Web | ✅ Ready | Cookie + OrgId | REST SSE | claude-sonnet-4-6, claude-opus-4-6 |
| Kimi | ✅ Ready | Bearer (kimi-auth) | Connect-JSON binary frame | moonshot-v1-32k |
| Doubao | ✅ Ready | sessionid + ttwid | REST SSE | doubao-seed-1-8, doubao-seed-code |
| Xiaomi MiMo | ✅ Ready | Cookie + Bearer | REST SSE | xiaomimo-chat, mimo-v2-pro |
| Qwen (Intl) | ✅ Ready | Cookie + Playwright CDP | page.evaluate fetch | qwen3.5-plus, qwen3.5-turbo |
| Qwen (CN) | ✅ Ready | Cookie + XSRF + Playwright | page.evaluate fetch | Qwen3.5-Plus, Qwen3.5-Turbo |
| GLM (ChatGLM) | ✅ Ready | Cookie + X-Sign + Playwright | page.evaluate fetch | glm-4-plus, glm-4-think |
| GLM (Intl) | ✅ Ready | Cookie + Playwright CDP | DOM interaction | glm-4-plus (Intl) |
| Perplexity | ✅ Ready | Cookie + Playwright CDP | DOM interaction | perplexity-web, perplexity-pro |
| ChatGPT Web | ✅ Ready | Cookie + Session + Playwright | API + DOM fallback | gpt-4, gpt-4o, o1 |
| Gemini Web | ✅ Ready | Cookie + Playwright CDP | DOM interaction | gemini-pro, gemini-ultra |
| Grok Web | ✅ Ready | Cookie + Playwright CDP | API + DOM fallback | grok-1, grok-2, grok-3 |
| Ollama | ✅ Ready | Local API | OpenAI-compat | llama3, qwen2.5, mistral |
| OpenRouter | ✅ Ready | API Key | OpenAI-compat | auto, hunter-alpha |
| Manus | ✅ Ready | API Key | OpenAI-compat | manus-1.6, manus-1.6-lite |
| vLLM/Together/... | ✅ Ready | API Key | OpenAI-compat | various models |

---

## Quick Start

### One-Click Install (Recommended)

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/uplusplus/zero-token/main/install.sh | sudo bash
```

**Windows (Admin PowerShell):**

```powershell
irm https://raw.githubusercontent.com/uplusplus/zero-token/main/install.ps1 | iex
```

The script automatically: detect/install Node.js → install dependencies → build → register system service → start.

The service starts automatically after install. Access at `http://localhost:8080`.

> **Custom port:** `SERVER_PORT=8080 curl -fsSL ... | sudo bash`

### Service Management

**Linux (systemd):**

```bash
systemctl start zero-token     # start
systemctl stop zero-token      # stop
systemctl restart zero-token   # restart
journalctl -u zero-token -f    # view logs
```

**Windows (NSSM):**

```powershell
nssm start zero-token          # start
nssm stop zero-token           # stop
nssm restart zero-token        # restart
nssm remove zero-token confirm # uninstall
```

### Configure Web Providers

Web providers require you to log in and capture credentials:

```bash
cd /opt/zero-token
bash scripts/start-chrome.sh   # open Chrome with login pages
node scripts/onboard.mjs       # capture cookies → config.yaml
systemctl restart zero-token   # restart to apply
```

API providers (Ollama / OpenRouter / etc.) skip this — just edit `config.yaml` with your API key.

### Developer Setup

```bash
git clone https://github.com/uplusplus/zero-token.git && cd zero-token
npm install && npm run build && npm start

# or dev mode (hot reload)
npm run dev
```

### Test Endpoints

```bash
# health check
curl http://localhost:8080/health

# list available models
curl http://localhost:8080/v1/models

# chat (streaming)
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-4-plus",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# chat (non-streaming)
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-4-plus",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

---

## Project Structure

```
zero-token/
├── src/
│   ├── server.ts                  # HTTP entry point (Hono)
│   ├── config.ts                  # YAML config loader (Zod validation)
│   ├── types.ts                   # Core types (Provider, Model, ChatMessage, StreamCallbacks)
│   ├── browser/
│   │   ├── cdp.ts                 # CDP connection / WebSocket / Chrome health check
│   │   ├── executables.ts         # Cross-platform Chrome/Chromium auto-detect
│   │   ├── manager.ts             # BrowserManager (launch/attach/close/ensure)
│   │   └── index.ts
│   ├── providers/
│   │   ├── base.ts                # Common utilities (extractText, buildPrompt, readSSEStream)
│   │   ├── deepseek.ts            # DeepSeek Web (PoW + SHA3 WASM)
│   │   ├── claude.ts              # Claude Web (Cookie + OrgId)
│   │   ├── kimi.ts                # Kimi (Connect-JSON binary frame)
│   │   ├── doubao.ts              # Doubao (sessionid + ttwid)
│   │   ├── xiaomimo.ts            # Xiaomi MiMo (Cookie + Bearer REST)
│   │   ├── qwen.ts                # Qwen Intl (Playwright page.evaluate)
│   │   ├── qwen-cn.ts             # Qwen CN (XSRF + Playwright)
│   │   ├── glm.ts                 # GLM (X-Sign + Playwright)
│   │   ├── glm-intl.ts            # GLM Intl (DOM interaction)
│   │   ├── perplexity.ts          # Perplexity (DOM interaction)
│   │   ├── chatgpt.ts             # ChatGPT Web (Sentinel + DOM fallback)
│   │   ├── gemini.ts              # Gemini Web (DOM interaction)
│   │   ├── grok.ts                # Grok Web (API + DOM fallback)
│   │   ├── openai-compat.ts       # OpenAI-compat generic provider
│   │   └── index.ts
│   ├── streams/
│   │   ├── parsers.ts             # SSE / Connect-JSON stream parsers
│   │   └── index.ts
│   ├── tool-calling/
│   │   ├── middleware.ts           # Prompt-injected tool calling middleware
│   │   └── index.ts
│   ├── openai/
│   │   ├── chat-completions.ts    # POST /v1/chat/completions
│   │   ├── models.ts              # GET /v1/models
│   │   ├── health.ts              # GET /health
│   │   └── index.ts
│   └── bridge/
│       └── catalog.ts             # Model catalog & provider factory
├── config.yaml                    # Runtime configuration
├── package.json
├── tsconfig.json
└── README.md
```

---

## Tech Stack

- **Language**: TypeScript
- **HTTP Framework**: Hono (lightweight, native SSE support)
- **Browser Automation**: Playwright-core (CDP connect to existing Chrome instance)
- **Config**: YAML + Zod validation
- **Package Manager**: npm
- **Runtime**: Node.js 22+

---

## API

Fully compatible with OpenAI API — drop-in replacement for `https://api.openai.com`:

### POST /v1/chat/completions

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### GET /v1/models

```bash
curl http://localhost:8080/v1/models
```

### GET /health

```bash
curl http://localhost:8080/health
```

---

## Auth Mechanism

Each platform captures login credentials via CDP (Chrome DevTools Protocol) from the browser.
We don't crack passwords or bypass login — we let the browser stay logged in and intercept the auth tokens it produces.

### Flow

```
BrowserManager starts/connects Chrome → CDP WebSocket URL
                │
                ▼
  Playwright chromium.connectOverCDP(wsUrl)
                │
                ▼
  Intercept auth (Cookie / Bearer / Token)
                │
                ▼
  Return { cookie, bearer, userAgent }
```

### Auth Comparison

| Platform | Method | PoW Required | Interaction |
|---|---|---|---|
| DeepSeek | Cookie + Bearer | ✅ SHA256/DeepSeekHashV1 | REST API |
| Claude | Cookie + OrgId | ❌ | REST API |
| Kimi | Bearer (kimi-auth) | ❌ | Connect-JSON |
| Doubao | sessionid + ttwid | ❌ | REST API |
| MiMo | Cookie + Bearer | ❌ | REST API |
| Qwen | Cookie + CDP | ❌ | page.evaluate fetch |
| GLM | Cookie + X-Sign | ❌ | page.evaluate fetch |
| ChatGPT | Cookie + Session | ❌ | API + DOM fallback |
| Gemini | Cookie | ❌ | DOM interaction |
| Grok | Cookie | ❌ | API + DOM fallback |
| Perplexity | Cookie | ❌ | DOM interaction |

### Security

1. **Credentials not persisted** — held in memory only, destroyed on process exit
2. **Cookie expiration** — platform cookies typically last 7–30 days, re-login required
3. **Bypass risk** — platforms may detect automation and ban; recommendations:
   - Use a real browser profile (attach mode)
   - Don't send high-frequency concurrent requests
   - Keep normal User-Agent and Referer headers

---

## Development Progress

> See [TODO.md](./TODO.md) for details. Overall completion: **~95%**.

### Overview (2026-04-11)

| Stage | Status | Progress |
|---|---|---|
| Foundation (scaffold/Browser/HTTP/config) | ✅ Done | 100% |
| Provider implementations (14) | ✅ Done | 100% |
| P0 Stream parsing enhancement | ✅ Done | 100% |
| P1 Auth automation | ✅ Done | 100% (13/13 modules) |
| P2 Feature enhancement | 🔄 In progress | 50% |
| P3 Testing & deployment | ⏳ Pending | 0% |

---

## Migration from openclaw-zero-token

| openclaw-zero-token | zero-token | Notes |
|---|---|---|
| Separate auth + client-browser per provider | Single ProviderAdapter class | Simplified structure |
| Depends on `launchOpenClawChrome` / `resolveBrowserConfig` | Independent BrowserManager + CDP helpers | No OpenClaw dependency |
| Depends on `loadConfig` (OpenClaw config) | YAML + Zod config | Independent config system |
| Playwright auth + client via BrowserManager bridge | Playwright CDP + page.evaluate | Unified browser access |

---

## License

MIT
