import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/server.ts"],
  outDir: "dist",
  format: "esm",
  target: "node22",
  clean: true,
  sourcemap: false,
  external: ["playwright-core", "chromium-bidi"],
});
