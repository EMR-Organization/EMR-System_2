"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { asOptions, Field, SelectField, TextareaField, type FormState } from "@/components/form";
import { WATER_CONTAMINATION_CONDITIONS, WATER_SOURCES } from "@/lib/shared/constants";

export type PatientDefaults = {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  ageValue?: number | null;
  ageUnit?: "YEARS" | "MONTHS" | null;
  gender?: string;
  assignedSpecialty?: string;
  phone?: string | null;
  address?: string | null;
  emergencyContact?: string | null;
  waterSource?: string | null;
  waterRiskRating?: string | null;
  waterHistory?: string[];
  waterNotes?: string | null;
};

/** Demographics and water-risk fields, shared by registration and editing. */
export function PatientFields({ state, defaults = {}, today }: { state: FormState; defaults?: PatientDefaults; today: string }) {
  const t = useTranslations("PatientForm");
  const g = useTranslations("Gender");
  const sp = useTranslations("Specialties");
  const r = useTranslations("Risk");
  const [dob, setDob] = useState(defaults.dateOfBirth ?? "");
  const v = (x: string | null | undefined) => x ?? "";

  return (
    <>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-medium">{t("personal")}</legend>
        <Field name="firstName" label={t("firstName")} defaultValue={v(defaults.firstName)} required autoComplete="off" state={state} />
        <Field name="lastName" label={t("lastName")} defaultValue={v(defaults.lastName)} required autoComplete="off" state={state} />
        <Field
          name="dateOfBirth"
          label={t("dob")}
          type="date"
          max={today}
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          hint={t("dobHint")}
          state={state}
        />
        {/* The age estimate is only for patients who don't know their date of birth. */}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field
            name="ageValue"
            label={t("ageValue")}
            type="number"
            min={0}
            max={130}
            inputMode="numeric"
            disabled={!!dob}
            defaultValue={defaults.ageValue ?? ""}
            state={state}
          />
          <SelectField
            name="ageUnit"
            label={t("ageUnit")}
            disabled={!!dob}
            defaultValue={defaults.ageUnit ?? "YEARS"}
            options={[
              { value: "YEARS", label: t("years") },
              { value: "MONTHS", label: t("months") },
            ]}
            state={state}
          />
        </div>
        <SelectField
          name="gender"
          label={t("gender")}
          required
          defaultValue={v(defaults.gender)}
          placeholder={t("choose")}
          options={asOptions(["FEMALE", "MALE", "OTHER"], (x) => g(x))}
          state={state}
        />
        <SelectField
          name="assignedSpecialty"
          label={t("assignedSpecialty")}
          required
          defaultValue={v(defaults.assignedSpecialty)}
          placeholder={t("choose")}
          options={asOptions(["PHYSICIAN", "DENTIST", "PEDIATRICIAN"], (x) => sp(x))}
          state={state}
        />
        <Field name="phone" label={t("phone")} type="tel" defaultValue={v(defaults.phone)} state={state} />
        <Field name="emergencyContact" label={t("emergencyContact")} defaultValue={v(defaults.emergencyContact)} state={state} />
        <div className="sm:col-span-2">
          <TextareaField name="address" label={t("address")} defaultValue={v(defaults.address)} rows={2} state={state} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-medium">{t("water")}</legend>
        <SelectField
          name="waterSource"
          label={t("waterSource")}
          defaultValue={v(defaults.waterSource)}
          placeholder={t("choose")}
          options={asOptions(WATER_SOURCES)}
          state={state}
        />
        <SelectField
          name="waterRiskRating"
          label={t("waterRisk")}
          defaultValue={v(defaults.waterRiskRating)}
          placeholder={t("choose")}
          options={asOptions(["LOW", "MEDIUM", "HIGH"], (x) => r(x))}
          state={state}
        />
        <div className="grid gap-2 sm:col-span-2">
          <span className="text-sm font-medium">{t("waterHistory")}</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            {WATER_CONTAMINATION_CONDITIONS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="waterHistory" value={c} defaultChecked={defaults.waterHistory?.includes(c)} />
                {c}
              </label>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <TextareaField name="waterNotes" label={t("waterNotes")} defaultValue={v(defaults.waterNotes)} rows={2} state={state} />
        </div>
      </fieldset>
    </>
  );
}
