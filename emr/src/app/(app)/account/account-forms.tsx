"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Field, FormError, FormSuccess, useServerForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { changePasswordAction, revokeSessionAction } from "./actions";

export function ChangePasswordForm() {
  const t = useTranslations("Account");
  const f = useTranslations("Fields");
  const [state, onSubmit, pending] = useServerForm(changePasswordAction);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} onSubmit={onSubmit} className="grid gap-4">
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
  const [state, onSubmit, pending] = useServerForm(revokeSessionAction);
  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <FormError state={state} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("revoke")}
      </Button>
    </form>
  );
}
