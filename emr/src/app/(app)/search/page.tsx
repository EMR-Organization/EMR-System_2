import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { AgeText } from "@/components/age";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { localDay } from "@/lib/shared/dates";
import { orSignIn } from "@/server/page";
import { searchPatients } from "@/server/services/search";
import { titled } from "@/app/page-title";

export const generateMetadata = titled("Search");

type Props = Pick<PageProps<"/search">, "searchParams">;

export default async function SearchPage({ searchParams }: Props) {
  const t = await getTranslations("Search");
  return (
    <div className="mx-auto grid w-full grid-cols-[minmax(0,1fr)] max-w-4xl gap-6 px-4 py-6 md:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <Suspense>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Results({ searchParams }: Props) {
  const t = await getTranslations("Search");
  const g = await getTranslations("Gender");
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) ?? "";
  // Each search is audited, so it only runs on a real query.
  const found = q.length >= 2 ? await orSignIn(() => searchPatients({ q })) : null;
  // "Today" (for ages) is per request: never let it be baked into a prerender.
  await connection();
  const today = localDay();

  return (
    <>
      <form className="flex flex-wrap items-end gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder={t("placeholder")} aria-label={t("label")} className="w-full sm:w-80" autoFocus />
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          {t("button")}
        </button>
      </form>

      {!found ? (
        <p className="text-sm text-muted-foreground">{q ? t("tooShort") : t("hint")}</p>
      ) : found.results.length === 0 ? (
        <p className="text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            {found.truncated ? t("truncated", { count: found.results.length }) : t("count", { count: found.results.length })}
          </p>
          <ul className="divide-y rounded-xl border">
            {found.results.map((p) => (
              <li key={p.id}>
                {/* No prefetch: opening a record is an audited view. */}
                <Link href={`/patients/${p.id}`} prefetch={false} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50">
                  <span className="grid">
                    <span className="font-medium">
                      {p.lastName}, {p.firstName}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {p.label} · {g(p.gender)} · <AgeText patient={p} today={today} />
                      {p.phone && ` · ${p.phone}`}
                    </span>
                  </span>
                  <Badge variant={p.trip.active ? "default" : "secondary"}>{p.trip.name}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
