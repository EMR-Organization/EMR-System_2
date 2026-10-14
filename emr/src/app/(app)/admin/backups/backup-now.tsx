"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { useActionFeedback } from "@/components/action-feedback";
import { Button } from "@/components/ui/button";
import { runBackupAction } from "./actions";

export function BackupNowButton() {
  const t = useTranslations("Backups");
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  return (
    <Button disabled={pending} onClick={() => startTransition(async () => void feedback(await runBackupAction(), t("done")))}>
      {pending ? t("running") : t("now")}
    </Button>
  );
}
