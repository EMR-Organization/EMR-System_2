import { getFormatter, getTranslations } from "next-intl/server";
import { optionLabel } from "@/lib/option-label";
import { Suspense } from "react";
import { FormSuccessBanner } from "@/components/form-success-banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { localDay } from "@/lib/shared/dates";
import { orSignIn } from "@/server/page";
import { loadPatient, loadPermissions } from "./data";
import { DeletePatient, EditPatient } from "./overview-forms";
import { titled } from "@/app/page-title";

export const generateMetadata = titled("Patient", "overview");

type Props = PageProps<"/patients/[patientId]">;

export default function PatientOverviewPage({ params, searchParams }: Props) {
  return (
    <Suspense>
      <Overview params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Overview({ params, searchParams }: Props) {
  const t = await getTranslations("Patient");
  const f = await getTranslations("PatientForm");
  const r = await getTranslations("Risk");
  const o = await getTranslations("Options");
  const format = await getFormatter();
  const { patientId } = await params;
  const { registered } = await searchParams;
  const p = await orSignIn(() => loadPatient(patientId));
  const permissions = await orSignIn(() => loadPermissions(p.tripId));
  const today = localDay();
  const dash = t("none");

  const rows: [string, string][] = [
    [f("dob"), p.dateOfBirth ? format.dateTime(p.dateOfBirth, { dateStyle: "medium", timeZone: "UTC" }) : dash],
    [f("phone"), p.phone ?? dash],
    [f("emergencyContact"), p.emergencyContact ?? dash],
    [f("address"), p.address ?? dash],
    [f("waterSource"), p.waterSource ? optionLabel(o, "waterSources", p.waterSource) : dash],
    [f("waterRisk"), p.waterRiskRating ? r(p.waterRiskRating) : dash],
    [f("waterHistory"), p.waterHistory.length ? p.waterHistory.map((w) => optionLabel(o, "waterConditions", w)).join(", ") : dash],
    [f("waterNotes"), p.waterNotes ?? dash],
  ];

  return (
    <div className="grid gap-4">
      {/* Only this patient's own number: the URL can't put arbitrary text in the banner. */}
      {registered === p.label && <FormSuccessBanner>{f("registered", { label: p.label })}</FormSuccessBanner>}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("details")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="grid gap-0.5">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
            <div className="grid gap-0.5">
              <dt className="text-muted-foreground">{t("trip")}</dt>
              <dd>{t("registered", { time: format.dateTime(p.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}</dd>
            </div>
          </dl>
          {permissions.includes("patient.register") && (
            <EditPatient
              patientId={p.id}
              version={p.version}
              today={today}
              defaults={{ ...p, dateOfBirth: p.dateOfBirth?.toISOString().slice(0, 10) }}
            />
          )}
        </CardContent>
      </Card>

      {permissions.includes("patient.delete") && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("delete")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DeletePatient patientId={p.id} label={p.label} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
