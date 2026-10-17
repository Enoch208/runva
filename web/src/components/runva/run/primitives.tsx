import type { ReactNode } from "react";
import type { RunStatus } from "@/lib/runva/types";
import { STATUS_LABEL, TONE_STYLES, isTerminal, toneFor } from "../run-model";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Panel: rounded-2xl, hairline border, #0a0a0a. */
export function Panel({
  id,
  children,
  className,
  accent = false,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <section
      id={id}
      className={cx(
        "flex flex-col gap-5 rounded-2xl border bg-[#0a0a0a] p-5 lg:p-6 scroll-mt-6",
        accent ? "border-[#FF5A36]/20" : "border-white/5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelTitle({
  title,
  description,
  aside,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="flex max-w-2xl flex-col gap-1">
        <h3 className="text-base font-medium text-white">{title}</h3>
        {description ? <p className="text-xs text-neutral-500">{description}</p> : null}
      </div>
      {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("text-[10px] font-semibold uppercase tracking-widest text-neutral-500", className)}>
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: RunStatus }) {
  const s = TONE_STYLES[toneFor(status)];
  const live = !isTerminal(status);
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider",
        s.border,
        s.bg,
        s.text,
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {live ? <span className={cx("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", s.dot)} /> : null}
        <span className={cx("relative inline-flex h-1.5 w-1.5 rounded-full", s.dot)} />
      </span>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function MonoChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md border border-white/10 px-2 py-0.5 font-mono text-[11px] text-neutral-200",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ExitChip({ code }: { code: number | undefined | null }) {
  if (code == null) return <span className="font-mono text-[11px] text-neutral-600">exit —</span>;
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md border px-1.5 py-px font-mono text-[10px]",
        code === 0 ? "border-white/10 text-neutral-200" : "border-[#FF5A36]/20 bg-[#FF5A36]/5 text-[#FF5A36]",
      )}
    >
      exit {code}
    </span>
  );
}

/** Plain-text code block (React escapes it) in the black console style. */
export function CodeBlock({
  code,
  lineNumbers = true,
  className,
}: {
  code: string;
  lineNumbers?: boolean;
  className?: string;
}) {
  const lines = code.replace(/\n$/, "").split("\n");
  const width = String(lines.length).length;
  return (
    <div className={cx("max-h-[560px] overflow-auto rounded-xl border border-white/5 bg-black px-4 py-3", className)}>
      <pre className="min-w-max font-mono text-xs leading-relaxed text-neutral-200">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            {lineNumbers ? (
              <span className="mr-4 shrink-0 select-none text-right text-neutral-700" style={{ width: `${width}ch` }}>
                {i + 1}
              </span>
            ) : null}
            <span className="whitespace-pre">{line || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

export function OutputBlock({ label, text, error = false }: { label: string; text: string; error?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/5 bg-black">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
        <span className={cx("font-mono text-[10px] uppercase tracking-widest", error ? "text-[#FF5A36]" : "text-neutral-500")}>
          {label}
        </span>
        <span className="font-mono text-[10px] text-neutral-600">{text.length.toLocaleString("en-US")} chars</span>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11px] leading-relaxed text-neutral-300">
        {text}
      </pre>
    </div>
  );
}

export const primaryButton =
  "inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-neutral-500";
export const secondaryButton =
  "inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-50";
export const dangerButton =
  "inline-flex items-center gap-2 rounded-full border border-[#FF5A36]/30 px-4 py-2 text-xs font-medium text-[#FF5A36] transition-colors hover:bg-[#FF5A36] hover:text-black disabled:cursor-not-allowed disabled:opacity-50";
