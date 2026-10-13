"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useActionFeedback } from "@/components/action-feedback";
import { asOptions, Field, FormError, SelectField, TextareaField, useServerForm, type FormState } from "@/components/form";
import { Button } from "@/components/ui/button";
import { GLUCOSE_TIMINGS, INSULIN_TYPES, PREEXISTING_CONDITIONS } from "@/lib/shared/constants";
import { addConditionAction, addDiabeticAction, addVitalsAction } from "./actions";

/** Clears the form and shows a toast after a successful save. */
function useResetOnSuccess(state: FormState, message: string) {
  const form = useRef<HTMLFormElement>(null);
  const feedback = useActionFeedback();
  useEffect(() => {
    if (state?.ok) {
      feedback(state, message);
      form.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to a new result
  }, [state]);
  return form;
}

const numberProps = { type: "number", inputMode: "decimal", step: "any" } as const;

export function VitalsForm({ patientId }: { patientId: string }) {
  const t = useTranslations("Vitals");
  const [state, onSubmit, pending] = useServerForm(addVitalsAction.bind(null, patientId));
  const form = useResetOnSuccess(state, t("saved"));
  return (
    <form ref={form} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-3">
      <div className="sm:col-span-3">
        <FormError state={state} />
      </div>
      <Field name="bpSystolic" label={t("bpSystolic")} {...numberProps} min={60} max={250} state={state} />
      <Field name="bpDiastolic" label={t("bpDiastolic")} {...numberProps} min={40} max={150} state={state} />
      <Field name="heartRate" label={t("heartRate")} {...numberProps} min={30} max={220} state={state} />
      <Field name="temperatureC" label={t("temperatureC")} {...numberProps} min={30} max={43} state={state} />
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Field name="weight" label={t("weight")} {...numberProps} min={0.5} max={660} state={state} />
        <SelectField
          name="weightUnit"
          label={t("weightUnit")}
          options={[
            { value: "KG", label: t("kg") },
            { value: "LB", label: t("lb") },
          ]}
          state={state}
        />
      </div>
      <Field name="heightCm" label={t("heightCm")} {...numberProps} min={30} max={250} state={state} />
      <Field name="respiratoryRate" label={t("respiratoryRate")} {...numberProps} min={6} max={60} state={state} />
      <Field name="oxygenSaturation" label={t("oxygenSaturation")} {...numberProps} min={50} max={100} state={state} />
      <div className="sm:col-span-3">
        <TextareaField name="notes" label={t("notes")} rows={2} state={state} />
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {t("save")}
      </Button>
    </form>
  );
}

export function DiabeticForm({ patientId }: { patientId: string }) {
  const t = useTranslations("Diabetic");
  const [state, onSubmit, pending] = useServerForm(addDiabeticAction.bind(null, patientId));
  const form = useResetOnSuccess(state, t("saved"));
  return (
    <form ref={form} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-3">
      <div className="sm:col-span-3">
        <FormError state={state} />
      </div>
      <Field name="bloodGlucose" label={t("bloodGlucose")} {...numberProps} min={20} max={600} state={state} />
      <SelectField name="glucoseTiming" label={t("glucoseTiming")} placeholder="—" options={asOptions(GLUCOSE_TIMINGS)} state={state} />
      <SelectField name="insulinType" label={t("insulinType")} placeholder="—" options={asOptions(INSULIN_TYPES)} state={state} />
      <Field name="insulinDose" label={t("insulinDose")} {...numberProps} min={0} max={100} state={state} />
      <Field name="bpSystolic" label={t("bpSystolic")} {...numberProps} min={60} max={250} state={state} />
      <Field name="bpDiastolic" label={t("bpDiastolic")} {...numberProps} min={40} max={150} state={state} />
      <Field name="totalCholesterol" label={t("totalCholesterol")} {...numberProps} min={0} max={500} state={state} />
      <Field name="ldl" label={t("ldl")} {...numberProps} min={0} max={300} state={state} />
      <Field name="hdl" label={t("hdl")} {...numberProps} min={0} max={150} state={state} />
      <Field name="triglycerides" label={t("triglycerides")} {...numberProps} min={0} max={1000} state={state} />
      <Field name="hba1c" label={t("hba1c")} {...numberProps} min={0} max={20} state={state} />
      <div className="sm:col-span-3">
        <TextareaField name="notes" label={t("notes")} rows={2} state={state} />
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {t("save")}
      </Button>
    </form>
  );
}

export function ConditionForm({ patientId, today }: { patientId: string; today: string }) {
  const t = useTranslations("Conditions");
  const sev = useTranslations("Severity");
  const [state, onSubmit, pending] = useServerForm(addConditionAction.bind(null, patientId));
  const form = useResetOnSuccess(state, t("saved"));
  const [condition, setCondition] = useState("");
  return (
    <form ref={form} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-3">
      <div className="sm:col-span-3">
        <FormError state={state} />
      </div>
      <SelectField
        name="condition"
        label={t("condition")}
        required
        placeholder="—"
        value={condition}
        onChange={(e) => setCondition(e.target.value)}
        options={asOptions(PREEXISTING_CONDITIONS.filter((c) => c !== "None"))}
        state={state}
      />
      {condition === "Other" && <Field name="otherName" label={t("otherName")} required state={state} />}
      <Field name="diagnosisDate" label={t("diagnosisDate")} type="date" max={today} state={state} />
      <SelectField name="severity" label={t("severity")} placeholder="—" options={asOptions(["MILD", "MODERATE", "SEVERE"], (x) => sev(x))} state={state} />
      <div className="sm:col-span-3">
        <TextareaField name="notes" label={t("notes")} rows={2} state={state} />
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {t("save")}
      </Button>
    </form>
  );
}
