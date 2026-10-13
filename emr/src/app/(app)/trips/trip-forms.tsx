"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { useActionFeedback } from "@/components/action-feedback";
import { Field, FormError, useServerForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { createTripAction, setTripActiveAction } from "./actions";

export function CreateTripForm({ defaultYear, defaultMonth }: { defaultYear: number; defaultMonth: number }) {
  const t = useTranslations("Trips");
  const [state, onSubmit, pending] = useServerForm(createTripAction);
  const feedback = useActionFeedback();
  const form = useRef<HTMLFormElement>(null);
  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(defaultYear);

  useEffect(() => {
    if (state?.ok) {
      feedback(state, t("created"));
      form.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to a new result
  }, [state]);

  const code = `${String(month).padStart(2, "0")}_${year}`;
  return (
    <form ref={form} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <FormError state={state} />
      </div>
      <Field name="name" label={t("name")} placeholder={t("namePlaceholder")} required state={state} />
      <Field name="location" label={t("location")} required state={state} />
      <Field
        name="month"
        label={t("month")}
        type="number"
        min={1}
        max={12}
        value={month}
        onChange={(e) => setMonth(Number(e.target.value))}
        required
        state={state}
      />
      <Field
        name="year"
        label={t("year")}
        type="number"
        min={2000}
        max={2100}
        value={year}
        onChange={(e) => setYear(Number(e.target.value))}
        required
        hint={t("codeHint", { code })}
        state={state}
      />
      <Field name="suffix" label={t("suffix")} maxLength={8} state={state} />
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {t("create")}
        </Button>
      </div>
    </form>
  );
}

export function TripActiveButton({ tripId, active }: { tripId: string; active: boolean }) {
  const t = useTranslations("Trips");
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(async () => void feedback(await setTripActiveAction(tripId, !active)))}
    >
      {active ? t("markPast") : t("markCurrent")}
    </Button>
  );
}
