import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { roleHas } from "@/lib/shared/permissions";
import { orSignIn } from "@/server/page";
import { listTrips } from "@/server/services/trips";
import { me } from "@/server/services/users";
import { CreateTripForm, TripActiveButton } from "./trip-forms";

export default async function TripsPage() {
  const t = await getTranslations("Trips");
  const c = await getTranslations("Common");
  return (
    <main className="mx-auto grid w-full grid-cols-[minmax(0,1fr)] max-w-4xl gap-6 px-4 py-6 md:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense fallback={<p className="text-muted-foreground">{c("loading")}</p>}>
        <TripList />
      </Suspense>
    </main>
  );
}

async function TripList() {
  const t = await getTranslations("Trips");
  const [user, trips] = await orSignIn(() => Promise.all([me(), listTrips()]));
  const isAdmin = roleHas(user.role, "trip.create");
  const now = new Date();

  return (
    <>
      {trips.length === 0 ? (
        <p className="text-muted-foreground">{user.role === "STUDENT" ? t("emptyStudent") : t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <Link href={`/trips/${trip.id}`} className="hover:underline">
                      {trip.name}
                    </Link>
                    <Badge variant={trip.active ? "default" : "secondary"}>{trip.active ? t("current") : t("past")}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {trip.location} · {trip.code} · {t("patients", { count: trip.patientCount })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Link href={`/trips/${trip.id}`} className={buttonVariants({ size: "sm" })}>
                    {t("open")}
                  </Link>
                  {isAdmin && <TripActiveButton tripId={trip.id} active={trip.active} />}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("createTitle")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CreateTripForm defaultYear={now.getFullYear()} defaultMonth={now.getMonth() + 1} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
