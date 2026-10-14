import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AgeText } from "@/components/age";
import { NavLinks, type NavItem } from "@/components/app-nav-links";
import { Badge } from "@/components/ui/badge";
import { localDay } from "@/lib/shared/dates";
import { orSignIn } from "@/server/page";
import { loadPatient, loadPermissions } from "./data";

type Props = LayoutProps<"/patients/[patientId]">;

export default function PatientLayout({ children, params }: Props) {
  return (
    <div className="mx-auto grid w-full grid-cols-[minmax(0,1fr)] max-w-4xl gap-6 px-4 py-6 md:py-8">
      <Suspense fallback={<div className="h-20" />}>
        <PatientHeader params={params} />
      </Suspense>
      {children}
    </div>
  );
}

async function PatientHeader({ params }: Pick<Props, "params">) {
  const t = await getTranslations("Patient");
  const tt = await getTranslations("Trip");
  const g = await getTranslations("Gender");
  const sp = await getTranslations("Specialties");
  const r = await getTranslations("Risk");
  const { patientId } = await params;
  const p = await orSignIn(() => loadPatient(patientId));
  const permissions = await orSignIn(() => loadPermissions(p.tripId));
  const base = `/patients/${p.id}`;
  const canSeeVisits = permissions.includes("visit.read");
  const tabs: NavItem[] = [
    { href: base, label: t("overview") },
    ...(canSeeVisits ? [{ href: `${base}/diagnosis`, label: t("diagnosisTab") }] : []),
    { href: `${base}/medications`, label: t("medicationsTab") },
    { href: `${base}/vitals`, label: t("vitals") },
    { href: `${base}/diabetic`, label: t("diabetic") },
    { href: `${base}/conditions`, label: t("conditions") },
    ...(canSeeVisits ? [{ href: `${base}/visits`, label: t("visitsTab") }] : []),
    { href: `${base}/photos`, label: t("photosTab") },
  ];

  return (
    <header className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="grid gap-1">
        <Link href={`/trips/${p.tripId}/patients`} className="text-sm text-muted-foreground hover:underline">
          {p.tripName}
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
          {p.lastName}, {p.firstName}
          <Badge variant="outline" className="tabular-nums">
            {p.label}
          </Badge>
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {g(p.gender)} · <AgeText patient={p} today={localDay()} />
          <Badge variant="secondary">{sp(p.assignedSpecialty)}</Badge>
          {p.waterRiskRating === "HIGH" && <Badge variant="destructive">{r("HIGH")}</Badge>}
          {p.originLabel && <span>{t("originLabel", { label: p.originLabel })}</span>}
        </p>
      </div>
      {!p.tripActive && <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">{tt("closedNotice")}</p>}
      <nav aria-label={t("details")} className="border-b pb-2">
        <NavLinks items={tabs} exactFirst className="overflow-x-auto" />
      </nav>
    </header>
  );
}
