"use client";

import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** What a server action returns to a form (mirrors ActionResult on the server). */
export type FormState =
  | { ok: true; data?: unknown }
  | { ok: false; code: string; messageKey: string; fieldErrors?: Record<string, string[]> }
  | null;

/** Turns a message key from the server into text; unknown keys get a generic message. */
export function useErrorText() {
  const t = useTranslations("Errors");
  return (key: string) => (t.has(key) ? t(key) : t("invalid"));
}

export function FormError({ state }: { state: FormState }) {
  const errorText = useErrorText();
  if (!state || state.ok) return null;
  // Field-level problems are shown next to the fields; this is for the rest.
  const hasFieldErrors = Object.keys(state.fieldErrors ?? {}).some((k) => k !== "form");
  if (hasFieldErrors && state.messageKey === "validation") return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{errorText(state.messageKey)}</AlertDescription>
    </Alert>
  );
}

export function FormSuccess({ children }: { children: ReactNode }) {
  return (
    <Alert role="status">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

type FieldProps = ComponentProps<typeof Input> & {
  name: string;
  label: string;
  hint?: string;
  state: FormState;
};

/** A labelled input that shows the server's errors for its name. */
export function Field({ name, label, hint, state, ...inputProps }: FieldProps) {
  const errorText = useErrorText();
  const errors = state && !state.ok ? (state.fieldErrors?.[name] ?? []) : [];
  const id = `field-${name}`;
  const describedBy = [hint ? `${id}-hint` : null, errors.length ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} aria-invalid={errors.length > 0 || undefined} aria-describedby={describedBy} {...inputProps} />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {errors.length > 0 && (
        <ul id={`${id}-error`} className="text-xs text-destructive">
          {errors.map((e) => (
            <li key={e}>{errorText(e)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
