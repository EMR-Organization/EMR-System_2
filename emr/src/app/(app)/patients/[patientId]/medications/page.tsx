import { getFormatter, getTranslations } from "next-intl/server";
import { optionLabel } from "@/lib/option-label";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { localDay } from "@/lib/shared/dates";
import { orSignIn } from "@/server/page";
import { listMedications } from "@/server/services/medications";
import { loadPatient, loadPermissions } from "../data";
import { DiscontinueForm, PrescribeForm } from "../doctor-forms";
import { titled } from "@/app/page-title";

export const generateMetadata = titled("Patient", "medicationsTab");

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
  const o = await getTranslations("Options");
  const med = (name: string) => optionLabel(o, "medications", name);
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
                      {med(m.name)} · {m.dosage} · {optionLabel(o, "frequencies", m.frequency)}
                      {m.route ? ` · ${optionLabel(o, "routes", m.route)}` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {t("started", { date: day(m.startDate) })}
                      {m.prescribedFor ? ` · ${t("for", { reason: m.prescribedFor })}` : ""}
                    </span>
                    {m.instructions && <span className="whitespace-pre-wrap">{m.instructions}</span>}
                  </div>
                  {canWrite && <DiscontinueForm patientId={patientId} medicationId={m.id} version={m.version} name={med(m.name)} />}
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
            <PrescribeForm patientId={patientId} today={localDay()} />
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
                      {med(m.name)} · {m.dosage}
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
