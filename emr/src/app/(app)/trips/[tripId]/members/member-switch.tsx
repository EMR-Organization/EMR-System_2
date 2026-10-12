"use client";

import { useTranslations } from "next-intl";
import { useOptimistic, useTransition } from "react";
import { useActionFeedback } from "@/components/action-feedback";
import { Switch } from "@/components/ui/switch";
import { setStudentEnabledAction } from "./actions";

export function MemberSwitch({ tripId, userId, name, enabled }: { tripId: string; userId: string; name: string; enabled: boolean }) {
  const t = useTranslations("Members");
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(enabled);

  return (
    <label className="flex items-center gap-2 text-sm">
      <Switch
        checked={shown}
        disabled={pending}
        aria-label={t("toggleLabel", { name })}
        onCheckedChange={(next: boolean) =>
          startTransition(async () => {
            setShown(next);
            feedback(await setStudentEnabledAction(tripId, userId, next), t(next ? "switchedOn" : "switchedOff", { name }));
          })
        }
      />
      <span aria-hidden>{shown ? t("enabled") : t("disabled")}</span>
    </label>
  );
}
