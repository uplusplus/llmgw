/**
 * Structured logger with configurable log levels.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",  // gray
  info: "\x1b[36m",   // cyan
  warn: "\x1b[33m",   // yellow
  error: "\x1b[31m",  // red
};

const RESET = "\x1b[0m";

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatTag(tag?: string): string {
  return tag ? ` [${tag}]` : "";
}

export const logger = {
  debug(msg: string, tag?: string, data?: Record<string, unknown>): void {
    if (!shouldLog("debug")) return;
    const line = `${LEVEL_COLORS.debug}${timestamp()} ${LEVEL_LABELS.debug}${RESET}${formatTag(tag)} ${msg}`;
    console.log(line, data ?? "");
  },

  info(msg: string, tag?: string, data?: Record<string, unknown>): void {
    if (!shouldLog("info")) return;
    const line = `${LEVEL_COLORS.info}${timestamp()} ${LEVEL_LABELS.info}${RESET}${formatTag(tag)} ${msg}`;
    console.log(line, data ?? "");
  },

  warn(msg: string, tag?: string, data?: Record<string, unknown>): void {
    if (!shouldLog("warn")) return;
    const line = `${LEVEL_COLORS.warn}${timestamp()} ${LEVEL_LABELS.warn}${RESET}${formatTag(tag)} ${msg}`;
    console.warn(line, data ?? "");
  },

  error(msg: string, tag?: string, data?: Record<string, unknown>): void {
    if (!shouldLog("error")) return;
    const line = `${LEVEL_COLORS.error}${timestamp()} ${LEVEL_LABELS.error}${RESET}${formatTag(tag)} ${msg}`;
    console.error(line, data ?? "");
  },
};
