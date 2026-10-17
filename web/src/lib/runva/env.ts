// Server-only configuration. Never send any of these values to the browser.

/** Treat placeholders like "..." as missing: real provider keys are long. */
const realKey = (v: string | undefined): string | undefined => (v && v.trim().length >= 20 ? v.trim() : undefined);

export type SandboxEnv = {
  apiKey: string | undefined;
  /** NAME of the env var that supplied the key (never the value). */
  apiKeySource: "CREATEOS_SANDBOX_API_KEY" | null;
  baseUrl: string;
  shape: string;
  rootfs: string;
  egress: string[];
  regionLabel: string;
  freshVerifierVm: boolean;
};

export function sandboxEnv(): SandboxEnv {
  // ONLY the user's own sandbox key. CREATEOS_PLAN_API_KEY / CREATEOS_PROJECT_API_KEY belong to a different
  // CreateOS account and must never be used for sandbox execution.
  const apiKey = realKey(process.env.CREATEOS_SANDBOX_API_KEY);
  const apiKeySource = apiKey ? "CREATEOS_SANDBOX_API_KEY" : null;
  const egressRaw = process.env.RUNVA_SANDBOX_EGRESS;
  let egress = egressRaw ? egressRaw.split(",").map((s) => s.trim()).filter(Boolean) : ["registry.npmjs.org:443"];
  // An EMPTY list (or "*") means allow-all on CreateOS. Never allow that.
  if (egress.length === 0 || egress.includes("*")) egress = ["registry.npmjs.org:443"];
  return {
    apiKey,
    apiKeySource,
    baseUrl: (process.env.CREATEOS_SANDBOX_BASE_URL || "https://api-eu.sb.createos.sh").replace(/\/+$/, ""),
    shape: process.env.RUNVA_SANDBOX_SHAPE || "s-1vcpu-1gb",
    rootfs: process.env.RUNVA_SANDBOX_ROOTFS || "devbox:1",
    egress,
    regionLabel: process.env.RUNVA_SANDBOX_REGION || "eu",
    freshVerifierVm: process.env.RUNVA_FRESH_VERIFIER_VM !== "false",
  };
}

export type LlmEnv =
  | { provider: "openrouter"; apiKey: string; model: string }
  | { provider: "anthropic"; apiKey: string; model: string }
  | { provider: "none"; apiKey: undefined; model: string };

export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-5.5";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

export function llmEnv(): LlmEnv {
  const or = realKey(process.env.OPENROUTER_API_KEY);
  if (or) return { provider: "openrouter", apiKey: or, model: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL };
  const an = realKey(process.env.ANTHROPIC_API_KEY);
  if (an) return { provider: "anthropic", apiKey: an, model: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL };
  return { provider: "none", apiKey: undefined, model: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL };
}

export function modelLabel(): string {
  const l = llmEnv();
  return l.provider === "none" ? `unconfigured (${l.model})` : `${l.provider}:${l.model}`;
}

function intEnv(name: string, def: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || process.env[name] === undefined || process.env[name] === "") return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export const runEnv = () => ({
  maxRunMs: intEnv("RUNVA_MAX_RUN_MS", 300_000, 30_000, 900_000),
  maxRepairRetries: intEnv("RUNVA_MAX_REPAIR_RETRIES", 2, 0, 2),
  llmTimeoutMs: intEnv("RUNVA_LLM_TIMEOUT_MS", 150_000, 10_000, 600_000),
  sandboxCreateTimeoutMs: intEnv("RUNVA_SANDBOX_CREATE_TIMEOUT_MS", 90_000, 10_000, 300_000),
  commandTimeoutMs: intEnv("RUNVA_COMMAND_TIMEOUT_MS", 60_000, 5_000, 300_000),
  cooldownMs: intEnv("RUNVA_COOLDOWN_MS", 15_000, 0, 600_000),
  accessCode: process.env.RUNVA_ACCESS_CODE || undefined,
});
