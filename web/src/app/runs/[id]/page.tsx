import { Suspense } from "react";
import type { Metadata } from "next";
import { RunLoading, RunView } from "@/components/runva/run/run-view";

export const metadata: Metadata = {
  title: "RUNVA — Verification run",
};

export default function RunPage({ params }: PageProps<"/runs/[id]">) {
  return (
    <Suspense fallback={<RunLoading />}>
      {params.then(({ id }) => (
        <RunView key={id} runId={id} />
      ))}
    </Suspense>
  );
}
