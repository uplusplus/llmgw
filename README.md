# Zero Token Gateway

OpenAI-compatible API gateway that routes requests to **free web-based LLM providers** using browser cookies — no API tokens required.

Based on [openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token), stripped down to a standalone service.

## Supported Providers

| Provider | Auth Method | Models |
|----------|------------|--------|
| **DeepSeek** | Browser cookie | deepseek-chat, deepseek-reasoner, search variants |
| **Claude** | Browser cookie + org ID | claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-6 |
| **Kimi** | Browser cookie | moonshot-v1-8k/32k/128k |
| **Ollama** | None (local) | Any local model |
| **Any OpenAI-compat** | API key | Any compatible API |

## Quick Start

```bash
# 1. Install dependencies
cd zero-token-gateway
npm install

# 2. Create config from example
cp config.example.json config.json

# 3. Edit config.json with your browser cookies

# 4. Start the server
npm start
```

## Getting Cookies

### DeepSeek
1. Open [chat.deepseek.com](https://chat.deepseek.com) in your browser
2. Log in
3. Open DevTools → Network tab
4. Copy the `Cookie` header from any request to `chat.deepseek.com`

### Claude
1. Open [claude.ai](https://claude.ai) in your browser
2. Log in
3. Copy cookies from DevTools
4. Also note your organization UUID from the URL or API responses

### Kimi
1. Open [kimi.moonshot.cn](https://kimi.moonshot.cn) in your browser
2. Log in and copy cookies

## API Usage

### Chat Completions (Streaming)

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Authorization: Bearer your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### Chat Completions (Non-streaming)

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-reasoner",
    "messages": [{"role": "user", "content": "Explain quantum computing"}],
    "stream": false
  }'
```

### List Models

```bash
curl http://localhost:3456/v1/models
```

### Health Check

```bash
curl http://localhost:3456/health
```

## Configuration

Edit `config.json`:

```jsonc
{
  "port": 3456,              // Server port (also via PORT env var)
  "apiKey": "secret",        // Optional API key (also via API_KEY env var)
  "providers": {             // Provider credentials
    "deepseek": {
      "_type": "deepseek",
      "cookie": "..."
    }
  },
  "modelMapping": {          // Model name → provider key
    "deepseek-chat": "deepseek",
    "deepseek*": "deepseek"  // Wildcard matching
  }
}
```

### Environment Variables

- `PORT` — Override server port
- `CONFIG_PATH` — Override config file path (default: `config.json`)
- `API_KEY` — Override API key

## Architecture

```
Client (OpenAI SDK) → HTTP Server → Model Router → Provider → Web API (free)
```

The gateway:
1. Receives OpenAI-format `/v1/chat/completions` requests
2. Maps the `model` name to a provider using `modelMapping`
3. Sends the request through the provider's web API (using cookies for auth)
4. Streams back the response in OpenAI SSE format

## Using with OpenAI SDKs

Works with any OpenAI-compatible client:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3456/v1",
    api_key="your-api-key-here"
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)
for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")
```

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3456/v1",
  apiKey: "your-api-key-here",
});

const stream = await client.chat.completions.create({
  model: "deepseek-chat",
  messages: [{ role: "user", content: "Hello!" }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

## License

MIT
