"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { useActionFeedback } from "@/components/action-feedback";
import { Button } from "@/components/ui/button";
import { runBackupAction, runOffsiteAction } from "./actions";

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

/** Copies backups offsite now, for when the hub happens to have internet. */
export function OffsiteNowButton() {
  const t = useTranslations("Backups");
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await runOffsiteAction();
          if (!feedback(result) || !result.ok) return;
          if (result.data.problems > 0) toast.error(t("offsiteFailed"));
          else toast.success(t("offsiteDone", { count: result.data.copied }));
        })
      }
    >
      {pending ? t("offsiteRunning") : t("offsiteNow")}
    </Button>
  );
}
