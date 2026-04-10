# llmgw

从 [openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token) 提取核心功能，独立为轻量服务，提供 OpenAI 兼容接口。

**零 Token 成本** — 通过浏览器驱动各 LLM 平台 Web UI，无需 API Key。

---

## 支持的平台

| 平台 | 状态 | 认证方式 | 协议 | 模型示例 |
|---|---|---|---|---|
| DeepSeek | ✅ 已实现 | Cookie + Bearer + PoW | REST SSE | deepseek-chat, deepseek-reasoner |
| Claude Web | ✅ 已实现 | Cookie + OrgId | REST SSE | claude-sonnet-4-6, claude-opus-4-6 |
| Kimi | ✅ 已实现 | Bearer (kimi-auth) | Connect-JSON 二进制帧 | moonshot-v1-32k |
| Doubao | ✅ 已实现 | sessionid + ttwid | REST SSE | doubao-seed-1-8, doubao-seed-code |
| Xiaomi MiMo | ✅ 已实现 | Cookie + Bearer | REST SSE | xiaomimo-chat, mimo-v2-pro |
| Qwen (国际) | ✅ 已实现 | Cookie + Playwright CDP | page.evaluate fetch | qwen3.5-plus, qwen3.5-turbo |
| Qwen (国内) | ✅ 已实现 | Cookie + XSRF + Playwright | page.evaluate fetch | Qwen3.5-Plus, Qwen3.5-Turbo |
| GLM (智谱) | ✅ 已实现 | Cookie + X-Sign + Playwright | page.evaluate fetch | glm-4-plus, glm-4-think |
| GLM (国际) | ✅ 已实现 | Cookie + Playwright CDP | DOM 交互 | glm-4-plus (Intl) |
| Perplexity | ✅ 已实现 | Cookie + Playwright CDP | DOM 交互 | perplexity-web, perplexity-pro |
| ChatGPT Web | ✅ 已实现 | Cookie + Session + Playwright | API + DOM fallback | gpt-4, gpt-4o, o1 |
| Gemini Web | ✅ 已实现 | Cookie + Playwright CDP | DOM 交互 | gemini-pro, gemini-ultra |
| Grok Web | ✅ 已实现 | Cookie + Playwright CDP | API + DOM fallback | grok-1, grok-2, grok-3 |
| Ollama | ✅ 已实现 | 本地 API | OpenAI-compat | llama3, qwen2.5, mistral |
| OpenRouter | ✅ 已实现 | API Key | OpenAI-compat | auto, hunter-alpha |
| vLLM/Together/... | ✅ 已实现 | API Key | OpenAI-compat | 各模型 |

---

## 项目结构

```
llmgw/
├── src/
│   ├── server.ts                  # HTTP 服务入口 (Hono)
│   ├── config.ts                  # YAML 配置加载 (Zod 校验)
│   ├── types.ts                   # 核心类型 (Provider, Model, ChatMessage, StreamCallbacks)
│   ├── browser/
│   │   ├── cdp.ts                 # CDP 连接 / WebSocket / Chrome 健康检查
│   │   ├── executables.ts         # 跨平台 Chrome/Chromium 自动检测
│   │   ├── manager.ts             # BrowserManager (launch/attach/close/ensure)
│   │   └── index.ts
│   ├── providers/
│   │   ├── base.ts                # 公共工具 (extractText, buildPrompt, readSSEStream)
│   │   ├── deepseek.ts            # DeepSeek Web (PoW + SHA3 WASM)
│   │   ├── claude.ts              # Claude Web (Cookie + OrgId)
│   │   ├── kimi.ts                # Kimi (Connect-JSON 二进制帧)
│   │   ├── doubao.ts              # Doubao (sessionid + ttwid)
│   │   ├── xiaomimo.ts            # Xiaomi MiMo (Cookie + Bearer REST)
│   │   ├── qwen.ts                # Qwen 国际版 (Playwright page.evaluate)
│   │   ├── qwen-cn.ts             # Qwen 国内版 (XSRF + Playwright)
│   │   ├── glm.ts                 # GLM 智谱 (X-Sign + Playwright)
│   │   ├── glm-intl.ts            # GLM 国际版 (DOM 交互)
│   │   ├── perplexity.ts          # Perplexity (DOM 交互)
│   │   ├── chatgpt.ts             # ChatGPT Web (Sentinel + DOM fallback)
│   │   ├── gemini.ts              # Gemini Web (DOM 交互)
│   │   ├── grok.ts                # Grok Web (API + DOM fallback)
│   │   ├── openai-compat.ts       # OpenAI 兼容通用 provider
│   │   └── index.ts
│   ├── streams/
│   │   ├── parsers.ts             # SSE / Connect-JSON 流解析器
│   │   └── index.ts
│   ├── tool-calling/
│   │   ├── middleware.ts           # Prompt 注入式工具调用中间件
│   │   └── index.ts
│   ├── openai/
│   │   ├── chat-completions.ts    # POST /v1/chat/completions
│   │   ├── models.ts              # GET /v1/models
│   │   ├── health.ts              # GET /health
│   │   └── index.ts
│   └── bridge/
│       └── catalog.ts             # 模型目录 & provider 工厂
├── config.yaml                    # 运行时配置
├── package.json
├── tsconfig.json
└── README.md
```

