import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { orSignIn } from "@/server/page";
import { listAudit, listAuditUsers } from "@/server/services/audit";
import { listBackups } from "@/server/services/backups";
import { VerifyForm } from "./verify-form";

type Props = Pick<PageProps<"/admin/audit">, "searchParams">;

const FILTERS = ["userId", "patient", "action", "from", "to"] as const;

export default async function AuditPage({ searchParams }: Props) {
  const t = await getTranslations("Audit");
  const c = await getTranslations("Common");
  return (
    <main className="mx-auto grid w-full grid-cols-[minmax(0,1fr)] max-w-5xl gap-6 px-4 py-6 md:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">{c("loading")}</p>}>
        <Verify />
      </Suspense>
      <Suspense fallback={<p className="text-muted-foreground">{c("loading")}</p>}>
        <Log searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Verify() {
  const t = await getTranslations("Audit");
  const format = await getFormatter();
  const backups = await orSignIn(() => listBackups());
  const checkpoints = backups.flatMap((b) =>
    b.checkpoint
      ? [{ id: b.checkpoint.id, hash: b.checkpoint.hash, label: t("backupCheckpoint", { time: format.dateTime(new Date(b.createdAt), { dateStyle: "medium", timeStyle: "short" }), id: b.checkpoint.id }) }]
      : [],
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("verifyTitle")}</h2>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("verifyIntro")}</p>
      </CardHeader>
      <CardContent>
        <VerifyForm checkpoints={checkpoints} />
      </CardContent>
    </Card>
  );
}

async function Log({ searchParams }: Props) {
  const t = await getTranslations("Audit");
  const format = await getFormatter();
  const query = await searchParams;
  const one = (k: string) => {
    const v = query[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const filter = Object.fromEntries([...FILTERS, "before"].map((k) => [k, one(k)])) as Record<(typeof FILTERS)[number] | "before", string>;
  const [{ rows, nextBefore, patientNotFound }, users] = await orSignIn(() => Promise.all([listAudit(filter), listAuditUsers()]));
  const nextHref = nextBefore
    ? `?${new URLSearchParams(Object.entries({ ...filter, before: nextBefore }).filter(([, v]) => v))}`
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("logTitle")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form className="grid gap-3 sm:grid-cols-3" aria-label={t("filters")}>
          <label className="grid gap-1 text-sm">
            {t("user")}
            <select name="userId" defaultValue={filter.userId} className="h-8 rounded-lg border bg-background px-2 text-sm">
              <option value="">{t("anyone")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            {t("patient")}
            <Input name="patient" defaultValue={filter.patient} placeholder="012_05_2026" />
          </label>
          <label className="grid gap-1 text-sm">
            {t("action")}
            <Input name="action" defaultValue={filter.action} placeholder="patient.view" />
          </label>
          <label className="grid gap-1 text-sm">
            {t("from")}
            <Input name="from" type="date" defaultValue={filter.from} />
          </label>
          <label className="grid gap-1 text-sm">
            {t("to")}
            <Input name="to" type="date" defaultValue={filter.to} />
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className={buttonVariants({ variant: "secondary" })}>
              {t("apply")}
            </button>
            <Link href="/admin/audit" className={buttonVariants({ variant: "ghost" })}>
              {t("clear")}
            </Link>
          </div>
        </form>

        {patientNotFound ? (
          <p className="text-sm text-muted-foreground">{t("patientNotFound")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ol className="divide-y rounded-xl border text-sm">
            {rows.map((r) => {
              const patientId = r.entity === "Patient" ? r.entityId : (r.details as Record<string, unknown> | null)?.patientId;
              return (
                <li key={r.id} className="grid gap-1 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={r.action.includes("fail") || r.action.includes("denied") ? "destructive" : "secondary"} className="font-mono">
                      {r.action}
                    </Badge>
                    <span className="text-muted-foreground tabular-nums">
                      {format.dateTime(r.ts, { dateStyle: "medium", timeStyle: "medium" })}
                    </span>
                    <span className="text-xs text-muted-foreground">#{r.id}</span>
                  </div>
                  <div className="break-words">
                    {r.user ? `${r.user.name} (${r.user.email})` : t("noUser")}
                    {r.ip && <span className="text-muted-foreground"> · {r.ip}</span>}
                  </div>
                  <div className="break-all text-xs text-muted-foreground">
                    {r.entity}
                    {r.entityId && ` ${r.entityId}`}
                    {typeof patientId === "string" && (
                      <>
                        {" · "}
                        <Link href={`/patients/${patientId}`} prefetch={false} className="underline">
                          {t("openPatient")}
                        </Link>
                      </>
                    )}
                  </div>
                  {r.details != null && (
                    <pre className="overflow-x-auto rounded bg-muted px-2 py-1 text-xs whitespace-pre-wrap break-all">{JSON.stringify(r.details)}</pre>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {nextHref && (
          <Link href={nextHref} className={buttonVariants({ variant: "outline" })}>
            {t("older")}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
