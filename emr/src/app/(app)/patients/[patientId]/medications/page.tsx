import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { listMedications } from "@/server/services/medications";
import { loadPatient, loadPermissions } from "../data";
import { DiscontinueForm, PrescribeForm } from "../doctor-forms";

type Props = PageProps<"/patients/[patientId]/medications">;

export default function MedicationsPage({ params }: Props) {
  return (
    <Suspense>
      <Medications params={params} />
    </Suspense>
  );
}

async function Medications({ params }: Pick<Props, "params">) {
  const t = await getTranslations("Medications");
  const format = await getFormatter();
  const { patientId } = await params;
  const p = await orSignIn(() => loadPatient(patientId));
  const [meds, permissions] = await orSignIn(() => Promise.all([listMedications(patientId), loadPermissions(p.tripId)]));
  const canWrite = permissions.includes("medication.write");
  const day = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" }) : "—");
  const active = meds.filter((m) => m.status === "ACTIVE");
  const stopped = meds.filter((m) => m.status !== "ACTIVE");

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("active")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          ) : (
            <ul className="divide-y">
              {active.map((m) => (
                <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <div className="grid gap-0.5">
                    <span className="font-medium">
                      {m.name} · {m.dosage} · {m.frequency}
                      {m.route ? ` · ${m.route}` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {t("started", { date: day(m.startDate) })}
                      {m.prescribedFor ? ` · ${t("for", { reason: m.prescribedFor })}` : ""}
                    </span>
                    {m.instructions && <span className="whitespace-pre-wrap">{m.instructions}</span>}
                  </div>
                  {canWrite && <DiscontinueForm patientId={patientId} medicationId={m.id} version={m.version} name={m.name} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("prescribe")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PrescribeForm patientId={patientId} today={new Date().toISOString().slice(0, 10)} />
          </CardContent>
        </Card>
      )}

      {stopped.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("discontinued")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {stopped.map((m) => (
                <li key={m.id} className="grid gap-0.5 py-3 text-sm text-muted-foreground">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="line-through">
                      {m.name} · {m.dosage}
                    </span>
                    <Badge variant="secondary">{t("ended", { date: day(m.endDate) })}</Badge>
                  </span>
                  {m.discontinueReason && <span>{t("reasonShown", { reason: m.discontinueReason })}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
