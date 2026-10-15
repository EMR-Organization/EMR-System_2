"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { asOptions, Field, FormError, useServerForm } from "@/components/form";
import { optionLabel } from "@/lib/option-label";
import { PatientFields } from "@/components/patients/patient-fields";
import { Button } from "@/components/ui/button";
import { PREEXISTING_CONDITIONS } from "@/lib/shared/constants";
import { registerPatientAction } from "./actions";

const CONDITIONS = PREEXISTING_CONDITIONS.filter((c) => c !== "None");

export function RegisterPatientForm({ tripId, today }: { tripId: string; today: string }) {
  const t = useTranslations("PatientForm");
  const sev = useTranslations("Severity");
  const o = useTranslations("Options");
  const [state, onSubmit, pending] = useServerForm(registerPatientAction.bind(null, tripId));
  const [ticked, setTicked] = useState<string[]>([]);
  const toggle = (c: string, on: boolean) => setTicked((list) => (on ? [...list, c] : list.filter((x) => x !== c)));

  return (
    <form onSubmit={onSubmit} className="grid gap-8">
      <FormError state={state} />
      <PatientFields state={state} today={today} />

      <fieldset className="grid gap-3">
        <legend className="mb-1 font-medium">{t("conditions")}</legend>
        <p className="text-xs text-muted-foreground">{t("conditionsHint")}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {CONDITIONS.map((c) => (
            <li key={c} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="conditions" value={c} onChange={(e) => toggle(c, e.target.checked)} />
                {optionLabel(o, "conditions", c)}
              </label>
              {ticked.includes(c) && (
                <select name={`severity:${c}`} aria-label={`${t("severity")}: ${optionLabel(o, "conditions", c)}`} defaultValue="" className="h-7 pointer-coarse:h-10 rounded-md border bg-background px-1.5 text-xs pointer-coarse:text-sm">
                  <option value="">{t("severity")}</option>
                  {asOptions(["MILD", "MODERATE", "SEVERE"], (x) => sev(x)).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </li>
          ))}
        </ul>
        {ticked.includes("Other") && <Field name="otherCondition" label={t("otherCondition")} required state={state} />}
      </fieldset>

      <Button type="submit" size="lg" disabled={pending} className="justify-self-start">
        {t("submit")}
      </Button>
    </form>
  );
}
