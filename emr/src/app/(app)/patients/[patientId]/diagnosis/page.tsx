import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { getTripVisit } from "@/server/services/visits";
import { loadPatient, loadPermissions } from "../data";
import { DiagnosisForm } from "../doctor-forms";

type Props = PageProps<"/patients/[patientId]/diagnosis">;

export default function DiagnosisPage({ params }: Props) {
  return (
    <Suspense>
      <Diagnosis params={params} />
    </Suspense>
  );
}

async function Diagnosis({ params }: Pick<Props, "params">) {
  const t = await getTranslations("Diagnosis");
  const sp = await getTranslations("Specialties");
  const format = await getFormatter();
  const { patientId } = await params;
  const p = await orSignIn(() => loadPatient(patientId));
  const [visit, permissions] = await orSignIn(() => Promise.all([getTripVisit(patientId), loadPermissions(p.tripId)]));
  if (!permissions.includes("visit.read")) notFound();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("title")}</h2>
        </CardTitle>
        {visit?.diagnosis && (
          <p className="text-sm text-muted-foreground">
            {visit.specialty && t("seenBy", { specialty: sp(visit.specialty) })} ·{" "}
            {t("lastUpdated", { time: format.dateTime(visit.updatedAt, { dateStyle: "medium", timeStyle: "short" }) })}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {permissions.includes("diagnosis.write") ? (
          <DiagnosisForm
            patientId={patientId}
            version={visit?.version ?? 1}
            defaults={{ chiefComplaint: visit?.chiefComplaint ?? null, diagnosis: visit?.diagnosis ?? null, treatment: visit?.treatment ?? null }}
          />
        ) : visit?.diagnosis ? (
          <dl className="grid gap-3 text-sm">
            {(["chiefComplaint", "diagnosis", "treatment"] as const).map((k) => (
              <div key={k}>
                <dt className="text-muted-foreground">{t(k)}</dt>
                <dd className="whitespace-pre-wrap">{visit[k] ?? "—"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        )}
      </CardContent>
    </Card>
  );
}
