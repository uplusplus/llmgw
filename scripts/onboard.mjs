#!/usr/bin/env node
// llmgw — Auth credential capture wizard (Node.js)
// Connects to Chrome via CDP, extracts cookies/bearer tokens from logged-in sessions
// Cross-platform: Windows / macOS / Linux

import { createConnection } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CDP_PORT = process.env.CDP_PORT || 9222;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

// ─── Provider definitions ──────────────────────────────────────
const PROVIDERS = [
  { id: 'deepseek-web',  name: 'DeepSeek',       domain: 'chat.deepseek.com' },
  { id: 'claude-web',    name: 'Claude',          domain: 'claude.ai' },
  { id: 'kimi-web',      name: 'Kimi',            domain: 'kimi.com' },
  { id: 'doubao-web',    name: 'Doubao (豆包)',    domain: 'doubao.com' },
  { id: 'xiaomimo-web',  name: 'Xiaomi MiMo',     domain: 'xiaomimo.ai' },
  { id: 'qwen-web',      name: 'Qwen (国际)',      domain: 'chat.qwen.ai' },
  { id: 'qwen-cn-web',   name: 'Qwen (国内)',      domain: 'chat.qwen.ai' },
  { id: 'glm-web',       name: 'GLM (智谱)',       domain: 'chatglm.cn' },
  { id: 'glm-intl-web',  name: 'GLM (国际)',       domain: 'chat.z.ai' },
  { id: 'perplexity-web', name: 'Perplexity',      domain: 'perplexity.ai' },
  { id: 'chatgpt-web',   name: 'ChatGPT',         domain: 'chatgpt.com' },
  { id: 'gemini-web',    name: 'Gemini',           domain: 'gemini.google.com' },
  { id: 'grok-web',      name: 'Grok',             domain: 'grok.com' },
];

// ─── HTTP helpers ──────────────────────────────────────────────
async function httpGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function checkChrome() {
  try {
    const ver = await httpGet(`${CDP_URL}/json/version`);
    return ver;
  } catch {
    return null;
  }
}

async function getTargets() {
  return httpGet(`${CDP_URL}/json`);
}

// ─── CDP helpers ───────────────────────────────────────────────
function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    let id = 0;
    const pending = new Map();

    ws.on('open', () => {
      const send = (method, params = {}) => {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { res, rej });
          ws.send(JSON.stringify({ id: msgId, method, params }));
        });
      };
      resolve({ ws, send });
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });

    ws.on('error', reject);
    setTimeout(() => reject(new Error('CDP WebSocket timeout')), 5000);
  });
}

// ─── Cookie extraction ─────────────────────────────────────────
async function getCookies(domain) {
  const targets = await getTargets();
  const tab = targets.find(t => t.type === 'page' && t.url?.includes(domain))
    || targets.find(t => t.type === 'page');

  if (!tab?.webSocketDebuggerUrl) return null;

  const { ws, send } = await cdpConnect(tab.webSocketDebuggerUrl);
  try {
    await send('Network.enable');
    const result = await send('Network.getAllCookies');
    const cookies = result.cookies || [];
    const matching = cookies.filter(c => c.domain?.includes(domain));
    const cookieStr = matching
      .filter(c => c.name && c.value)
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
    return cookieStr || null;
  } finally {
    ws.close();
  }
}

// ─── Bearer token extraction ───────────────────────────────────
async function extractBearer(domain) {
  const targets = await getTargets();
  const tab = targets.find(t => t.type === 'page' && t.url?.includes(domain))
    || targets.find(t => t.type === 'page');

  if (!tab?.webSocketDebuggerUrl) return null;

  const { ws, send } = await cdpConnect(tab.webSocketDebuggerUrl);
  try {
    const result = await send('Runtime.evaluate', {
      expression: `
        (function() {
          // localStorage
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const val = localStorage.getItem(key);
            if (val && (val.includes('Bearer') || val.includes('bearer') || key.includes('token') || key.includes('auth'))) {
              try {
                const p = JSON.parse(val);
                if (p.accessToken) return p.accessToken;
                if (p.token) return p.token;
                if (p.bearer) return p.bearer;
              } catch(e) {}
            }
          }
          // sessionStorage
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            const val = sessionStorage.getItem(key);
            if (val && (key.includes('token') || key.includes('auth'))) {
              try {
                const p = JSON.parse(val);
                if (p.accessToken) return p.accessToken;
                if (p.token) return p.token;
              } catch(e) {}
            }
          }
          return '';
        })()
      `,
      returnByValue: true,
    });
    return result?.result?.value || null;
  } finally {
    ws.close();
  }
}

