import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { listConflicts, listSyncNodes } from "@/server/services/sync";
import { BundleForm } from "./bundle-form";

export default function SyncPage() {
  return (
    <main className="mx-auto grid w-full grid-cols-[minmax(0,1fr)] max-w-4xl gap-6 px-4 py-6 md:py-8">
      <Suspense>
        <Sync />
      </Suspense>
    </main>
  );
}

// Admins only: nothing renders until the service has checked (doctors resolve
// conflicts on /conflicts, but don't import bundles).
async function Sync() {
  const t = await getTranslations("Sync");
  const format = await getFormatter();
  const [conflicts, nodes] = await orSignIn(() => Promise.all([listConflicts(), listSyncNodes()]));
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
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
            <Link href="/conflicts" className="text-sm underline">
              {t("openQueue", { count: conflicts.length })}
            </Link>
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
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("howTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>
            {t("howProvision")} <code className="rounded bg-muted px-1 text-xs">emr-tool.bat provision-node</code> →{" "}
            <code className="rounded bg-muted px-1 text-xs">emr-tool.bat load-provision E:\provision.hfprov --first-number 5001</code>
          </p>
          <p>
            {t("howExport")} <code className="rounded bg-muted px-1 text-xs">emr-tool.bat export-bundle</code>
          </p>
          <p className="text-muted-foreground">{t("howNotes")}</p>
        </CardContent>
      </Card>
    </>
  );
}
