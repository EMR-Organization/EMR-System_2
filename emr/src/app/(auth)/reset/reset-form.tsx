"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Field, FormError, FormSuccess, useServerForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { resetAction } from "./actions";

export function ResetForm() {
  const t = useTranslations("Reset");
  const f = useTranslations("Fields");
  const [state, onSubmit, pending] = useServerForm(resetAction);

  if (state?.ok) {
    return (
      <div className="grid gap-4">
        <FormSuccess>{t("done")}</FormSuccess>
        <Link className="text-sm text-primary underline underline-offset-4 pointer-coarse:inline-block pointer-coarse:py-2.5" href="/login">
          {t("back")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError state={state} />
      <Field name="email" label={f("email")} type="email" autoComplete="username" required state={state} />
      <Field name="code" label={f("code")} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} required state={state} />
      <Field name="newPassword" label={f("newPassword")} type="password" autoComplete="new-password" minLength={12} required state={state} />
      <Field name="confirmPassword" label={f("confirmPassword")} type="password" autoComplete="new-password" required state={state} />
      <Button type="submit" disabled={pending}>
        {t("submit")}
      </Button>
      <Link className="text-sm text-primary underline underline-offset-4 pointer-coarse:inline-block pointer-coarse:py-2.5" href="/login">
        {t("back")}
      </Link>
    </form>
  );
}
