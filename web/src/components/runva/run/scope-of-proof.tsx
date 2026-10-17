const limits = [
  "Verified for these synthetic conditions in this sandbox.",
  "Not a production guarantee.",
  "Production durability requires a transactional/idempotent datastore.",
  "Hashes identify artifacts; they are not proof of correctness.",
] as const;

export function ScopeOfProof() {
  return (
    <section id="scope" className="flex flex-col gap-4 rounded-2xl border border-[#FF5A36]/20 bg-[#0a0a0a] p-5 lg:p-6 scroll-mt-6">
      <div className="flex max-w-2xl flex-col gap-1">
        <h3 className="text-base font-medium text-white">Scope of proof</h3>
        <p className="text-xs text-neutral-500">What a verdict on this page does and does not mean.</p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {limits.map((line) => (
          <li key={line} className="text-xs text-neutral-400">
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}
