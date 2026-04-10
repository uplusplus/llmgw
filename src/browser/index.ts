export { BrowserManager } from "./manager.js";
export type { BrowserProfileConfig, RunningBrowser } from "./manager.js";
export { detectBrowser, resolveBrowserExecutable } from "./executables.js";
export type { BrowserExecutable } from "./executables.js";
export {
  isChromeReachable,
  getChromeWebSocketUrl,
  withCdpSocket,
  createCdpSender,
  openCdpWebSocket,
} from "./cdp.js";
export type { CdpSendFn } from "./cdp.js";
