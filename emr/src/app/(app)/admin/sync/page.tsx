import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { FormSuccessBanner } from "@/components/form-success-banner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { listConflicts, listSyncNodes } from "@/server/services/sync";
import { BundleForm } from "./bundle-form";

export default async function SyncPage({ searchParams }: Pick<PageProps<"/admin/sync">, "searchParams">) {
  const t = await getTranslations("Sync");
  const c = await getTranslations("Common");
  return (
    <main className="mx-auto grid w-full grid-cols-[minmax(0,1fr)] max-w-4xl gap-6 px-4 py-6 md:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <Suspense>
        <Resolved searchParams={searchParams} />
      </Suspense>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("importTitle")}</h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t("importIntro")}</p>
        </CardHeader>
        <CardContent>
          <BundleForm />
        </CardContent>
      </Card>
      <Suspense fallback={<p className="text-muted-foreground">{c("loading")}</p>}>
        <Queue />
      </Suspense>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("howTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>
            {t("howProvision")} <code className="rounded bg-muted px-1 text-xs">npm run provision-node</code> →{" "}
            <code className="rounded bg-muted px-1 text-xs">npm run load-provision -- provision.hfprov</code>
          </p>
          <p>
            {t("howExport")} <code className="rounded bg-muted px-1 text-xs">npm run export-bundle</code>
          </p>
          <p className="text-muted-foreground">{t("howNotes")}</p>
        </CardContent>
      </Card>
    </main>
  );
}

async function Resolved({ searchParams }: Pick<PageProps<"/admin/sync">, "searchParams">) {
  const t = await getTranslations("Sync");
  return (await searchParams).resolved === "1" ? <FormSuccessBanner>{t("resolved")}</FormSuccessBanner> : null;
}

async function Queue() {
  const t = await getTranslations("Sync");
  const format = await getFormatter();
  const [conflicts, nodes] = await orSignIn(() => Promise.all([listConflicts(), listSyncNodes()]));
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>
              {t("queueTitle")} {conflicts.length > 0 && <Badge variant="destructive">{conflicts.length}</Badge>}
            </h2>
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
                  <Link href={`/admin/sync/conflicts/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50">
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
      {nodes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("nodesTitle")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {nodes.map((n) => (
                <li key={n.nodeId}>
                  <span className="font-mono">{n.nodeId}</span>{" "}
                  <span className="text-muted-foreground">
                    {t("nodeLine", { imports: n.imports, time: n.lastImportAt ? format.dateTime(n.lastImportAt, { dateStyle: "medium", timeStyle: "short" }) : "—" })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
