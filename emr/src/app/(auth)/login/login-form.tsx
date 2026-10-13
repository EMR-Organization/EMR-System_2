"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Field, FormError, useServerForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { signInAction } from "./actions";

export function LoginForm() {
  const t = useTranslations("Login");
  const f = useTranslations("Fields");
  const next = useSearchParams().get("next") ?? "/";
  const [state, onSubmit, pending] = useServerForm(signInAction);

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      <FormError state={state} />
      <Field name="email" label={f("email")} type="email" autoComplete="username" required state={state} />
      <Field name="password" label={f("password")} type="password" autoComplete="current-password" required state={state} />
      <Button type="submit" disabled={pending}>
        {t("submit")}
      </Button>
      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p>
          {t("noAccount")}{" "}
          <Link className="text-primary underline-offset-4 hover:underline" href="/register">
            {t("register")}
          </Link>
        </p>
        <p>
          {t("forgot")}{" "}
          <Link className="text-primary underline-offset-4 hover:underline" href="/reset">
            {t("reset")}
          </Link>
        </p>
      </div>
    </form>
  );
}
