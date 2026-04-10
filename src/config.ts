import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { GatewayConfig } from "./types.js";

const DEFAULT_CONFIG_PATH = "config.json";

export function loadConfig(configPath?: string): GatewayConfig {
  const path = resolve(configPath || process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH);

  if (!existsSync(path)) {
    console.error(`[Config] Config file not found: ${path}`);
    console.error(`[Config] Copy config.example.json to config.json and fill in your credentials.`);
    process.exit(1);
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const config = JSON.parse(raw) as GatewayConfig;

    // Allow env overrides
    if (process.env.PORT) {
      config.port = parseInt(process.env.PORT, 10);
    }
    if (process.env.API_KEY) {
      config.apiKey = process.env.API_KEY;
    }

    if (!config.port) {
      config.port = 3456;
    }

    if (!config.providers || Object.keys(config.providers).length === 0) {
      console.error("[Config] No providers configured. Check your config.json.");
      process.exit(1);
    }

    if (!config.modelMapping || Object.keys(config.modelMapping).length === 0) {
      console.error("[Config] No model mappings configured. Check your config.json.");
      process.exit(1);
    }

    console.log(`[Config] Loaded ${Object.keys(config.providers).length} providers, ${Object.keys(config.modelMapping).length} model mappings`);
    return config;
  } catch (err) {
    console.error(`[Config] Failed to parse config: ${err}`);
    process.exit(1);
  }
}
