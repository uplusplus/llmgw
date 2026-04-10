/**
 * BrowserManager — lifecycle manager for Chrome/Chromium with CDP.
 *
 * Responsibilities:
 *   - Launch or attach to a Chromium-based browser
 *   - Provide CDP WebSocket URL for Playwright / raw CDP usage
 *   - Health-check and graceful shutdown
 *
 * Standalone — no OpenClaw dependencies.
 */

import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type BrowserExecutable,
  resolveBrowserExecutable,
} from "./executables.js";
import {
  cdpUrlForPort,
  CHROME_LAUNCH_READY_POLL_MS,
  CHROME_LAUNCH_READY_WINDOW_MS,
  CHROME_REACHABILITY_TIMEOUT_MS,
  CHROME_STOP_TIMEOUT_MS,
  getChromeWebSocketUrl,
  isChromeReachable,
} from "./cdp.js";

// ── Types ──

export interface BrowserProfileConfig {
  name: string;
  executable?: string;
  userDataDir?: string;
  cdpPort: number;
  mode: "launch" | "headless" | "attach";
  noSandbox?: boolean;
  extraArgs?: string[];
}

export interface RunningBrowser {
  profileName: string;
  exe: BrowserExecutable;
  userDataDir: string;
  cdpPort: number;
  cdpUrl: string;
  wsUrl: string;
  startedAt: number;
  proc: ChildProcess | null; // null for attach mode
}

// ── Manager ──

export class BrowserManager {
  private browsers = new Map<string, RunningBrowser>();
  private dataDirRoot: string;

  constructor(opts?: { dataDirRoot?: string }) {
    this.dataDirRoot = opts?.dataDirRoot ?? path.join(os.homedir(), ".zero-token-service", "browser");
  }

  /**
   * Launch or attach a browser for the given profile config.
   */
  async start(profile: BrowserProfileConfig): Promise<RunningBrowser> {
    if (this.browsers.has(profile.name)) {
      return this.browsers.get(profile.name)!;
    }

    if (profile.mode === "attach") {
      return this.attach(profile);
    }
    return this.launch(profile);
  }

  /**
   * Get a running browser by profile name.
   */
  get(profileName: string): RunningBrowser | undefined {
    return this.browsers.get(profileName);
  }

  /**
   * Get or start a browser. Convenience for providers.
   */
  async ensure(profile: BrowserProfileConfig): Promise<RunningBrowser> {
    return this.get(profile.name) ?? this.start(profile);
  }

  /**
   * Stop a browser profile.
   */
  async stop(profileName: string): Promise<void> {
    const running = this.browsers.get(profileName);
    if (!running) return;

    this.browsers.delete(profileName);

    if (!running.proc || running.proc.killed) return;

    try { running.proc.kill("SIGTERM"); } catch { /* ignore */ }

    const deadline = Date.now() + CHROME_STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (running.proc.exitCode !== null) return;
      if (!(await isChromeReachable(running.cdpUrl, 200))) return;
      await sleep(100);
    }

    try { running.proc.kill("SIGKILL"); } catch { /* ignore */ }
  }

  /**
   * Stop all browsers.
   */
  async stopAll(): Promise<void> {
    const names = [...this.browsers.keys()];
    await Promise.all(names.map((n) => this.stop(n)));
  }

  // ── Private ──

  private async launch(profile: BrowserProfileConfig): Promise<RunningBrowser> {
    const exe = resolveBrowserExecutable(profile.executable);
    const userDataDir = profile.userDataDir
      ?? path.join(this.dataDirRoot, profile.name, "user-data");

    fs.mkdirSync(userDataDir, { recursive: true });

    const args = this.buildLaunchArgs(profile, userDataDir);

    // Bootstrap: launch briefly to create prefs if missing, then restart
    const localStatePath = path.join(userDataDir, "Local State");
    const prefsPath = path.join(userDataDir, "Default", "Preferences");
    if (!fs.existsSync(localStatePath) || !fs.existsSync(prefsPath)) {
      const bootstrap = spawn(exe.path, args, { stdio: ["ignore", "ignore", "pipe"] });
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (fs.existsSync(localStatePath) && fs.existsSync(prefsPath)) break;
        await sleep(200);
      }
      try { bootstrap.kill("SIGTERM"); } catch {}
      await sleep(500);
    }

    const proc = spawn(exe.path, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, HOME: os.homedir() },
    });

    const cdpUrl = cdpUrlForPort(profile.cdpPort);

    // Wait for CDP ready
    const deadline = Date.now() + CHROME_LAUNCH_READY_WINDOW_MS;
    while (Date.now() < deadline) {
      if (await isChromeReachable(cdpUrl)) break;
      await sleep(CHROME_LAUNCH_READY_POLL_MS);
    }

    if (!(await isChromeReachable(cdpUrl))) {
      try { proc.kill("SIGKILL"); } catch {}
      throw new Error(
        `Chrome failed to start on port ${profile.cdpPort} (profile: ${profile.name}). ` +
        (process.platform === "linux" && !profile.noSandbox
          ? "Hint: try noSandbox: true in config."
          : "")
      );
    }

    const wsUrl = (await getChromeWebSocketUrl(cdpUrl)) ?? cdpUrl;

    const running: RunningBrowser = {
      profileName: profile.name,
      exe,
      userDataDir,
      cdpPort: profile.cdpPort,
      cdpUrl,
      wsUrl,
      startedAt: Date.now(),
      proc,
    };

    this.browsers.set(profile.name, running);
    console.log(`[browser] Launched ${exe.kind} on :${profile.cdpPort} (pid ${proc.pid})`);
    return running;
  }

  private async attach(profile: BrowserProfileConfig): Promise<RunningBrowser> {
    const cdpUrl = cdpUrlForPort(profile.cdpPort);

    if (!(await isChromeReachable(cdpUrl))) {
      throw new Error(
        `Cannot attach: no Chrome reachable at ${cdpUrl}. ` +
        "Start Chrome with --remote-debugging-port first."
      );
    }

    const wsUrl = (await getChromeWebSocketUrl(cdpUrl)) ?? cdpUrl;
    const exe = resolveBrowserExecutable(profile.executable);

    const running: RunningBrowser = {
      profileName: profile.name,
      exe,
      userDataDir: profile.userDataDir ?? "(attached)",
      cdpPort: profile.cdpPort,
      cdpUrl,
      wsUrl,
      startedAt: Date.now(),
      proc: null,
    };

    this.browsers.set(profile.name, running);
    console.log(`[browser] Attached to Chrome at ${cdpUrl}`);
    return running;
  }

  private buildLaunchArgs(profile: BrowserProfileConfig, userDataDir: string): string[] {
    const args = [
      `--remote-debugging-port=${profile.cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-features=Translate,MediaRouter",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      "--password-store=basic",
    ];

    if (profile.mode === "headless") {
      args.push("--headless=new", "--disable-gpu");
    }
    if (profile.noSandbox || process.getuid?.() === 0) {
      args.push("--no-sandbox", "--disable-setuid-sandbox");
    }
    if (process.platform === "linux") {
      args.push("--disable-dev-shm-usage");
    }
    if (profile.extraArgs?.length) {
      args.push(...profile.extraArgs);
    }

    return args;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
