import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { getConflict } from "@/server/services/sync";
import { ResolveForm } from "./resolve-form";

type Props = PageProps<"/admin/sync/conflicts/[conflictId]">;

export default function ConflictPage({ params }: Props) {
  return (
    <main className="mx-auto grid w-full grid-cols-[minmax(0,1fr)] max-w-3xl gap-6 px-4 py-6 md:py-8">
      <Suspense>
        <Conflict params={params} />
      </Suspense>
    </main>
  );
}

async function Conflict({ params }: Pick<Props, "params">) {
  const t = await getTranslations("Sync");
  const format = await getFormatter();
  const { conflictId } = await params;
  const c = await orSignIn(() => getConflict(conflictId));
  return (
    <>
      <div className="grid gap-1">
        <Link href="/admin/sync" className="text-sm underline">
          {t("back")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t("conflictTitle", { entity: t(`entity.${c.entity}`) })}</h1>
        {c.patient && (
          <p className="text-sm">
            <Link href={`/patients/${c.patient.id}`} prefetch={false} className="underline">
              {c.patient.name} · {c.patient.label}
            </Link>
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {t("conflictIntro", { node: c.sourceNodeId, time: format.dateTime(c.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("chooseTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {c.status !== "OPEN" ? (
            <p className="text-sm text-muted-foreground">{t("alreadyResolved")}</p>
          ) : (
            <div className="grid gap-3">
              {/* Someone already made the hub match: closing it keeps the hub's copy. */}
              {c.fields.length === 0 && <p className="text-sm text-muted-foreground">{t("nowSame")}</p>}
              <ResolveForm conflictId={c.id} hubVersion={c.hubVersion} node={c.sourceNodeId} fields={c.fields} />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
