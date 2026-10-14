import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { localDay } from "@/lib/shared/dates";
import { orSignIn } from "@/server/page";
import { myPermissions } from "@/server/services/users";
import { RegisterPatientForm } from "./register-form";

export default function NewPatientPage({ params }: PageProps<"/trips/[tripId]/patients/new">) {
  return (
    <Suspense>
      <NewPatient params={params} />
    </Suspense>
  );
}

async function NewPatient({ params }: Pick<PageProps<"/trips/[tripId]/patients/new">, "params">) {
  const t = await getTranslations("PatientForm");
  const { tripId } = await params;
  // The form is only for people who may register here; the service checks again on submit.
  const permissions = await orSignIn(() => myPermissions({ tripId }));
  if (!permissions.includes("patient.register")) notFound();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("registerTitle")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <RegisterPatientForm tripId={tripId} today={localDay()} />
      </CardContent>
    </Card>
  );
}
