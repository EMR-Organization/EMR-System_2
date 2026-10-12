"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Field, FormError, FormSuccess, type FormState } from "@/components/form";
import { Button } from "@/components/ui/button";
import { resetAction } from "./actions";

export function ResetForm() {
  const t = useTranslations("Reset");
  const f = useTranslations("Fields");
  const [state, action, pending] = useActionState<FormState, FormData>(resetAction, null);

  if (state?.ok) {
    return (
      <div className="grid gap-4">
        <FormSuccess>{t("done")}</FormSuccess>
        <Link className="text-sm text-primary underline-offset-4 hover:underline" href="/login">
          {t("back")}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <FormError state={state} />
      <Field name="email" label={f("email")} type="email" autoComplete="username" required state={state} />
      <Field name="code" label={f("code")} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} required state={state} />
      <Field name="newPassword" label={f("newPassword")} type="password" autoComplete="new-password" minLength={12} required state={state} />
      <Field name="confirmPassword" label={f("confirmPassword")} type="password" autoComplete="new-password" required state={state} />
      <Button type="submit" disabled={pending}>
        {t("submit")}
      </Button>
      <Link className="text-sm text-primary underline-offset-4 hover:underline" href="/login">
        {t("back")}
      </Link>
    </form>
  );
}