---

## 技术选型

- **语言**: TypeScript
- **HTTP 框架**: Hono（轻量，原生 SSE 支持）
- **浏览器自动化**: Playwright-core（CDP 连接已有 Chrome 实例）
- **配置**: YAML + Zod 校验
- **包管理**: npm
- **运行时**: Node.js 22+

---

## API 接口

与 OpenAI API 完全兼容，可直接替代 `https://api.openai.com`：

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

## 认证机制分析

各平台通过 CDP（Chrome DevTools Protocol）从浏览器中截获登录凭证，不破解密码，不绕过登录——
而是让浏览器保持登录状态，我们截获它产生的认证信息。

### 通用流程

```
BrowserManager 启动/连接 Chrome → CDP WebSocket URL
                │
                ▼
  Playwright chromium.connectOverCDP(wsUrl)
                │
                ▼
  截获认证信息（Cookie / Bearer / Token）
                │
                ▼
  返回 { cookie, bearer, userAgent }
```

### 认证方式对比

| 平台 | 认证手段 | PoW 需求 | 交互方式 |
|---|---|---|---|
| DeepSeek | Cookie + Bearer | ✅ SHA256/DeepSeekHashV1 | REST API |
| Claude | Cookie + OrgId | ❌ | REST API |
| Kimi | Bearer (kimi-auth) | ❌ | Connect-JSON |
| Doubao | sessionid + ttwid | ❌ | REST API |
| MiMo | Cookie + Bearer | ❌ | REST API |
| Qwen | Cookie + CDP | ❌ | page.evaluate fetch |
| GLM | Cookie + X-Sign | ❌ | page.evaluate fetch |
| ChatGPT | Cookie + Session | ❌ | API + DOM fallback |
| Gemini | Cookie | ❌ | DOM 交互 |
| Grok | Cookie | ❌ | API + DOM fallback |
| Perplexity | Cookie | ❌ | DOM 交互 |

### 安全考虑

1. **凭证不持久化** — 运行时内存持有，进程退出即销毁
2. **Cookie 过期** — 平台 Cookie 有效期通常 7-30 天，需重新登录
3. **Bypass 风险** — 平台可能检测自动化行为并封禁，建议：
   - 使用真实浏览器 profile（attach 模式）
   - 不要高频并发请求
   - 保留正常 User-Agent 和 Referer

---

## 开发进度

### Phase 1 — 项目脚手架 ✅

- [x] 初始化项目：`package.json` + `tsconfig.json`
- [x] 设计配置格式 `config.yaml`（providers 启用列表、browser profile、server port）
- [x] 定义核心类型：`Provider`, `Model`, `ChatMessage`, `ChatCompletionChunk`
- [x] 搭建 HTTP 服务骨架（Hono），监听端口，健康检查端点

### Phase 2 — 浏览器管理层 ✅

- [x] Chrome 启动 / CDP 连接 / Profile 管理（`src/browser/cdp.ts`, `executables.ts`, `manager.ts`）
- [x] 独立实现，无 OpenClaw 内部依赖
- [x] 支持 headless / launch / attach 三种模式

