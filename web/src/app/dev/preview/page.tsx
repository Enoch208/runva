// DEV-ONLY preview of run components with clearly-labelled SAMPLE data. Delete before shipping.
import { notFound } from "next/navigation";
import { PreviewClient } from "./PreviewClient";

export default function DevPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PreviewClient />;
}
