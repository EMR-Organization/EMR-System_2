"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "@/i18n/locales";

/** Remembers this device's language. Not account data, so no sign-in needed. */
export async function setLocaleAction(locale: unknown): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "strict",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}
