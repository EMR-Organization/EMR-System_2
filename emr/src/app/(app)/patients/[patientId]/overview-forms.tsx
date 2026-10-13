"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useActionFeedback } from "@/components/action-feedback";
import { Field, FormError, useServerForm, type FormState } from "@/components/form";
import { PatientFields, type PatientDefaults } from "@/components/patients/patient-fields";
import { Button } from "@/components/ui/button";
import { deletePatientAction, updatePatientAction } from "./actions";

export function EditPatient({ patientId, version, defaults, today }: { patientId: string; version: number; defaults: PatientDefaults; today: string }) {
  const t = useTranslations("PatientForm");
  // The version the form was opened with. If someone else saves first, the
  // server refuses and the error explains to reload.
  const [state, onSubmit, pending] = useServerForm(updatePatientAction.bind(null, patientId, version));
  const feedback = useActionFeedback();
  // Open since which result? A newer successful save closes the form.
  const [openedAt, setOpenedAt] = useState<FormState | undefined>(undefined);
  const open = openedAt !== undefined && !(state?.ok && state !== openedAt);
  const setOpen = (on: boolean) => setOpenedAt(on ? state : undefined);

  useEffect(() => {
    if (state?.ok) feedback(state, t("saved"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to a new result
  }, [state]);

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} className="justify-self-start">
        {t("edit")}
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-8">
      <FormError state={state} />
      <PatientFields state={state} defaults={defaults} today={today} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

export function DeletePatient({ patientId, label }: { patientId: string; label: string }) {
  const t = useTranslations("Patient");
  const [state, onSubmit, pending] = useServerForm(deletePatientAction.bind(null, patientId));
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <p className="text-sm text-muted-foreground">{t("deleteHint", { label })}</p>
      <FormError state={state} />
      <Field name="confirmLabel" label={t("deleteConfirm")} autoComplete="off" spellCheck={false} required state={state} />
      <Button type="submit" variant="destructive" disabled={pending} className="justify-self-start">
        {t("delete")}
      </Button>
    </form>
  );
}
