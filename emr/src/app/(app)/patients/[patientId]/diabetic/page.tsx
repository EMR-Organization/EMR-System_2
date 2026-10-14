import { getFormatter, getTranslations } from "next-intl/server";
import { optionLabel } from "@/lib/option-label";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { listDiabeticEntries } from "@/server/services/diabetic";
import { loadPatient, loadPermissions } from "../data";
import { DiabeticForm } from "../entry-forms";

type Props = PageProps<"/patients/[patientId]/diabetic">;

export default function DiabeticPage({ params }: Props) {
  return (
    <Suspense>
      <Diabetic params={params} />
    </Suspense>
  );
}

async function Diabetic({ params }: Pick<Props, "params">) {
  const t = await getTranslations("Diabetic");
  const o = await getTranslations("Options");
  const format = await getFormatter();
  const { patientId } = await params;
  const p = await orSignIn(() => loadPatient(patientId));
  const [entries, permissions] = await orSignIn(() => Promise.all([listDiabeticEntries(patientId), loadPermissions(p.tripId)]));
  const n = (v: number | null) => (v === null ? "—" : format.number(v));

  return (
    <div className="grid gap-4">
      {permissions.includes("diabetic.write") && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("add")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DiabeticForm patientId={patientId} />
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
              {entries.map((d) => (
                <li key={d.id} className="grid gap-1 py-3 text-sm">
                  <span className="font-medium">{format.dateTime(d.takenAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                  <span className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground tabular-nums">
                    <span>
                      {t("bloodGlucose")} {n(d.bloodGlucose)}
                      {d.glucoseTiming ? ` (${optionLabel(o, "glucoseTimings", d.glucoseTiming)})` : ""}
                    </span>
                    <span>
                      {t("insulinType")} {d.insulinType ? optionLabel(o, "insulinTypes", d.insulinType) : "—"} {d.insulinDose !== null ? `· ${n(d.insulinDose)}` : ""}
                    </span>
                    <span>
                      {t("bp")} {d.bpSystolic !== null ? `${d.bpSystolic}/${d.bpDiastolic}` : "—"}
                    </span>
                    <span>
                      {t("totalCholesterol")} {n(d.totalCholesterol)}
                    </span>
                    <span>
                      {t("ldl")} {n(d.ldl)} · {t("hdl")} {n(d.hdl)}
                    </span>
                    <span>
                      {t("triglycerides")} {n(d.triglycerides)}
                    </span>
                    <span>
                      {t("hba1c")} {n(d.hba1c)}
                    </span>
                  </span>
                  {d.notes && <span className="whitespace-pre-wrap">{d.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
