"use client";

import { useEffect, useState } from "react";

/** Wall-clock "now", ticking every `intervalMs` while `active`. null until mounted (avoids SSR mismatch). */
export function useNow(active: boolean, intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [active, intervalMs]);
  return now;
}
