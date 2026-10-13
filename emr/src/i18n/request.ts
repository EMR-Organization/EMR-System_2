import { getRequestConfig } from "next-intl/server";

// English only for now. All UI text lives in messages/<locale>.json so Spanish can be added later
// without touching components.
export const defaultLocale = "en";

export default getRequestConfig(async () => {
  const locale = defaultLocale;
  return {
    locale,
    // The hub's own clock and time zone; everyone using it is in the same place.
    timeZone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
