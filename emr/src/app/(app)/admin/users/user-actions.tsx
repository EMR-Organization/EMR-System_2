"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useActionFeedback } from "@/components/action-feedback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  approveAction,
  disableAction,
  enableAction,
  issueResetCodeAction,
  rejectAction,
  revokeAllAction,
  unlockAction,
} from "./actions";

type Target = { id: string; name: string };
const SPECIALTIES = ["PHYSICIAN", "DENTIST", "PEDIATRICIAN"] as const;

export function PendingActions({ user, isDoctor }: { user: Target; isDoctor: boolean }) {
  const t = useTranslations("AdminUsers");
  const s = useTranslations("Specialties");
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  const [specialty, setSpecialty] = useState("");
  const selectId = `specialty-${user.id}`;

  return (
    <div className="flex flex-wrap items-end gap-2">
      {isDoctor && (
        <div className="grid gap-1">
          <label htmlFor={selectId} className="text-xs text-muted-foreground">
            {t("specialty")}
          </label>
          <select
            id={selectId}
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            className="h-8 rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">{t("chooseSpecialty")}</option>
            {SPECIALTIES.map((sp) => (
              <option key={sp} value={sp}>
                {s(sp)}
              </option>
            ))}
          </select>
        </div>
      )}
      <Button
        size="sm"
        disabled={pending}
        onClick={() => startTransition(async () => void feedback(await approveAction(user.id, specialty || null), t("approved", { name: user.name })))}
      >
        {t("approve")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => startTransition(async () => void feedback(await rejectAction(user.id), t("rejected", { name: user.name })))}
      >
        {t("reject")}
      </Button>
    </div>
  );
}

export function UserRowActions({
  user,
  status,
  locked,
  isSelf,
}: {
  user: Target;
  status: "PENDING" | "ACTIVE" | "DISABLED";
  locked: boolean;
  isSelf: boolean;
}) {
  const t = useTranslations("AdminUsers");
  const format = useFormatter();
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const act = (fn: () => Promise<Parameters<typeof feedback>[0]>, message: string) =>
    startTransition(async () => void feedback(await fn(), message));

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {status === "ACTIVE" && !isSelf && (
          <Button size="xs" variant="outline" disabled={pending} onClick={() => act(() => disableAction(user.id), t("disabledMsg", { name: user.name }))}>
            {t("disable")}
          </Button>
        )}
        {status === "DISABLED" && (
          <Button size="xs" variant="outline" disabled={pending} onClick={() => act(() => enableAction(user.id), t("enabledMsg", { name: user.name }))}>
            {t("enable")}
          </Button>
        )}
        {locked && (
          <Button size="xs" variant="outline" disabled={pending} onClick={() => act(() => unlockAction(user.id), t("unlocked", { name: user.name }))}>
            {t("unlock")}
          </Button>
        )}
        {status !== "PENDING" && (
          <Button
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await issueResetCodeAction(user.id);
                if (feedback(result) && result.ok) setIssued(result.data);
              })
            }
          >
            {t("resetCode")}
          </Button>
        )}
        {status === "ACTIVE" && !isSelf && (
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await revokeAllAction(user.id);
                if (result.ok) feedback(result, t("signedOutAll", { name: user.name, count: result.data.revoked }));
                else feedback(result);
              })
            }
          >
            {t("signOutAll")}
          </Button>
        )}
      </div>
      {issued && (
        <Alert>
          <AlertDescription className="grid gap-1">
            <span>{t("resetCodeIssued", { name: user.name, time: format.dateTime(new Date(issued.expiresAt), { timeStyle: "short" }) })}</span>
            <code className="text-xl font-semibold tracking-[0.3em]" data-testid="reset-code">
              {issued.code}
            </code>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
