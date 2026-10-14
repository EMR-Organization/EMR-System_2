import { getFormatter, getTranslations } from "next-intl/server";
import { optionLabel } from "@/lib/option-label";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { localDay } from "@/lib/shared/dates";
import { orSignIn } from "@/server/page";
import { listConditions } from "@/server/services/conditions";
import { loadPatient, loadPermissions } from "../data";
import { ConditionForm } from "../entry-forms";

type Props = PageProps<"/patients/[patientId]/conditions">;

export default function ConditionsPage({ params }: Props) {
  return (
    <Suspense>
      <Conditions params={params} />
    </Suspense>
  );
}

async function Conditions({ params }: Pick<Props, "params">) {
  const t = await getTranslations("Conditions");
  const sev = await getTranslations("Severity");
  const o = await getTranslations("Options");
  const format = await getFormatter();
  const { patientId } = await params;
  const p = await orSignIn(() => loadPatient(patientId));
  const [entries, permissions] = await orSignIn(() => Promise.all([listConditions(patientId), loadPermissions(p.tripId)]));

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("condition")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y">
              {entries.map((c) => (
                <li key={c.id} className="grid gap-1 py-3 text-sm">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {optionLabel(o, "conditions", c.condition)}
                    {c.severity && <Badge variant={c.severity === "SEVERE" ? "destructive" : "secondary"}>{sev(c.severity)}</Badge>}
                  </span>
                  {c.diagnosisDate && (
                    <span className="text-muted-foreground">
                      {t("diagnosisDate")} {format.dateTime(c.diagnosisDate, { dateStyle: "medium", timeZone: "UTC" })}
                    </span>
                  )}
                  {c.notes && <span className="whitespace-pre-wrap">{c.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {permissions.includes("condition.write") && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("add")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ConditionForm patientId={patientId} today={localDay()} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
