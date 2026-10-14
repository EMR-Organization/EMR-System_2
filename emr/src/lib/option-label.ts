// Fixed option lists (src/lib/shared/constants.ts) are stored in English so
// records, exports and sync never depend on who typed them. This shows a stored
// value in the reader's language; anything not in the list (a name typed under
// "Other") is shown exactly as typed.

export type OptionGroup =
  | "conditions"
  | "waterConditions"
  | "waterSources"
  | "medications"
  | "frequencies"
  | "routes"
  | "glucoseTimings"
  | "insulinTypes"
  | "visitTypes"
  | "photoCategories";

/** A translator for the "Options" messages: useTranslations("Options") or getTranslations("Options"). */
type OptionsTranslator = { (key: string): string; has(key: string): boolean };

export function optionLabel(t: OptionsTranslator, group: OptionGroup, value: string | null): string {
  if (value === null) return "";
  const key = `${group}.${value}`;
  return t.has(key) ? t(key) : value;
}
