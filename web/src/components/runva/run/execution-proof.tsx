import { HugeiconsIcon } from "@hugeicons/react";
import { CancelCircleIcon, CheckmarkCircle02Icon, Clock01Icon } from "@hugeicons/core-free-icons";
import type { RunSummary, SandboxRecord } from "@/lib/runva/types";
import { DEFAULT_CREDENTIAL_ENV, STACK } from "../stack";
import { formatMs, isTerminal, shortHash } from "../run-model";
import { ExitChip, Panel, PanelTitle, cx } from "./primitives";

type Check = "pass" | "fail" | "pending";

function CheckIcon({ state }: { state: Check }) {
  return (
    <HugeiconsIcon
      icon={state === "pending" ? Clock01Icon : state === "pass" ? CheckmarkCircle02Icon : CancelCircleIcon}
      size={20}
      className={cx("shrink-0", state === "pending" ? "text-neutral-500" : state === "pass" ? "text-green-500" : "text-red-500")}
    />
  );
}

function CardHead({ eyebrow, title, state }: { eyebrow: string; title: string; state: Check | "info" }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">{eyebrow}</span>
        <h4 className="text-sm font-medium text-white">{title}</h4>
      </div>
      {state === "info" ? null : <CheckIcon state={state} />}
    </div>
  );
}

function Card({ children, dashed = false }: { children: React.ReactNode; dashed?: boolean }) {
  return (
    <article
      className={cx(
        "flex min-w-0 flex-col gap-4 rounded-2xl border bg-[#0a0a0a] p-5",
        dashed ? "border-dashed border-white/10" : "border-white/5",
      )}
    >
      {children}
    </article>
  );
}

function Missing({ terminal, pending }: { terminal: boolean; pending: string }) {
  return (
    <div className="rounded-lg border border-white/10 px-3 py-2 font-mono text-xs text-neutral-400">
      {terminal ? "Not produced in this run" : pending}
    </div>
  );
}

// ---------- 1. Sandbox lifecycle ----------

function VmRow({ vm }: { vm: SandboxRecord }) {
  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-white">{vm.id}</span>
        <span
          className={cx(
            "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            vm.purpose === "fresh-verifier" ? "border-[#FF5A36]/30 text-[#FF5A36]" : "border-white/10 text-neutral-400",
          )}
        >
          {vm.purpose === "fresh-verifier" ? "fresh verifier" : "work"}
        </span>
        <span
          className={cx("ml-auto font-mono text-[11px]", vm.destroyed ? "text-neutral-200" : "text-amber-300")}
          title={vm.destroyed ? "VM destroyed after use" : "No destroy recorded"}
        >
          {vm.destroyed ? `destroyed ✓${vm.destroyMs != null ? ` · ${formatMs(vm.destroyMs)}` : ""}` : "not destroyed"}
        </span>
      </div>
      <span className="font-mono text-[11px] text-neutral-500">
        {[vm.shape, vm.region].filter(Boolean).join(" · ")} · created in {formatMs(vm.createMs)}
      </span>
    </li>
  );
}

export function SandboxLifecycleCard({ summary }: { summary: RunSummary }) {
  const vms = summary.sandboxes ?? [];
  const terminal = isTerminal(summary.status);
  const fresh = summary.freshVerifierVm === true;
  const allDestroyed = vms.length > 0 && vms.every((v) => v.destroyed);
  const state: Check = vms.length === 0 ? "pending" : terminal ? (allDestroyed ? "pass" : "fail") : "pending";
  const title = fresh
    ? "Final verdict ran in a fresh VM"
    : vms.length
      ? `${vms.length} CreateOS VM${vms.length === 1 ? "" : "s"} used`
      : "CreateOS VMs";

  return (
    <Card dashed={vms.length === 0}>
      <CardHead eyebrow="Sandbox lifecycle" title={title} state={fresh ? "pass" : state} />
      {vms.length === 0 ? (
        <Missing terminal={terminal} pending="Pending · no VM created yet" />
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/5 bg-white/[0.02] p-3">
          {vms.map((vm, i) => (
            <VmRow key={`${vm.id}-${i}`} vm={vm} />
          ))}
        </ul>
      )}
      <span className="mt-auto font-mono text-[11px] text-neutral-500">
        {fresh
          ? "Verifier VM held only the final handler + frozen verifier"
          : vms.length
            ? allDestroyed
              ? "Every VM destroyed after use"
              : terminal
                ? "Destroy not recorded for every VM"
                : "VMs are destroyed on success, error, timeout and cancel"
            : "sandbox-execution · CreateOS SDK"}
      </span>
    </Card>
  );
}

