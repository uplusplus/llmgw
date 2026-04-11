# llmgw TODO List

从 openclaw-zero-token 提取核心功能，补全 llmgw 缺失部分。

## P0 — 核心健壮性

- [ ] **DeepSeek 流解析增强** — 移植原版 743 行流解析逻辑：
  - `<think>` 标签缓冲区（think/thought/thinking 多标签支持）
  - JUNK_TOKENS 过滤（`<｜end▁of▁thinking｜>` 等）
  - reasoning_content 字段正确分流
  - parent_message_id 追踪保持会话连续性
  - 参考: `openclaw-zero-token/src/zero-token/streams/deepseek-web-stream.ts`

- [ ] **Claude 流解析增强** — 移植原版 507 行流解析：
  - content_block_delta 类型处理
  - thinking 内容分离
  - 参考: `openclaw-zero-token/src/zero-token/streams/claude-web-stream.ts`

- [ ] **Kimi Connect-JSON 帧解析增强** — 移植原版 415 行：
  - 完整的二进制帧协议解析（0x00 + 4-byte BE length + JSON）
  - op 字段处理（append/set）
  - thinking 块支持
  - 参考: `openclaw-zero-token/src/zero-token/streams/kimi-web-stream.ts`

## P1 — Auth 自动化

- [ ] **Chrome 启动脚本** — 参考 `start-chrome-debug.sh`，创建 `scripts/start-chrome.sh`
  - 自动检测 Chrome/Chromium 路径
  - 带 `--remote-debugging-port` 启动
  - 跨平台支持（macOS/Linux/WSL）

- [ ] **Onboard Auth Wizard** — 参考 `onboard.sh webauth`，创建 `scripts/onboard.sh`
  - 通过 CDP 连接 Chrome
  - 自动截获各平台 Cookie/Bearer Token
  - 写入 config.yaml auth 字段
  - 参考: `openclaw-zero-token/src/zero-token/providers/*-web-auth.ts`

- [ ] **各平台 Auth 模块移植** — 每个 provider 的认证截获逻辑：
  - [ ] deepseek-web-auth.ts（18KB — PoW challenge + session）
  - [ ] claude-web-auth.ts（6KB — OrgId 自动发现）
  - [ ] kimi-web-auth.ts（4KB — kimi-auth token 提取）
  - [ ] doubao-web-auth.ts（6KB — sessionid + ttwid）
  - [ ] xiaomimo-web-auth.ts（9KB — Cookie + Bearer）
  - [ ] qwen-web-auth.ts（6KB — CDP + session token）
  - [ ] qwen-cn-web-auth.ts（7KB — XSRF + deviceId）
  - [ ] glm-web-auth.ts（3KB — Cookie）
  - [ ] glm-intl-web-auth.ts（5KB — Cookie）
  - [ ] perplexity-web-auth.ts（4KB — Cookie）
  - [ ] chatgpt-web-auth.ts（6KB — session + sentinel）
  - [ ] gemini-web-auth.ts（3KB — Cookie）
  - [ ] grok-web-auth.ts（3KB — Cookie）

## P2 — 功能增强

- [ ] **Tool calling 中间件完善** — 移植原版更丰富的实现：
  - CN/EN/Strict 三种模板（当前只有简化版）
  - 6 种工具定义（web_search, web_fetch, exec, read, write, message）
  - 模型分类（CN_MODELS, STRICT_MODELS, EXCLUDED_MODELS）
  - 参考: `openclaw-zero-token/src/zero-token/tool-calling/` 4 个文件

- [ ] **Doubao 流解析增强** — 移植原版 19KB 流解析器
  - 参考: `openclaw-zero-token/src/zero-token/streams/doubao-web-stream.ts`

- [ ] **ChatGPT 流解析增强** — 移植原版 15KB 流解析器
  - Sentinel token 处理
  - 参考: `openclaw-zero-token/src/zero-token/streams/chatgpt-web-stream.ts`

- [ ] **Gemini 流解析增强** — 移植原版 13KB 流解析器
  - 参考: `openclaw-zero-token/src/zero-token/streams/gemini-web-stream.ts`

- [ ] **Grok 流解析增强** — 移植原版 15KB 流解析器
  - 参考: `openclaw-zero-token/src/zero-token/streams/grok-web-stream.ts`

- [ ] **GLM 流解析增强** — 移植原版 19KB (intl: 16KB)
  - 参考: `openclaw-zero-token/src/zero-token/streams/glm-web-stream.ts`

- [ ] **Qwen 流解析增强** — 移植原版 14KB (cn: 16KB)
  - 参考: `openclaw-zero-token/src/zero-token/streams/qwen-web-stream.ts`

- [ ] **Perplexity 流解析增强** — 移植原版 7KB
  - 参考: `openclaw-zero-token/src/zero-token/streams/perplexity-web-stream.ts`

- [ ] **Xiaomi MiMo 流解析增强** — 移植原版 16KB
  - 参考: `openclaw-zero-token/src/zero-token/streams/xiaomimo-web-stream.ts`

## P3 — 测试与部署

- [ ] **端到端测试** — 至少验证 3 个 provider（DeepSeek, Claude, Qwen）
- [ ] **并发 & 会话隔离测试**
- [ ] **Docker 构建验证**
- [ ] **CI 配置** — GitHub Actions

## 已完成 ✅

- [x] 项目结构搭建（package.json, tsconfig, tsdown）
- [x] 核心类型定义（types.ts）
- [x] HTTP 服务骨架（server.ts + Hono）
- [x] 配置系统（config.ts + config.yaml + Zod）
- [x] Browser 管理（cdp.ts, executables.ts, manager.ts）
- [x] 14 个 Provider 基础实现
- [x] 流解析器基础版（SSE + Connect-JSON）
- [x] Tool calling 中间件基础版
- [x] OpenAI 兼容端点（/v1/chat/completions, /v1/models, /health）
- [x] OpenAI-compat 通用 Provider（Ollama/vLLM 等）
- [x] Docker + docker-compose 部署配置
- [x] TypeScript 编译通过 + 构建成功