### Phase 3 — Provider 迁移 ✅

- [x] 定义独立的 `ProviderAdapter` 接口（替代 OpenClaw 内部类型）
- [x] DeepSeek — PoW (SHA256 + DeepSeekHashV1 WASM) + SSE 流解析
- [x] Claude — Cookie + OrgId 自动发现 + SSE
- [x] Kimi — Connect-JSON 二进制帧协议
- [x] Doubao — sessionid + ttwid 认证 + SSE
- [x] Xiaomi MiMo — Cookie + Bearer REST API
- [x] Qwen (国际) — Playwright CDP + page.evaluate fetch
- [x] Qwen (国内) — XSRF Token + Playwright page.evaluate
- [x] GLM (智谱) — X-Sign/Nonce/Timestamp 签名 + Playwright
- [x] GLM (国际) — DOM 交互 (textarea input + 轮询)
- [x] Perplexity — DOM 交互 (contenteditable input + 轮询)
- [x] ChatGPT Web — Sentinel token + DOM fallback
- [x] Gemini Web — DOM 交互 (多选择器策略)
- [x] Grok Web — REST API + DOM fallback
- [x] OpenAI-compat — 通用 provider (Ollama/vLLM/OpenRouter/Together 等 12 平台)

### Phase 4 — Stream 解析器 ✅

- [x] 统一 `StreamCallbacks` 输出格式（onText / onReasoning / onToolCall / onDone / onError）
- [x] SSE 流解析器（DeepSeek / Claude / Doubao / OpenAI-compat）
- [x] Connect-JSON 流解析器（Kimi）
- [x] reasoning_content 字段支持
- [x] 统一输出转为 OpenAI SSE chunk 格式

### Phase 5 — OpenAI 兼容接口 ✅

- [x] `POST /v1/chat/completions`（SSE streaming + non-streaming）
- [x] `GET /v1/models`（返回所有已配置 provider 的可用模型）
- [x] `GET /health`（健康检查 + provider/model 列表）
- [x] 消息格式转换层：OpenAI `messages[]` → 各平台内部格式
- [x] 错误处理：OpenAI error schema

### Phase 6 — 工具调用 ✅

- [x] Prompt 注入式工具调用中间件
- [x] 支持中文/英文模板、严格模式
- [x] 工具调用提取（fenced JSON / bare JSON / XML）
- [x] 关键词检测避免无谓注入

### Phase 7 — 收尾与测试 🚧

- [x] config.yaml 包含所有 13 个 web provider 配置模板
- [ ] 安装依赖并编译测试
- [ ] 端到端测试：至少验证 3 个 provider（DeepSeek, Claude, Qwen）
- [ ] Dockerfile + docker-compose
- [ ] 并发 & 会话隔离测试

---

## 从 openclaw-zero-token 迁移说明

### 架构变更

| openclaw-zero-token | llmgw | 说明 |
|---|---|---|
| 每个 provider 分 auth + client-browser 两个文件 | 合并为单个 ProviderAdapter 类 | 简化文件结构 |
| 依赖 `launchOpenClawChrome` / `resolveBrowserConfig` | 使用独立 BrowserManager + CDP helpers | 移除 OpenClaw 依赖 |
| 依赖 `loadConfig` (OpenClaw config) | 使用 YAML + Zod 配置 | 独立配置系统 |
| Playwright auth + client 通过 BrowserManager 桥接 | Playwright CDP 连接 + page.evaluate | 统一浏览器访问模式 |

### 已验证一致的关键细节

- ✅ DeepSeek SHA3 WASM base64 (35,484 字符) 完整移植
- ✅ DeepSeek PoW 算法 (SHA256 + DeepSeekHashV1) 完全一致
- ✅ Kimi Connect-JSON 二进制帧协议 (0x00 + 4-byte BE length + JSON)
- ✅ GLM X-Sign/Nonce/Timestamp 签名算法一致
- ✅ 各平台 API 端点 URL 完全对应
- ✅ tool-calling middleware 覆盖所有 CN/EN/Strict 模型分类

---

## License

MIT
