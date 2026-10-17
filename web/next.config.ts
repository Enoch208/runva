import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Secrets live in the repo-root .env (one level above web/). Next only reads web/.env*, so load the
// RUNVA-relevant keys from ../.env when present. Never overrides variables already set by the platform.
(function loadParentEnv() {
  const file = path.resolve(process.cwd(), "..", ".env");
  if (!existsSync(file)) return;
  const allowed = /^(CREATEOS_SANDBOX_|OPENROUTER_|ANTHROPIC_|RUNVA_)/;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || !allowed.test(m[1]) || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
})();

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The host-owned fixture (baseline handler + frozen verifier + invariant) is read from disk at runtime.
  outputFileTracingIncludes: {
    "/api/**/*": ["./fixtures/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
