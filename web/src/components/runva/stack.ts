// Static, non-secret description of how RUNVA's infrastructure is provisioned.
// No keys, tokens or account identifiers belong in this file.

export const STACK = {
  provisionedWith: "Stripe Projects",
  provider: "createos",
  resources: [
    { name: "createos-plan", note: "free" },
    { name: "createos-project", note: undefined },
  ],
  sandboxProduct: "CreateOS Sandbox",
} as const;

/** Name of the env var that holds the CreateOS credential (the name only, never the value). */
export const DEFAULT_CREDENTIAL_ENV = "CREATEOS_SANDBOX_API_KEY";

export function receiptJsonHref(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/receipt.json`;
}
