// The languages the EMR speaks. Each device picks one (a cookie set by the
// switcher); a device that hasn't picked gets its browser's language if we have
// it, else English. Stored values (conditions, medications…) stay in English
// and are only translated for display, so records and exports don't change.

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Each language's name in itself, for the switcher. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", es: "Español" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The cookie if it's valid, else the first supported language in Accept-Language, else English. */
export function pickLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookie)) return cookie;
  const wanted = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { lang: tag.trim().toLowerCase().split("-")[0], q: q ? Number(q.trim().slice(2)) || 0 : 1 };
    })
    .filter((w) => w.lang && w.q > 0)
    .sort((a, b) => b.q - a.q);
  return wanted.map((w) => w.lang).find(isLocale) ?? DEFAULT_LOCALE;
}