// ---------- 2. Isolation proof ----------

export function IsolationProofCard({ summary }: { summary: RunSummary }) {
  const check = summary.egressCheck;
  const terminal = isTerminal(summary.status);
  const allowlist = summary.sandbox?.egress ?? [];
  const state: Check = !check ? "pending" : check.blocked ? "pass" : "fail";
  const stderr = check?.command.stderr?.trim() || check?.command.stdout?.trim() || "";
  const snippet = stderr.length > 240 ? `${stderr.slice(0, 240)}…` : stderr;

  return (
    <Card dashed={!check}>
      <CardHead
        eyebrow="Isolation proof"
        title={
          !check
            ? "Outbound request to a non-allowlisted host"
            : check.blocked
              ? "Non-allowlisted egress → BLOCKED"
              : "Non-allowlisted egress was NOT blocked"
        }
        state={state}
      />
      {!check ? (
        <Missing terminal={terminal} pending="Pending · egress probe not run yet" />
      ) : (
        <div className="flex flex-col gap-2">
          <div
            className={cx(
              "rounded-lg border px-3 py-2 font-mono text-xs",
              check.blocked ? "border-white/10 text-neutral-200" : "border-[#FF5A36]/20 bg-[#FF5A36]/5 text-[#FF5A36]",
            )}
          >
            {check.blocked ? "Blocked from inside the VM" : "Request succeeded — isolation not proven"} ·{" "}
            <ExitChip code={check.command.exitCode} />
          </div>
          <code className="block overflow-x-auto whitespace-pre rounded-lg border border-white/5 bg-black px-3 py-2 font-mono text-[11px] text-neutral-300 no-scrollbar">
            $ {check.command.cmd}
          </code>
          {snippet ? (
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/5 bg-black px-3 py-2 font-mono text-[10px] leading-relaxed text-neutral-500">
              {snippet}
            </pre>
          ) : null}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-neutral-500">Egress allowlist</span>
        {allowlist.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {allowlist.map((host) => (
              <li key={host} className="rounded-md border border-white/10 px-2 py-0.5 font-mono text-[11px] text-neutral-200">
                {host}
              </li>
            ))}
          </ul>
        ) : (
          <span className="font-mono text-[11px] text-neutral-600">{summary.sandbox ? "empty — no outbound hosts" : "—"}</span>
        )}
        <span className="font-mono text-[11px] text-neutral-500">Ingress disabled</span>
      </div>
    </Card>
  );
}

// ---------- 3. Verifier integrity ----------

export function VerifierIntegrityCard({ summary }: { summary: RunSummary }) {
  const vi = summary.verifierIntegrity;
  const terminal = isTerminal(summary.status);
  const state: Check = !vi ? "pending" : vi.match ? "pass" : "fail";

  return (
    <Card dashed={!vi}>
      <CardHead
        eyebrow="Verifier integrity"
        title={!vi ? "Pinned hash vs hash measured in the VM" : vi.match ? "Verifier bytes match the pinned hash" : "Verifier hash MISMATCH"}
        state={state}
      />
      {!vi ? (
        <Missing terminal={terminal} pending="Pending · measured inside the final VM" />
      ) : (
        <dl className="flex flex-col gap-2 font-mono text-[11px]">
          <div className="flex flex-col gap-0.5">
            <dt className="text-neutral-600">Host-pinned sha256</dt>
            <dd className="break-all text-neutral-200">{vi.expectedSha256}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-neutral-600">Measured inside final VM</dt>
            <dd className={cx("break-all", vi.observedSha256 == null ? "text-amber-300" : vi.match ? "text-neutral-200" : "text-[#FF5A36]")}>
              {vi.observedSha256 ?? "could not be measured"}
            </dd>
          </div>
          <div
            className={cx(
              "mt-1 w-fit rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider",
              vi.match ? "border-green-500/25 text-green-500" : "border-red-500/25 bg-red-500/5 text-red-500",
            )}
          >
            {vi.match ? "Match" : "Mismatch"}
          </div>
        </dl>
      )}
      <span className="mt-auto font-mono text-[11px] text-neutral-500">
        sha256 /workspace/verification.mjs · pinned {shortHash(summary.verifierSha256, 10)}
      </span>
    </Card>
  );
}

// ---------- 4. Stack ----------

export function StackCard({ summary }: { summary: RunSummary }) {
  const credential = summary.credentialSource || DEFAULT_CREDENTIAL_ENV;
  return (
    <Card>
      <CardHead eyebrow="Stack" title={`Provisioned with ${STACK.provisionedWith}`} state="info" />
      <dl className="grid grid-cols-1 gap-2 font-mono text-[11px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-neutral-600">Provider</dt>
          <dd className="text-neutral-200">{STACK.provider}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-neutral-600">Resources</dt>
          <dd className="text-right text-neutral-200">
            {STACK.resources.map((r) => (r.note ? `${r.name} (${r.note})` : r.name)).join(", ")}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-neutral-600">Sandbox credential</dt>
          <dd className="text-neutral-200" title="Environment variable name only — the value never leaves the server">
            env {credential}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-neutral-600">LLM</dt>
          <dd className="min-w-0 truncate text-neutral-200" title={summary.model}>
            {[summary.provider, summary.model].filter(Boolean).join(" · ") || "—"}
          </dd>
        </div>
      </dl>
      <span className="mt-auto font-mono text-[11px] text-neutral-500">Names only · no keys or account data are sent to the browser</span>
    </Card>
  );
}

/** "Proof of execution" panel: the strongest non-verdict evidence, impossible to miss. */
export function ExecutionProofPanel({ summary }: { summary: RunSummary }) {
  return (
    <Panel id="execution-proof">
      <PanelTitle
        title="Proof of execution"
        description="Where the code ran, what it could reach, and whether the verifier was the one we pinned. All values come from the CreateOS run."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <SandboxLifecycleCard summary={summary} />
        <IsolationProofCard summary={summary} />
        <VerifierIntegrityCard summary={summary} />
        <StackCard summary={summary} />
      </div>
    </Panel>
  );
}

/** Compact chips for the verdict panel; each appears only when the backing data exists. */
export function ProofChips({ summary }: { summary: RunSummary }) {
  const chips: { label: string; ok: boolean }[] = [];
  if (summary.freshVerifierVm != null) chips.push({ label: summary.freshVerifierVm ? "Verdict in a fresh VM" : "Verdict not in a fresh VM", ok: summary.freshVerifierVm });
  if (summary.egressCheck) chips.push({ label: summary.egressCheck.blocked ? "Egress blocked" : "Egress NOT blocked", ok: summary.egressCheck.blocked });
  if (summary.verifierIntegrity) chips.push({ label: summary.verifierIntegrity.match ? "Verifier hash match" : "Verifier hash mismatch", ok: summary.verifierIntegrity.match });
  const vms = summary.sandboxes ?? [];
  if (vms.length && isTerminal(summary.status)) {
    const all = vms.every((v) => v.destroyed);
    chips.push({ label: all ? `${vms.length} VM${vms.length === 1 ? "" : "s"} destroyed` : "VM destroy not recorded", ok: all });
  }
  if (chips.length === 0) return null;
  return (
    <a href="#execution-proof" className="flex flex-wrap gap-2" aria-label="Jump to proof of execution">
      {chips.map((c) => (
        <span
          key={c.label}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium",
            c.ok ? "border-white/10 bg-white/[0.03] text-neutral-200" : "border-[#FF5A36]/30 bg-[#FF5A36]/5 text-[#FF5A36]",
          )}
        >
          <span className={cx("h-1.5 w-1.5 rounded-full", c.ok ? "bg-green-500" : "bg-[#FF5A36]")} />
          {c.label}
        </span>
      ))}
    </a>
  );
}
