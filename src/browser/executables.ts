/**
 * Cross-platform Chrome/Chromium executable detection.
 * Simplified from OpenClaw extensions/browser — no external deps.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type BrowserExecutable = {
  kind: "chrome" | "chromium" | "brave" | "edge" | "custom";
  path: string;
};

function exists(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}

function execText(cmd: string, args: string[], timeoutMs = 1500): string | null {
  try {
    return (execFileSync(cmd, args, { timeout: timeoutMs, encoding: "utf8" }) ?? "").trim() || null;
  } catch {
    return null;
  }
}

// ── Linux ──

function detectLinux(): BrowserExecutable | null {
  const candidates: BrowserExecutable[] = [
    { kind: "chrome",   path: "/usr/bin/google-chrome" },
    { kind: "chrome",   path: "/usr/bin/google-chrome-stable" },
    { kind: "chrome",   path: "/usr/bin/chrome" },
    { kind: "chromium", path: "/usr/bin/chromium" },
    { kind: "chromium", path: "/usr/bin/chromium-browser" },
    { kind: "chromium", path: "/snap/bin/chromium" },
    { kind: "brave",    path: "/usr/bin/brave-browser" },
    { kind: "brave",    path: "/usr/bin/brave" },
    { kind: "edge",     path: "/usr/bin/microsoft-edge" },
    { kind: "edge",     path: "/usr/bin/microsoft-edge-stable" },
  ];
  return candidates.find((c) => exists(c.path)) ?? null;
}

// ── macOS ──

function detectMac(): BrowserExecutable | null {
  const home = os.homedir();
  const candidates: BrowserExecutable[] = [
    { kind: "chrome",   path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
    { kind: "chrome",   path: `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` },
    { kind: "chromium", path: "/Applications/Chromium.app/Contents/MacOS/Chromium" },
    { kind: "brave",    path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" },
    { kind: "edge",     path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
  ];
  return candidates.find((c) => exists(c.path)) ?? null;
}

// ── Windows ──

function detectWindows(): BrowserExecutable | null {
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const pf   = process.env.ProgramFiles ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const j = path.win32.join;
  const candidates: BrowserExecutable[] = [];

  if (localAppData) {
    candidates.push({ kind: "chrome",   path: j(localAppData, "Google", "Chrome", "Application", "chrome.exe") });
    candidates.push({ kind: "chromium", path: j(localAppData, "Chromium", "Application", "chrome.exe") });
    candidates.push({ kind: "brave",    path: j(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe") });
    candidates.push({ kind: "edge",     path: j(localAppData, "Microsoft", "Edge", "Application", "msedge.exe") });
  }
  candidates.push({ kind: "chrome", path: j(pf,   "Google", "Chrome", "Application", "chrome.exe") });
  candidates.push({ kind: "chrome", path: j(pf86, "Google", "Chrome", "Application", "chrome.exe") });
  candidates.push({ kind: "brave",  path: j(pf,   "BraveSoftware", "Brave-Browser", "Application", "brave.exe") });
  candidates.push({ kind: "edge",   path: j(pf,   "Microsoft", "Edge", "Application", "msedge.exe") });

  return candidates.find((c) => exists(c.path)) ?? null;
}

/**
 * Auto-detect a Chromium-based browser on the current platform.
 * Falls back to null if nothing found.
 */
export function detectBrowser(): BrowserExecutable | null {
  if (process.platform === "linux")  return detectLinux();
  if (process.platform === "darwin") return detectMac();
  if (process.platform === "win32")  return detectWindows();
  return null;
}

/**
 * Resolve browser executable: explicit path > auto-detect.
 */
export function resolveBrowserExecutable(explicitPath?: string): BrowserExecutable {
  if (explicitPath) {
    if (!exists(explicitPath)) {
      throw new Error(`Browser executable not found: ${explicitPath}`);
    }
    return { kind: "custom", path: explicitPath };
  }
  const detected = detectBrowser();
  if (!detected) {
    throw new Error(
      "No Chromium-based browser found. Install Chrome, Chromium, Brave, or Edge, " +
      "or set browser.profiles.<name>.executable in config.yaml"
    );
  }
  return detected;
}
