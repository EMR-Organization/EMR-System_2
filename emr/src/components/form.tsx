"use client";

import { useTranslations } from "next-intl";
import { startTransition, useActionState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** What a server action returns to a form (mirrors ActionResult on the server). */
export type FormState =
  | { ok: true; data?: unknown }
  | { ok: false; code: string; messageKey: string; fieldErrors?: Record<string, string[]> }
  | null;

/**
 * Like useActionState, but keeps what the user typed when the server says no.
 * (With <form action>, React clears every field after the action, so a wrong
 * password would also wipe the email.) Use the returned onSubmit on the form.
 */
export function useServerForm(action: (prev: FormState, form: FormData) => Promise<FormState>) {
  const [state, dispatch, pending] = useActionState<FormState, FormData>(action, null);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  };
  return [state, onSubmit, pending] as const;
}

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
export function Field({ name, label, hint, state, id: idProp, ...inputProps }: FieldProps) {
  const errorText = useErrorText();
  const errors = state && !state.ok ? (state.fieldErrors?.[name] ?? []) : [];
  // A custom id is needed when the same field appears more than once on a page.
  const id = idProp ?? `field-${name}`;
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

function useFieldErrors(name: string, state: FormState) {
  const errorText = useErrorText();
  const errors = state && !state.ok ? (state.fieldErrors?.[name] ?? []) : [];
  return { errors, errorText };
}

function FieldShell({ id, label, hint, errors, errorText, children }: {
  id: string;
  label: string;
  hint?: string;
  errors: string[];
  errorText: (key: string) => string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
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

const controlClass =
  "w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";

type SelectFieldProps = ComponentProps<"select"> & {
  name: string;
  label: string;
  hint?: string;
  state: FormState;
  options: readonly { value: string; label: string }[];
  /** Text for an empty first option, if the field may be left blank. */
  placeholder?: string;
};

export function SelectField({ name, label, hint, state, options, placeholder, id: idProp, ...props }: SelectFieldProps) {
  const { errors, errorText } = useFieldErrors(name, state);
  const id = idProp ?? `field-${name}`;
  return (
    <FieldShell id={id} label={label} hint={hint} errors={errors} errorText={errorText}>
      <select id={id} name={name} aria-invalid={errors.length > 0 || undefined} className={`${controlClass} h-8`} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

type TextareaFieldProps = ComponentProps<"textarea"> & { name: string; label: string; hint?: string; state: FormState };

export function TextareaField({ name, label, hint, state, id: idProp, ...props }: TextareaFieldProps) {
  const { errors, errorText } = useFieldErrors(name, state);
  const id = idProp ?? `field-${name}`;
  return (
    <FieldShell id={id} label={label} hint={hint} errors={errors} errorText={errorText}>
      <textarea id={id} name={name} rows={3} aria-invalid={errors.length > 0 || undefined} className={controlClass} {...props} />
    </FieldShell>
  );
}

/** Values as {value,label} options; label defaults to the value. */
export function asOptions(values: readonly string[], label: (v: string) => string = (v) => v) {
  return values.map((value) => ({ value, label: label(value) }));
}
