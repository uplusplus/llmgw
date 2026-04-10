/**
 * GET /v1/models — list all available models.
 */

import type { Context } from "hono";
import type { ModelListItem, ModelListResponse, ProviderAdapter } from "../types.js";

export function modelsHandler(providers: Map<string, ProviderAdapter>) {
  return (c: Context) => {
    const models: ModelListItem[] = [];

    for (const provider of providers.values()) {
      for (const model of provider.models) {
        models.push({
          id: model.id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: provider.id,
        });
      }
    }

    const response: ModelListResponse = { object: "list", data: models };
    return c.json(response);
  };
}
