"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Field, FormError, useErrorText, useServerForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { registerAction } from "./actions";

export function RegisterForm() {
  const t = useTranslations("Register");
  const f = useTranslations("Fields");
  const errorText = useErrorText();
  const [state, onSubmit, pending] = useServerForm(registerAction);
  const roleErrors = state && !state.ok ? (state.fieldErrors?.role ?? []) : [];

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormError state={state} />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{f("role")}</legend>
        <div className="flex gap-4">
          {(["DOCTOR", "STUDENT"] as const).map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <input type="radio" name="role" value={role} required defaultChecked={role === "STUDENT"} />
              {t(role === "DOCTOR" ? "doctor" : "student")}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("doctorHint")}</p>
        {roleErrors.map((e) => (
          <p key={e} className="text-xs text-destructive">
            {errorText(e)}
          </p>
        ))}
      </fieldset>
      <Field name="name" label={f("name")} autoComplete="name" required state={state} />
      <Field name="email" label={f("email")} type="email" autoComplete="email" required state={state} />
      <Field
        name="password"
        label={f("password")}
        type="password"
        autoComplete="new-password"
        minLength={12}
        maxLength={128}
        required
        hint={t("passwordHint")}
        state={state}
      />
      <Button type="submit" disabled={pending}>
        {t("submit")}
      </Button>
      <p className="text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link className="text-primary underline-offset-4 hover:underline" href="/login">
          {t("signIn")}
        </Link>
      </p>
    </form>
  );
}
