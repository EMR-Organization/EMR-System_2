"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useTransition } from "react";
import { setLocaleAction } from "@/app/locale-actions";
import { LANGUAGE_NAMES, LOCALES } from "@/i18n/locales";
import { cn } from "@/lib/utils";

/** "English · Español": each name in its own language, so anyone can find theirs. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const current = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div role="group" aria-label="Language / Idioma" className={cn("flex items-center gap-1 text-xs", className)}>
      {LOCALES.map((locale, i) => (
        <span key={locale} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden className="text-muted-foreground">·</span>}
          <button
            type="button"
            lang={locale}
            aria-pressed={current === locale}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await setLocaleAction(locale);
                router.refresh();
              })
            }
            className={cn(
              "rounded px-1.5 py-1 underline-offset-2 hover:underline disabled:opacity-60",
              current === locale ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {LANGUAGE_NAMES[locale]}
          </button>
        </span>
      ))}
    </div>
  );
}
