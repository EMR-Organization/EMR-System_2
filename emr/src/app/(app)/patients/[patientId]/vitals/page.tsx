import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { listVitals } from "@/server/services/vitals";
import { loadPatient, loadPermissions } from "../data";
import { VitalsForm } from "../entry-forms";
import { titled } from "@/app/page-title";

export const generateMetadata = titled("Patient", "vitals");

type Props = PageProps<"/patients/[patientId]/vitals">;

export default function VitalsPage({ params }: Props) {
  return (
    <Suspense>
      <Vitals params={params} />
    </Suspense>
  );
}

async function Vitals({ params }: Pick<Props, "params">) {
  const t = await getTranslations("Vitals");
  const format = await getFormatter();
  const { patientId } = await params;
  const p = await orSignIn(() => loadPatient(patientId));
  const [entries, permissions] = await orSignIn(() => Promise.all([listVitals(patientId), loadPermissions(p.tripId)]));
  const n = (v: number | null, unit = "") => (v === null ? "—" : `${format.number(v)}${unit}`);

  return (
    <div className="grid gap-4">
      {permissions.includes("vitals.write") && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("add")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <VitalsForm patientId={patientId} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("history")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y">
              {entries.map((v) => (
                <li key={v.id} className="grid gap-1 py-3 text-sm">
                  <span className="font-medium">{format.dateTime(v.takenAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground tabular-nums">
                    <span>
                      {t("bp")} {v.bpSystolic !== null ? `${v.bpSystolic}/${v.bpDiastolic}` : "—"}
                    </span>
                    <span>
                      {t("heartRate")} {n(v.heartRate)}
                    </span>
                    <span>
                      {t("temperatureC")} {n(v.temperatureC)}
                    </span>
                    <span>
                      {t("weight")} {n(v.weightKg, " kg")}
                    </span>
                    <span>
                      {t("heightCm")} {n(v.heightCm)}
                    </span>
                    <span>
                      {t("bmi")} {n(v.bmi)}
                    </span>
                    <span>
                      {t("respiratoryRate")} {n(v.respiratoryRate)}
                    </span>
                    <span>
                      {t("oxygenSaturation")} {n(v.oxygenSaturation)}
                    </span>
                  </span>
                  {v.notes && <span className="whitespace-pre-wrap">{v.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
