import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { getTrip } from "@/server/services/trips";

// Trip home. Phase 4 adds the patient list and dashboard stats here.
export default function TripPage({ params }: PageProps<"/trips/[tripId]">) {
  return (
    <Suspense>
      <Overview params={params} />
    </Suspense>
  );
}

async function Overview({ params }: Pick<PageProps<"/trips/[tripId]">, "params">) {
  const t = await getTranslations("Trip");
  const { tripId } = await params;
  const trip = await orSignIn(() => getTrip(tripId));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardDescription>{t("statPatients")}</CardDescription>
          <CardTitle className="text-3xl">{trip.patientCount}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("patients")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t("patientsSoon")}</CardContent>
      </Card>
    </div>
  );
}
