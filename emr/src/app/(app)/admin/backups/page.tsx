import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { listBackups } from "@/server/services/backups";
import { BackupNowButton } from "./backup-now";

export default async function BackupsPage() {
  const t = await getTranslations("Backups");
  const c = await getTranslations("Common");
  return (
    <main className="mx-auto grid w-full grid-cols-[minmax(0,1fr)] max-w-4xl gap-6 px-4 py-6 md:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("intro")}</p>
        </div>
        <BackupNowButton />
      </div>
      <Suspense fallback={<p className="text-muted-foreground">{c("loading")}</p>}>
        <BackupList />
      </Suspense>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("keepSafeTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>{t("keepSafeUsb")}</p>
          <p>{t("keepSafeKeys")}</p>
          <p>
            {t("restoreHow")} <code className="rounded bg-muted px-1 text-xs">emr-tool.bat restore &lt;file.hfbak&gt;</code>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

async function BackupList() {
  const t = await getTranslations("Backups");
  const format = await getFormatter();
  const backups = await orSignIn(() => listBackups());
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("listTitle")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {backups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="divide-y">
            {backups.map((b, i) => (
              <li key={b.name} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="grid">
                  <span className="font-medium">
                    {format.dateTime(new Date(b.createdAt), { dateStyle: "medium", timeStyle: "short" })} {i === 0 && <Badge>{t("latest")}</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("details", { patients: b.counts.patients, photos: b.counts.photos, size: (b.sizeBytes / 1024 / 1024).toFixed(1) })}
                    {b.checkpoint && ` · ${t("checkpoint", { id: b.checkpoint.id })}`}
                  </span>
                </span>
                {/* A plain link: it's a file download, not a page. */}
                <a href={`/api/backups/${b.name}`} className="underline" download>
                  {t("download")}
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
