import { getFormatter, getTranslations } from "next-intl/server";
import { optionLabel } from "@/lib/option-label";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { localDay } from "@/lib/shared/dates";
import { orSignIn } from "@/server/page";
import { listVisits } from "@/server/services/visits";
import { loadPatient, loadPermissions } from "../data";
import { VisitForm } from "../doctor-forms";

type Props = PageProps<"/patients/[patientId]/visits">;

export default function VisitsPage({ params }: Props) {
  return (
    <Suspense>
      <Visits params={params} />
    </Suspense>
  );
}

async function Visits({ params }: Pick<Props, "params">) {
  const t = await getTranslations("Visits");
  const d = await getTranslations("Diagnosis");
  const sp = await getTranslations("Specialties");
  const o = await getTranslations("Options");
  const format = await getFormatter();
  const { patientId } = await params;
  const p = await orSignIn(() => loadPatient(patientId));
  const permissions = await orSignIn(() => loadPermissions(p.tripId));
  if (!permissions.includes("visit.read")) notFound();
  const visits = await orSignIn(() => listVisits(patientId));
  const day = (v: Date) => format.dateTime(v, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visits.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          ) : (
            <ul className="divide-y">
              {visits.map((v) => (
                <li key={v.id} className="grid gap-1 py-3 text-sm">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {day(v.date)} · {optionLabel(o, "visitTypes", v.visitType)}
                    {v.tripVisit && <Badge>{t("tripVisit")}</Badge>}
                    {v.specialty && <Badge variant="secondary">{sp(v.specialty)}</Badge>}
                  </span>
                  {v.chiefComplaint && (
                    <span>
                      <span className="text-muted-foreground">{d("chiefComplaint")}: </span>
                      {v.chiefComplaint}
                    </span>
                  )}
                  {v.symptoms && <span className="whitespace-pre-wrap">{v.symptoms}</span>}
                  {v.diagnosis && (
                    <span className="whitespace-pre-wrap">
                      <span className="text-muted-foreground">{d("diagnosis")}: </span>
                      {v.diagnosis}
                    </span>
                  )}
                  {v.treatment && (
                    <span className="whitespace-pre-wrap">
                      <span className="text-muted-foreground">{d("treatment")}: </span>
                      {v.treatment}
                    </span>
                  )}
                  {v.medications.length > 0 && (
                    <span className="text-muted-foreground">
                      {t("prescribed", { list: v.medications.map((m) => `${optionLabel(o, "medications", m.name)} ${m.dosage ?? ""}`.trim()).join(", ") })}
                    </span>
                  )}
                  {v.followUpDate && <span>{t("followUp", { date: day(v.followUpDate) })}</span>}
                  {v.notes && <span className="whitespace-pre-wrap text-muted-foreground">{v.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {permissions.includes("visit.write") && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("add")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <VisitForm patientId={patientId} today={localDay()} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
