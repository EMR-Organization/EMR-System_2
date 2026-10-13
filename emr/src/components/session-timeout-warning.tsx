"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { touchSessionAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";

// The server ends a session after 30 minutes without requests. Someone typing a
// long note makes no requests, so warn them 5 minutes before and offer to stay.
// This is only a courtesy: the server enforces the timeout either way.
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const WARN_AT_MS = 25 * 60 * 1000;
const CHECK_EVERY_MS = 10_000;

export function SessionTimeoutWarning() {
  const t = useTranslations("Session");
  const router = useRouter();
  const pathname = usePathname();
  const lastActivity = useRef(0);
  const [warning, setWarning] = useState(false);
  const [pending, startTransition] = useTransition();

  // Navigating makes a request, which counts as activity on the server too.
  useEffect(() => {
    lastActivity.current = Date.now();
  }, [pathname]);

  useEffect(() => {
    const timer = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= IDLE_LIMIT_MS) router.push(`/login?next=${encodeURIComponent(pathname)}`);
      else setWarning(idle >= WARN_AT_MS);
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [pathname, router]);

  function stay() {
    startTransition(async () => {
      const result = await touchSessionAction();
      if (!result.ok) return router.push(`/login?next=${encodeURIComponent(pathname)}`);
      lastActivity.current = Date.now();
      setWarning(false);
    });
  }

  if (!warning) return null;
  return (
    <div role="alertdialog" aria-labelledby="session-warning-title" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-xl border bg-background p-4 shadow-lg">
      <p id="session-warning-title" className="font-medium">
        {t("expiringTitle")}
      </p>
      <p className="mb-3 text-sm text-muted-foreground">{t("expiringBody")}</p>
      <Button onClick={stay} disabled={pending}>
        {t("stay")}
      </Button>
    </div>
  );
}
