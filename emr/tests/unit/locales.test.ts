import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import { pickLocale } from "@/i18n/locales";
import { optionLabel, type OptionGroup } from "@/lib/option-label";
import {
  COMMON_MEDICATIONS,
  GLUCOSE_TIMINGS,
  INSULIN_TYPES,
  MEDICATION_FREQUENCIES,
  MEDICATION_ROUTES,
  PHOTO_CATEGORIES,
  PREEXISTING_CONDITIONS,
  TRIP_VISIT_TYPE,
  VISIT_TYPES,
  WATER_CONTAMINATION_CONDITIONS,
  WATER_SOURCES,
} from "@/lib/shared/constants";

describe("pickLocale", () => {
  it("uses the device's choice first", () => {
    expect(pickLocale("es", "en-US,en;q=0.9")).toBe("es");
    expect(pickLocale("en", "es-GT,es;q=0.9")).toBe("en");
  });

  it("otherwise the browser's preferred language we have, by weight", () => {
    expect(pickLocale(undefined, "es-GT,es;q=0.9,en;q=0.8")).toBe("es");
    expect(pickLocale(undefined, "fr-FR,es;q=0.5,en;q=0.9")).toBe("en");
    expect(pickLocale(undefined, "fr-FR,es;q=0.5")).toBe("es");
  });

  it("falls back to English for anything unknown or bogus", () => {
    expect(pickLocale(undefined, null)).toBe("en");
    expect(pickLocale("xx", "de-DE")).toBe("en");
    expect(pickLocale("../../etc/passwd", "")).toBe("en");
    expect(pickLocale(undefined, "es;q=0")).toBe("en");
  });
});

// Every stored option value has a label in every language (so nothing shows
// half-translated), and the English label is the value itself.
const GROUPS: Record<OptionGroup, readonly string[]> = {
  conditions: PREEXISTING_CONDITIONS,
  waterConditions: WATER_CONTAMINATION_CONDITIONS,
  waterSources: WATER_SOURCES,
  medications: COMMON_MEDICATIONS,
  frequencies: MEDICATION_FREQUENCIES,
  routes: MEDICATION_ROUTES,
  glucoseTimings: GLUCOSE_TIMINGS,
  insulinTypes: INSULIN_TYPES,
  visitTypes: [...VISIT_TYPES, TRIP_VISIT_TYPE],
  photoCategories: PHOTO_CATEGORIES,
};

function translator(messages: { Options: Record<string, Record<string, string>> }) {
  const lookup = (key: string) => {
    const [group, ...rest] = key.split(".");
    return messages.Options[group]?.[rest.join(".")];
  };
  return Object.assign((key: string) => lookup(key)!, { has: (key: string) => lookup(key) !== undefined });
}

describe("option labels", () => {
  it("cover every stored value, in every language", () => {
    for (const [group, values] of Object.entries(GROUPS) as [OptionGroup, readonly string[]][]) {
      expect(Object.keys(en.Options[group]).sort(), group).toEqual([...values].sort());
      for (const value of values) {
        expect(optionLabel(translator(en), group, value)).toBe(value);
        expect(optionLabel(translator(es), group, value), `${group}: ${value}`).toBeTruthy();
      }
    }
  });

  it("are usable as message keys (next-intl splits keys on '.')", () => {
    for (const values of Object.values(GROUPS)) for (const value of values) expect(value).not.toMatch(/[.{}]/);
  });

  it("translate list values and leave hand-typed ones as typed", () => {
    expect(optionLabel(translator(es), "conditions", "Hypertension")).toBe("Hipertensión");
    expect(optionLabel(translator(es), "frequencies", "Three times daily")).toBe("Tres veces al día");
    expect(optionLabel(translator(es), "conditions", "Gout")).toBe("Gout");
    expect(optionLabel(translator(es), "routes", null)).toBe("");
  });
});
