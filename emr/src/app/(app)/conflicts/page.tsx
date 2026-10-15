import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { FormSuccessBanner } from "@/components/form-success-banner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { listConflicts } from "@/server/services/sync";
import { titled } from "@/app/page-title";

export const generateMetadata = titled("Sync", "queueTitle");

// Records edited both on the hub and on a fallback laptop while it was in use.
// Doctors and admins pick, field by field, which version to keep (past trips:
// admins only). Importing the laptop's bundle is on the admin Sync page.
export default function ConflictsPage({ searchParams }: Pick<PageProps<"/conflicts">, "searchParams">) {
  return (
    <div className="mx-auto grid w-full grid-cols-[minmax(0,1fr)] max-w-4xl gap-6 px-4 py-6 md:py-8">
      <Suspense>
        <Resolved searchParams={searchParams} />
      </Suspense>
      <Suspense>
        <Queue />
      </Suspense>
    </div>
  );
}

async function Resolved({ searchParams }: Pick<PageProps<"/conflicts">, "searchParams">) {
  const t = await getTranslations("Sync");
  return (await searchParams).resolved === "1" ? <FormSuccessBanner>{t("resolved")}</FormSuccessBanner> : null;
}

async function Queue() {
  const t = await getTranslations("Sync");
  const format = await getFormatter();
  const conflicts = await orSignIn(() => listConflicts());
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("queueTitle")} {conflicts.length > 0 && <Badge variant="destructive">{conflicts.length}</Badge>}
          </h1>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("queueIntro")}</p>
      </CardHeader>
      <CardContent>
        {conflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("queueEmpty")}</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {conflicts.map((c) => (
              <li key={c.id}>
                <Link href={`/conflicts/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50">
                  <span className="grid">
                    <span className="font-medium">
                      {c.patient ? `${c.patient.name} · ${c.patient.label}` : c.entity} <Badge variant="secondary">{t(`entity.${c.entity}`)}</Badge>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("conflictLine", { node: c.sourceNodeId, fields: c.fields.map((f) => t(`fields.${f}`)).join(", ") })}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{format.dateTime(c.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
