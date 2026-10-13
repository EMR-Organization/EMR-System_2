"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-fetches the page's server data every few seconds while the tab is visible,
 * so lists show patients other people just registered. Used on lists only:
 * refreshing would never disturb a form, but there's no need on record pages.
 */
export function AutoRefresh({ everyMs = 10_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
