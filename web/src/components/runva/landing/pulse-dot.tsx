export function PulseDot({ tone = "red" }: { tone?: "red" | "green" | "amber" | "neutral" }) {
  const ping = { red: "bg-red-400", green: "bg-green-500", amber: "bg-amber-300", neutral: "bg-neutral-400" }[tone];
  const dot = { red: "bg-red-500", green: "bg-green-500", amber: "bg-amber-300", neutral: "bg-neutral-500" }[tone];
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${ping} opacity-75`} />
      <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${dot}`} />
    </span>
  );
}
