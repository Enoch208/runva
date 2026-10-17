import { cx } from "./primitives";

type Line = { kind: "add" | "del" | "ctx" | "hunk" | "meta"; text: string; oldNo?: number; newNo?: number };

function parseUnifiedDiff(diff: string): Line[] {
  const out: Line[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of diff.replace(/\n$/, "").split("\n")) {
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
      }
      out.push({ kind: "hunk", text: raw });
    } else if (/^(\+\+\+|---|diff |index |Index:|====|\\)/.test(raw)) {
      out.push({ kind: "meta", text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newNo: newNo++ });
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++ });
    } else {
      out.push({ kind: "ctx", text: raw.startsWith(" ") ? raw.slice(1) : raw, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return out;
}

export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) added++;
    else if (l.startsWith("-") && !l.startsWith("---")) removed++;
  }
  return { added, removed };
}

/** Unified diff as plain text with +/- coloring. Never interpreted as HTML. */
export function DiffView({ diff }: { diff: string }) {
  const lines = parseUnifiedDiff(diff);
  return (
    <div className="max-h-[620px] overflow-auto rounded-xl border border-white/5 bg-black py-3">
      <pre className="min-w-max font-mono text-xs leading-relaxed">
        {lines.map((l, i) => {
          if (l.kind === "meta") {
            return (
              <div key={i} className="px-4 text-neutral-600">
                {l.text}
              </div>
            );
          }
          if (l.kind === "hunk") {
            return (
              <div key={i} className="my-1 bg-white/[0.03] px-4 py-0.5 text-neutral-500">
                {l.text}
              </div>
            );
          }
          return (
            <div
              key={i}
              className={cx(
                "flex",
                l.kind === "add" ? "bg-green-500/[0.07] text-neutral-100" : l.kind === "del" ? "bg-red-500/[0.08] text-neutral-300" : "text-neutral-400",
              )}
            >
              <span className="w-10 shrink-0 select-none pr-2 text-right text-neutral-700">{l.oldNo ?? ""}</span>
              <span className="w-10 shrink-0 select-none pr-2 text-right text-neutral-700">{l.newNo ?? ""}</span>
              <span
                className={cx(
                  "w-5 shrink-0 select-none text-center",
                  l.kind === "add" ? "text-green-500" : l.kind === "del" ? "text-red-500" : "text-neutral-700",
                )}
              >
                {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
              </span>
              <span className="whitespace-pre pr-6">{l.text || " "}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
