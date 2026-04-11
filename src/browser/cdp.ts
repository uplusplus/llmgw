/**
 * CDP (Chrome DevTools Protocol) connection helpers.
 * Standalone — no OpenClaw dependencies.
 */

import WebSocket from "ws";

// ── Timeouts ──

export const CDP_HTTP_TIMEOUT_MS = 3000;
export const CDP_WS_HANDSHAKE_TIMEOUT_MS = 5000;
export const CHROME_REACHABILITY_TIMEOUT_MS = 500;
export const CHROME_LAUNCH_READY_WINDOW_MS = 15_000;
export const CHROME_LAUNCH_READY_POLL_MS = 200;
export const CHROME_STOP_TIMEOUT_MS = 3000;

// ── URL helpers ──

export function isWebSocketUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "ws:" || parsed.protocol === "wss:";
  } catch {
    return false;
  }
}

export function cdpUrlForPort(port: number): string {
  return `http://localhost:${port}`;
}

export function appendCdpPath(cdpUrl: string, subPath: string): string {
  const url = new URL(cdpUrl);
  const base = url.pathname.replace(/\/$/, "");
  const suffix = subPath.startsWith("/") ? subPath : `/${subPath}`;
  url.pathname = `${base}${suffix}`;
  return url.toString();
}

// ── HTTP fetch (with timeout) ──

export async function fetchCdp(
  url: string,
  timeoutMs = CDP_HTTP_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`CDP HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── WebSocket helpers ──

export function openCdpWebSocket(
  wsUrl: string,
  opts?: { handshakeTimeoutMs?: number },
): WebSocket {
  const timeoutMs = opts?.handshakeTimeoutMs ?? CDP_WS_HANDSHAKE_TIMEOUT_MS;
  return new WebSocket(wsUrl, { handshakeTimeout: timeoutMs });
}

export type CdpSendFn = (
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string,
) => Promise<unknown>;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export function createCdpSender(ws: WebSocket): { send: CdpSendFn; close: () => void } {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const close = () => {
    for (const [, p] of pending) p.reject(new Error("CDP socket closed"));
    pending.clear();
    try { ws.close(); } catch { /* ignore */ }
  };

  ws.on("error", (err) => close());
  ws.on("close", () => close());

  ws.on("message", (data) => {
    try {
      const parsed = JSON.parse(String(data)) as { id?: number; result?: unknown; error?: { message?: string } };
      if (typeof parsed.id !== "number") return;
      const p = pending.get(parsed.id);
      if (!p) return;
      pending.delete(parsed.id);
      if (parsed.error?.message) {
        p.reject(new Error(parsed.error.message));
      } else {
        p.resolve(parsed.result);
      }
    } catch { /* ignore non-JSON */ }
  });

  const send: CdpSendFn = (method, params, sessionId) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  return { send, close };
}

/**
 * Execute a function with a CDP WebSocket connection, auto-cleanup.
 */
export async function withCdpSocket<T>(
  wsUrl: string,
  fn: (send: CdpSendFn) => Promise<T>,
): Promise<T> {
  const ws = openCdpWebSocket(wsUrl);
  const { send, close } = createCdpSender(ws);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
    ws.once("close", () => reject(new Error("CDP socket closed before open")));
  });

  try {
    return await fn(send);
  } finally {
    close();
  }
}

// ── Chrome version / health ──

export type ChromeVersion = {
  webSocketDebuggerUrl?: string;
  Browser?: string;
};

export async function fetchChromeVersion(
  cdpUrl: string,
  timeoutMs = CHROME_REACHABILITY_TIMEOUT_MS,
): Promise<ChromeVersion | null> {
  try {
    const res = await fetchCdp(appendCdpPath(cdpUrl, "/json/version"), timeoutMs);
    return (await res.json()) as ChromeVersion;
  } catch {
    return null;
  }
}

export async function getChromeWebSocketUrl(
  cdpUrl: string,
  timeoutMs = CHROME_REACHABILITY_TIMEOUT_MS,
): Promise<string | null> {
  if (isWebSocketUrl(cdpUrl)) return cdpUrl;
  const version = await fetchChromeVersion(cdpUrl, timeoutMs);
  return version?.webSocketDebuggerUrl?.trim() || null;
}

export async function isChromeReachable(
  cdpUrl: string,
  timeoutMs = CHROME_REACHABILITY_TIMEOUT_MS,
): Promise<boolean> {
  if (isWebSocketUrl(cdpUrl)) {
    return new Promise<boolean>((resolve) => {
      const ws = openCdpWebSocket(cdpUrl, { handshakeTimeoutMs: timeoutMs });
      ws.once("open", () => { try { ws.close(); } catch {} resolve(true); });
      ws.once("error", () => resolve(false));
    });
  }
  return (await fetchChromeVersion(cdpUrl, timeoutMs)) !== null;
}
