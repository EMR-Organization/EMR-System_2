import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, pickLocale } from "./locales";

// All UI text lives in messages/<locale>.json; components never hold strings.
export default getRequestConfig(async () => {
  const locale = pickLocale((await cookies()).get(LOCALE_COOKIE)?.value, (await headers()).get("accept-language"));
  return {
    locale,
    // The hub's own clock and time zone; everyone using it is in the same place.
    timeZone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
