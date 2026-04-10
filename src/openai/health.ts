/**
 * GET /health — service health check.
 */

import type { Context } from "hono";
import type { ProviderAdapter } from "../types.js";

export function healthHandler(
  providers: Map<string, ProviderAdapter>,
  modelIndex: Map<string, ProviderAdapter>,
) {
  return (c: Context) => {
    return c.json({
      status: "ok",
      providers: [...providers.keys()],
      models: [...modelIndex.keys()],
    });
  };
}
