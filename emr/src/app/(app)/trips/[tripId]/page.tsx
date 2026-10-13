import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { tripStats } from "@/server/services/dashboard";
import { myPermissions } from "@/server/services/users";

// Trip dashboard (get_trip_stats in the old app).
export default function TripPage({ params }: PageProps<"/trips/[tripId]">) {
  return (
    <Suspense>
      <Overview params={params} />
    </Suspense>
  );
}

async function Overview({ params }: Pick<PageProps<"/trips/[tripId]">, "params">) {
  const t = await getTranslations("Trip");
  const p = await getTranslations("Patients");
  const sp = await getTranslations("Specialties");
  const { tripId } = await params;
  const [stats, permissions] = await orSignIn(() => Promise.all([tripStats(tripId), myPermissions({ tripId })]));

  return (
    <div className="grid gap-4">
      <AutoRefresh />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={t("statPatients")} value={stats.total} />
        <Stat label={t("statToday")} value={stats.registeredToday} />
        <Stat label={t("statSeen")} value={Object.values(stats.bySpecialty).reduce((n, s) => n + s.seen, 0)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/trips/${tripId}/patients`} className={buttonVariants({ variant: "secondary" })}>
          {t("patientsTab")}
        </Link>
        {permissions.includes("patient.register") && (
          <Link href={`/trips/${tripId}/patients/new`} className={buttonVariants()}>
            {p("register")}
          </Link>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("bySpecialty")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {(["PHYSICIAN", "DENTIST", "PEDIATRICIAN"] as const).map((s) => (
                <li key={s} className="flex justify-between gap-2">
                  <span>{sp(s)}</span>
                  <span className="text-muted-foreground">
                    {t("statSeen")} {stats.bySpecialty[s].seen} · {t("statWaiting")}{" "}
                    {stats.bySpecialty[s].waiting}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("waterRisk")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              <li className="flex justify-between">
                <span>{t("riskHigh")}</span>
                <span>{stats.waterRisk.HIGH}</span>
              </li>
              <li className="flex justify-between">
                <span>{t("riskMedium")}</span>
                <span>{stats.waterRisk.MEDIUM}</span>
              </li>
              <li className="flex justify-between">
                <span>{t("riskLow")}</span>
                <span>{stats.waterRisk.LOW}</span>
              </li>
              <li className="flex justify-between text-muted-foreground">
                <span>{t("riskUnknown")}</span>
                <span>{stats.waterRisk.unknown}</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
      </CardHeader>
    </Card>
  );
}
