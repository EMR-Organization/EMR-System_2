import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { NavLinks, type NavItem } from "@/components/app-nav-links";
import { Badge } from "@/components/ui/badge";
import { orSignIn } from "@/server/page";
import { getTrip } from "@/server/services/trips";
import { myPermissions } from "@/server/services/users";

export default function TripLayout({ children, params }: LayoutProps<"/trips/[tripId]">) {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-6 md:py-8">
      <Suspense fallback={<div className="h-16" />}>
        <TripHeader params={params} />
      </Suspense>
      {children}
    </div>
  );
}

async function TripHeader({ params }: Pick<LayoutProps<"/trips/[tripId]">, "params">) {
  const t = await getTranslations("Trip");
  const { tripId } = await params;
  // getTrip throws ForbiddenError for a student who isn't switched on for this trip.
  const [trip, permissions] = await orSignIn(() => Promise.all([getTrip(tripId), myPermissions({ tripId })]));

  const tabs: NavItem[] = [{ href: `/trips/${trip.id}`, label: t("overview") }];
  if (permissions.includes("trip.members.toggle")) tabs.push({ href: `/trips/${trip.id}/members`, label: t("members") });

  return (
    <header className="grid gap-3">
      <div>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
          {trip.name}
          <Badge variant={trip.active ? "default" : "secondary"}>{trip.active ? t("statusCurrent") : t("statusPast")}</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">
          {trip.location} · {t("code", { code: trip.code })}
        </p>
      </div>
      <nav aria-label={trip.name} className="border-b pb-2">
        <NavLinks items={tabs} exact className="overflow-x-auto" />
      </nav>
    </header>
  );
}