// ─── Interactive selection (stdin) ─────────────────────────────
function askSelection() {
  return new Promise((resolve) => {
    const rl = process.stdin;
    process.stdout.write('\nProviders:\n');
    PROVIDERS.forEach((p, i) => {
      process.stdout.write(`  [${String(i + 1).padStart(2)}] ${p.name} (${p.id})\n`);
    });
    process.stdout.write(`  [ 0] ALL\n`);
    process.stdout.write(`\nSelect (comma-separated numbers, or 0 for all): `);

    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes('\n')) {
        rl.removeListener('data', onData);
        const input = buf.trim();
        if (input === '0' || input === '') {
          resolve(PROVIDERS.map(p => p.id));
        } else {
          const indices = input.split(/[,\s]+/).map(Number).filter(n => n >= 1 && n <= PROVIDERS.length);
          resolve(indices.map(i => PROVIDERS[i - 1].id));
        }
      }
    };
    rl.setRawMode?.(false);
    rl.resume();
    rl.on('data', onData);
  });
}

// ─── Config YAML generation ────────────────────────────────────
function buildYamlSnippet(id, cookie, bearer) {
  const lines = [];
  lines.push(`  # ${PROVIDERS.find(p => p.id === id)?.name || id}`);
  lines.push(`  - id: ${id}`);
  lines.push(`    enabled: true`);
  lines.push(`    auth:`);
  lines.push(`      cookie: "${cookie.replace(/"/g, '\\"')}"`);
  if (bearer) {
    lines.push(`      bearer: "${bearer.replace(/"/g, '\\"')}"`);
  }
  return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('==========================================');
  console.log('  llmgw — Auth Credential Capture');
  console.log('==========================================\n');

  // Check Chrome
  console.log(`Checking Chrome at ${CDP_URL}...`);
  const ver = await checkChrome();
  if (!ver) {
    console.error(`✗ Chrome not reachable at ${CDP_URL}`);
    console.error('  Start Chrome debug mode first (start.bat option [2]).');
    process.exit(1);
  }
  console.log(`✓ Chrome ${ver['Browser'] || 'connected'}\n`);

  // Select providers
  const selected = await askSelection();
  if (!selected.length) {
    console.log('Nothing selected. Bye.');
    process.exit(0);
  }

  console.log(`\nCapturing auth for ${selected.length} provider(s)...\n`);

  const results = [];

  for (const id of selected) {
    const provider = PROVIDERS.find(p => p.id === id);
    if (!provider) continue;

    process.stdout.write(`── ${provider.name} (${provider.id}) ... `);

    try {
      const cookie = await getCookies(provider.domain);
      const bearer = await extractBearer(provider.domain).catch(() => null);

      if (cookie) {
        console.log('✓ captured');
        results.push({ id: provider.id, cookie, bearer, name: provider.name });
      } else {
        console.log('✗ no tab found');
      }
    } catch (err) {
      console.log(`✗ ${err.message}`);
    }
  }

  // Output config
  if (results.length === 0) {
    console.log('\nNo credentials captured. Make sure you are logged in to the platforms.');
    process.exit(1);
  }

  console.log('\n==========================================');
  console.log('  Add these to config.yaml:');
  console.log('==========================================\n');

  const yamlBlock = results.map(r => buildYamlSnippet(r.id, r.cookie, r.bearer)).join('\n\n');
  console.log(yamlBlock);
  console.log('\n==========================================');

  // Try to append to config.yaml
  const configPath = resolve(__dirname, '..', 'config.yaml');
  try {
    const existing = await readFile(configPath, 'utf-8');
    // Check if providers section exists
    if (existing.includes('providers:')) {
      console.log(`\n[TIP] Paste the above under 'providers:' in ${configPath}`);
    }
  } catch {
    console.log(`\n[TIP] Create config.yaml with the above providers section.`);
  }
}

main().catch(err => {
  console.error(`\n[ERROR] ${err.message}`);
  process.exit(1);
});
