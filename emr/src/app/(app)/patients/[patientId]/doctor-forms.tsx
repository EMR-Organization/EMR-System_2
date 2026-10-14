"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useActionFeedback } from "@/components/action-feedback";
import { asOptions, Field, FormError, SelectField, TextareaField, useServerForm, type FormState } from "@/components/form";
import { Button } from "@/components/ui/button";
import { COMMON_MEDICATIONS, MEDICATION_FREQUENCIES, MEDICATION_ROUTES, PHOTO_CATEGORIES, VISIT_TYPES } from "@/lib/shared/constants";
import { addVisitAction, discontinueAction, prescribeAction, recordDiagnosisAction } from "./actions";

/** Toast on success, optionally clearing the form. */
function useSuccess(state: FormState, message: string, reset = true) {
  const form = useRef<HTMLFormElement>(null);
  const feedback = useActionFeedback();
  useEffect(() => {
    if (state?.ok) {
      feedback(state, message);
      if (reset) form.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to a new result
  }, [state]);
  return form;
}

export function DiagnosisForm({
  patientId,
  version,
  defaults,
}: {
  patientId: string;
  version: number;
  defaults: { chiefComplaint: string | null; diagnosis: string | null; treatment: string | null };
}) {
  const t = useTranslations("Diagnosis");
  // Opened at this version; if someone else saves first, the save is refused with a reload message.
  const [state, onSubmit, pending] = useServerForm(recordDiagnosisAction.bind(null, patientId, version));
  const form = useSuccess(state, t("saved"), false);
  return (
    <form ref={form} onSubmit={onSubmit} className="grid gap-4">
      <FormError state={state} />
      <Field name="chiefComplaint" label={t("chiefComplaint")} defaultValue={defaults.chiefComplaint ?? ""} state={state} />
      <TextareaField name="diagnosis" label={t("diagnosis")} defaultValue={defaults.diagnosis ?? ""} required rows={4} state={state} />
      <TextareaField name="treatment" label={t("treatment")} defaultValue={defaults.treatment ?? ""} rows={4} state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        {t("save")}
      </Button>
    </form>
  );
}

export function PrescribeForm({ patientId, today }: { patientId: string; today: string }) {
  const t = useTranslations("Medications");
  const [state, onSubmit, pending] = useServerForm(prescribeAction.bind(null, patientId));
  const form = useSuccess(state, t("saved"));
  const [name, setName] = useState("");
  return (
    <form ref={form} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <FormError state={state} />
      </div>
      <SelectField
        name="name"
        label={t("name")}
        required
        placeholder="—"
        value={name}
        onChange={(e) => setName(e.target.value)}
        options={asOptions(COMMON_MEDICATIONS)}
        state={state}
      />
      {name === "Other" && <Field name="otherName" label={t("otherName")} required state={state} />}
      <Field name="dosage" label={t("dosage")} placeholder={t("dosagePlaceholder")} required state={state} />
      <SelectField name="frequency" label={t("frequency")} required placeholder="—" options={asOptions(MEDICATION_FREQUENCIES)} state={state} />
      <SelectField name="route" label={t("route")} placeholder="—" options={asOptions(MEDICATION_ROUTES)} state={state} />
      <Field name="startDate" label={t("startDate")} type="date" defaultValue={today} state={state} />
      <Field name="prescribedFor" label={t("prescribedFor")} state={state} />
      <div className="sm:col-span-2">
        <TextareaField name="instructions" label={t("instructions")} rows={2} state={state} />
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {t("save")}
      </Button>
    </form>
  );
}

export function DiscontinueForm({ patientId, medicationId, version, name }: { patientId: string; medicationId: string; version: number; name: string }) {
  const t = useTranslations("Medications");
  const c = useTranslations("Common");
  const feedback = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>(null);
  const [pending, startTransition] = useTransition();

  // Called directly rather than through useServerForm: on success the medication
  // moves to the Discontinued list and this form disappears, so the toast has
  // to be raised before that re-render.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await discontinueAction(patientId, medicationId, version, null, data);
      setState(result);
      feedback(result, t("discontinuedMsg"));
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} aria-label={`${t("discontinue")}: ${name}`}>
        {t("discontinue")}
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="grid w-full gap-2">
      <FormError state={state} />
      <Field name="reason" id={`reason-${medicationId}`} label={t("discontinueReason")} hint={t("discontinueReasonHint")} required state={state} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="destructive" disabled={pending}>
          {t("confirmDiscontinue")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {c("cancel")}
        </Button>
      </div>
    </form>
  );
}

export function VisitForm({ patientId, today }: { patientId: string; today: string }) {
  const t = useTranslations("Visits");
  const [state, onSubmit, pending] = useServerForm(addVisitAction.bind(null, patientId));
  const form = useSuccess(state, t("saved"));
  return (
    <form ref={form} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <FormError state={state} />
      </div>
      <SelectField name="visitType" label={t("visitType")} required placeholder="—" options={asOptions(VISIT_TYPES)} state={state} />
      <Field name="date" label={t("date")} type="date" max={today} defaultValue={today} state={state} />
      <Field name="chiefComplaint" label={t("chiefComplaint")} state={state} />
      <Field name="followUpDate" label={t("followUpDate")} type="date" min={today} state={state} />
      <div className="sm:col-span-2">
        <TextareaField name="symptoms" label={t("symptoms")} rows={2} state={state} />
      </div>
      <div className="sm:col-span-2">
        <TextareaField name="diagnosis" label={t("diagnosis")} rows={2} state={state} />
      </div>
      <div className="sm:col-span-2">
        <TextareaField name="treatment" label={t("treatment")} rows={2} state={state} />
      </div>
      <div className="sm:col-span-2">
        <TextareaField name="notes" label={t("notes")} rows={2} state={state} />
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {t("save")}
      </Button>
    </form>
  );
}

/** Uploads to the photo route handler (not a server action, see the route for why). */
export function PhotoUploadForm({ patientId, today }: { patientId: string; today: string }) {
  const t = useTranslations("Photos");
  const router = useRouter();
  const feedback = useActionFeedback();
  const [state, setState] = useState<FormState>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const data = new FormData(formEl);
    startTransition(async () => {
      let result: FormState;
      try {
        const response = await fetch(`/api/patients/${patientId}/photos`, { method: "POST", body: data });
        result = (await response.json()) as FormState;
      } catch {
        result = { ok: false, code: "INTERNAL", messageKey: "internal" };
      }
      setState(result);
      if (feedback(result, t("saved"))) {
        formEl.reset();
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <FormError state={state} />
      </div>
      <div className="sm:col-span-2">
        <Field name="photo" label={t("file")} type="file" accept="image/jpeg,image/png,image/webp" required hint={t("fileHint")} state={state} />
      </div>
      <SelectField
        name="kind"
        label={t("kind")}
        defaultValue="MEDICAL"
        options={[
          { value: "MEDICAL", label: t("medical") },
          { value: "PROFILE", label: t("profile") },
        ]}
        state={state}
      />
      <SelectField name="category" label={t("category")} placeholder="—" options={asOptions(PHOTO_CATEGORIES)} state={state} />
      <Field name="description" label={t("description")} state={state} />
      <Field name="takenOn" label={t("takenOn")} type="date" max={today} defaultValue={today} state={state} />
      <div className="sm:col-span-2">
        <TextareaField name="notes" label={t("notes")} rows={2} state={state} />
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? t("uploading") : t("save")}
      </Button>
    </form>
  );
}
