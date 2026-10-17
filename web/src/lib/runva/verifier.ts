import { z } from "zod";
import type { Verdict, VerdictCase } from "./types";

const CASE_IDS = ["V1", "V2", "V3", "V4", "V5", "V6"] as const;

const VerdictCaseSchema = z.object({
  id: z.enum(CASE_IDS),
  title: z.string().optional(),
  pass: z.boolean(),
  observed: z.unknown().optional(),
  expected: z.unknown().optional(),
  details: z.unknown().optional(),
});

const VerdictSchema = z.object({
  schema: z.literal("runva.verdict.v1"),
  pass: z.boolean(),
  cases: z.array(VerdictCaseSchema).min(1).max(20),
  durationMs: z.number(),
});

export type ParsedVerdict = { verdict: Verdict | null; parseError?: string };

/** Parse the LAST non-empty stdout line of the frozen verifier as a runva.verdict.v1 object (host-side, trusted code). */
export function parseVerdict(stdout: string): ParsedVerdict {
  const lines = (stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return { verdict: null, parseError: "verifier produced no stdout" };
  let json: unknown;
  try {
    json = JSON.parse(last);
  } catch {
    return { verdict: null, parseError: "last stdout line is not JSON" };
  }
  const r = VerdictSchema.safeParse(json);
  if (!r.success) return { verdict: null, parseError: `verdict schema mismatch: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const cases: VerdictCase[] = r.data.cases.map((c) => ({
    id: c.id,
    title: c.title ?? c.id,
    pass: c.pass,
    observed: c.observed ?? null,
    expected: c.expected ?? null,
    ...(c.details === undefined || c.details === null
      ? {}
      : { details: typeof c.details === "string" ? c.details : JSON.stringify(c.details) }),
  }));
  return { verdict: { schema: "runva.verdict.v1", pass: r.data.pass, cases, durationMs: r.data.durationMs } };
}

/**
 * Host assertion: the ONLY gate for VERIFIED. Requires a parsed verdict that says pass, every case V1–V6
 * present and passing (no self-contradiction), and a zero process exit code.
 */
export function hostVerdictPass(verdict: Verdict | null, exitCode: number): boolean {
  if (!verdict || exitCode !== 0 || verdict.pass !== true) return false;
  const ids = new Set(verdict.cases.map((c) => c.id));
  if (!CASE_IDS.every((id) => ids.has(id))) return false;
  return verdict.cases.every((c) => c.pass === true);
}

export function failingCases(verdict: Verdict | null): VerdictCase[] {
  return verdict ? verdict.cases.filter((c) => !c.pass) : [];
}
