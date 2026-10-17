import { Suspense } from "react";
import type { Metadata } from "next";
import { RunSkeleton, RunView } from "@/components/runva/RunView";

export const metadata: Metadata = {
  title: "RUNVA — Verification run",
};

export default function RunPage({ params }: PageProps<"/runs/[id]">) {
  return (
    <Suspense fallback={<RunSkeleton />}>
      {params.then(({ id }) => (
        <RunView key={id} runId={id} />
      ))}
    </Suspense>
  );
}
