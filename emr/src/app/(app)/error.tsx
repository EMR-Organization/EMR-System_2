"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

// Unexpected errors. The details stay in the server log; the browser only
// gets a digest, never a stack trace.
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("ErrorPage");
  return (
    <div className="mx-auto grid max-w-md gap-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      <Button onClick={reset} className="justify-self-center">
        {t("retry")}
      </Button>
    </div>
  );
}
