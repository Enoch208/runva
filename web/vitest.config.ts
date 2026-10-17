import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Host-only unit tests: never inherit real credentials from the shell.
    env: {
      CREATEOS_SANDBOX_API_KEY: "",
      OPENROUTER_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
  },
});
