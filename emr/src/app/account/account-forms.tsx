"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Field, FormError, FormSuccess, type FormState } from "@/components/form";
import { Button } from "@/components/ui/button";
import { changePasswordAction, revokeSessionAction } from "./actions";

export function ChangePasswordForm() {
  const t = useTranslations("Account");
  const f = useTranslations("Fields");
  const [state, action, pending] = useActionState<FormState, FormData>(changePasswordAction, null);
  return (
    <form action={action} className="grid gap-4">
      {state?.ok && <FormSuccess>{t("passwordChanged")}</FormSuccess>}
      <FormError state={state} />
      <Field name="currentPassword" label={f("currentPassword")} type="password" autoComplete="current-password" required state={state} />
      <Field name="newPassword" label={f("newPassword")} type="password" autoComplete="new-password" minLength={12} required state={state} />
      <Field name="confirmPassword" label={f("confirmPassword")} type="password" autoComplete="new-password" required state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        {t("changePasswordSubmit")}
      </Button>
    </form>
  );
}

export function RevokeSessionButton({ sessionId }: { sessionId: string }) {
  const t = useTranslations("Account");
  const [state, action, pending] = useActionState<FormState, FormData>(revokeSessionAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <FormError state={state} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("revoke")}
      </Button>
    </form>
  );
}
