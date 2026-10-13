// Small clinical helpers shared by the server and the forms.
// Ported from the old app (calculate_age, the BMI formula in the vitals form).

/** Whole years between a date of birth and today (calculate_age in app.py). */
export function ageInYears(dob: Date, today: Date): number {
  const years = today.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < dob.getUTCMonth() || (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate());
  return years - (beforeBirthday ? 1 : 0);
}

/** Whole months between a date of birth and today, for infants. */
export function ageInMonths(dob: Date, today: Date): number {
  const months = (today.getUTCFullYear() - dob.getUTCFullYear()) * 12 + (today.getUTCMonth() - dob.getUTCMonth());
  return months - (today.getUTCDate() < dob.getUTCDate() ? 1 : 0);
}

export type Age = { value: number; unit: "YEARS" | "MONTHS" };

/**
 * The age to show: from the date of birth when we have one (months under 2
 * years, as the old app did), otherwise the age recorded at registration.
 */
export function displayAge(
  p: { dateOfBirth: Date | null; ageValue: number | null; ageUnit: "YEARS" | "MONTHS" | null },
  today: Date,
): Age | null {
  if (p.dateOfBirth) {
    const years = ageInYears(p.dateOfBirth, today);
    return years < 2 ? { value: Math.max(0, ageInMonths(p.dateOfBirth, today)), unit: "MONTHS" } : { value: years, unit: "YEARS" };
  }
  return p.ageValue !== null && p.ageUnit ? { value: p.ageValue, unit: p.ageUnit } : null;
}

export const LB_PER_KG = 2.2046226218;

export function lbsToKg(lbs: number): number {
  return Math.round((lbs / LB_PER_KG) * 10) / 10;
}

/** BMI to one decimal, or null if either measurement is missing. */
export function bmi(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (!weightKg || !heightCm) return null;
  return Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
}
