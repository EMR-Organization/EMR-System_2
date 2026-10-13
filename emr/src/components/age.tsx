"use client";

import { useTranslations } from "next-intl";
import { displayAge } from "@/lib/shared/clinical";

/** "34 yrs" / "8 mos", from the date of birth when known, else the estimate. */
export function AgeText({
  patient,
  today,
}: {
  patient: { dateOfBirth: Date | string | null; ageValue: number | null; ageUnit: "YEARS" | "MONTHS" | null };
  today: string;
}) {
  const t = useTranslations("Age");
  const dob = patient.dateOfBirth ? new Date(patient.dateOfBirth) : null;
  const age = displayAge({ ...patient, dateOfBirth: dob }, new Date(today));
  if (!age) return <>{t("unknown")}</>;
  return <>{age.unit === "YEARS" ? t("years", { value: age.value }) : t("months", { value: age.value })}</>;
}
