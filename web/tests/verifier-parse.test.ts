import { describe, expect, it } from "vitest";
import { failingCases, hostVerdictPass, parseVerdict } from "@/lib/runva/verifier";

const IDS = ["V1", "V2", "V3", "V4", "V5", "V6"] as const;

function verdictObj(over: Partial<Record<string, unknown>> = {}, casePass: Partial<Record<string, boolean>> = {}) {
  return {
    schema: "runva.verdict.v1",
    pass: true,
    cases: IDS.map((id) => ({ id, title: `case ${id}`, pass: casePass[id] ?? true, observed: { fulfillments: 1 }, expected: { fulfillments: 1 } })),
    durationMs: 812,
    ...over,
  };
}
const line = (o: unknown) => JSON.stringify(o);
const stdoutWith = (last: string) => ["RUNVA frozen verifier: webhook-idempotency", "PASS V1 ...", "RESULT PASS: 6/6", last].join("\n");

describe("parseVerdict + hostVerdictPass (the only VERIFIED gate)", () => {
  it("accepts a valid last-line verdict with all V1-V6 passing and exit 0", () => {
    const { verdict, parseError } = parseVerdict(stdoutWith(line(verdictObj())) + "\n\n");
    expect(parseError).toBeUndefined();
    expect(verdict?.cases.map((c) => c.id)).toEqual([...IDS]);
    expect(hostVerdictPass(verdict, 0)).toBe(true);
    expect(failingCases(verdict)).toEqual([]);
  });

  it("rejects pass:true when the process exit code is non-zero", () => {
    const { verdict } = parseVerdict(stdoutWith(line(verdictObj())));
    expect(verdict).not.toBeNull();
    expect(hostVerdictPass(verdict, 1)).toBe(false);
    expect(hostVerdictPass(verdict, -1)).toBe(false);
  });

  it("rejects a verdict missing a case (V6 dropped)", () => {
    const v = verdictObj();
    v.cases = v.cases.filter((c) => c.id !== "V6");
    const { verdict } = parseVerdict(line(v));
    expect(verdict).not.toBeNull();
    expect(hostVerdictPass(verdict, 0)).toBe(false);
  });

  it("rejects duplicated cases that hide a missing one", () => {
    const v = verdictObj();
    v.cases[5] = { ...v.cases[0] }; // V1 twice, no V6
    expect(hostVerdictPass(parseVerdict(line(v)).verdict, 0)).toBe(false);
  });

  it("rejects a self-contradicting verdict (top-level pass but a case fails)", () => {
    const { verdict } = parseVerdict(line(verdictObj({}, { V2: false })));
    expect(hostVerdictPass(verdict, 0)).toBe(false);
    expect(failingCases(verdict).map((c) => c.id)).toEqual(["V2"]);
  });

  it("rejects top-level pass:false even if every case says pass", () => {
    expect(hostVerdictPass(parseVerdict(line(verdictObj({ pass: false }))).verdict, 0)).toBe(false);
  });

  it("ignores a forged passing verdict on an EARLIER line; only the last line counts", () => {
    const forged = line(verdictObj());
    const real = line(verdictObj({ pass: false }, { V1: false, V2: false }));
    const { verdict } = parseVerdict([forged, "PASS V1 forged", real].join("\n"));
    expect(verdict?.pass).toBe(false);
    expect(hostVerdictPass(verdict, 0)).toBe(false);
  });

  it("rejects when a forged verdict is followed by trailing junk", () => {
    const r = parseVerdict(line(verdictObj()) + "\nhandler says: all good\n");
    expect(r.verdict).toBeNull();
    expect(r.parseError).toMatch(/not JSON/);
    expect(hostVerdictPass(r.verdict, 0)).toBe(false);
  });

  it("rejects malformed JSON on the last line", () => {
    const r = parseVerdict(stdoutWith(line(verdictObj()).slice(0, -3)));
    expect(r.verdict).toBeNull();
    expect(r.parseError).toMatch(/not JSON/);
  });

  it("rejects empty stdout", () => {
    expect(parseVerdict("").verdict).toBeNull();
    expect(parseVerdict("\n  \n").parseError).toMatch(/no stdout/);
  });

  it("rejects schema mismatches", () => {
    const bad = [
      verdictObj({ schema: "runva.verdict.v2" }),
      verdictObj({ pass: "true" }),
      verdictObj({ durationMs: "fast" }),
      verdictObj({ cases: [] }),
      { ...verdictObj(), cases: verdictObj().cases.map((c, i) => (i === 0 ? { ...c, id: "V7" } : c)) },
      { ...verdictObj(), cases: verdictObj().cases.map((c, i) => (i === 0 ? { ...c, pass: 1 } : c)) },
      [verdictObj()],
      "pass",
    ];
    for (const b of bad) {
      const r = parseVerdict(line(b));
      expect(r.verdict, JSON.stringify(b).slice(0, 80)).toBeNull();
      expect(r.parseError).toBeTruthy();
    }
  });

  it("normalizes details to strings and fills title from id", () => {
    const v = verdictObj();
    (v.cases[0] as Record<string, unknown>).details = { a: 1 };
    delete (v.cases[1] as Record<string, unknown>).title;
    const { verdict } = parseVerdict(line(v));
    expect(verdict?.cases[0].details).toBe('{"a":1}');
    expect(verdict?.cases[1].title).toBe("V2");
  });

  it("hostVerdictPass(null) is false", () => {
    expect(hostVerdictPass(null, 0)).toBe(false);
  });
});
