"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isActive } from "./activity";

/**
 * Re-fetches the page's server data every few seconds so lists show patients
 * other people just registered. Only while the tab is visible AND someone has
 * used the device in the last 2 minutes: each refresh is a request, and
 * requests keep the session alive, so an unattended screen must go quiet and
 * let the 30-minute idle sign-out happen.
 */
export function AutoRefresh({ everyMs = 10_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && isActive()) router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
