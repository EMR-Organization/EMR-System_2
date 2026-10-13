"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { touchSessionAction } from "@/app/(app)/actions";
import { signOutAction } from "@/app/(app)/account/actions";
import { Button } from "@/components/ui/button";
import { idleMs, noteServerActivity, startActivityTracking } from "./activity";

// The server signs a session out after 30 minutes without requests. This warns
// 5 minutes before, counting real input on this device (not just page
// changes), and at 30 minutes signs out properly, so the session is gone on
// the server and the back button can't bring the record back.
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const WARN_AT_MS = 25 * 60 * 1000;
const CHECK_EVERY_MS = 10_000;

export function SessionTimeoutWarning() {
  const t = useTranslations("Session");
  const pathname = usePathname();
  const [warning, setWarning] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => startActivityTracking(), []);
  // Navigating made a request, so the server saw activity too.
  useEffect(() => noteServerActivity(), [pathname]);

  useEffect(() => {
    const timer = setInterval(() => {
      const idle = idleMs();
      if (idle >= IDLE_LIMIT_MS) {
        clearInterval(timer);
        void signOutAction();
      } else {
        setWarning(idle >= WARN_AT_MS);
      }
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  function stay() {
    // Clicking the button is itself input, which resets the idle clock.
    startTransition(async () => {
      const result = await touchSessionAction();
      if (!result.ok) return void signOutAction();
      noteServerActivity();
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
