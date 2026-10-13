import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AgeText } from "@/components/age";
import { NavLinks, type NavItem } from "@/components/app-nav-links";
import { Badge } from "@/components/ui/badge";
import { orSignIn } from "@/server/page";
import { loadPatient } from "./data";

type Props = LayoutProps<"/patients/[patientId]">;

export default function PatientLayout({ children, params }: Props) {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-6 md:py-8">
      <Suspense fallback={<div className="h-20" />}>
        <PatientHeader params={params} />
      </Suspense>
      {children}
    </div>
  );
}

async function PatientHeader({ params }: Pick<Props, "params">) {
  const t = await getTranslations("Patient");
  const g = await getTranslations("Gender");
  const sp = await getTranslations("Specialties");
  const r = await getTranslations("Risk");
  const { patientId } = await params;
  const p = await orSignIn(() => loadPatient(patientId));
  const base = `/patients/${p.id}`;
  const tabs: NavItem[] = [
    { href: base, label: t("overview") },
    { href: `${base}/vitals`, label: t("vitals") },
    { href: `${base}/diabetic`, label: t("diabetic") },
    { href: `${base}/conditions`, label: t("conditions") },
  ];

  return (
    <header className="grid gap-3">
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
          {g(p.gender)} · <AgeText patient={p} today={new Date().toISOString()} />
          <Badge variant="secondary">{sp(p.assignedSpecialty)}</Badge>
          {p.waterRiskRating === "HIGH" && <Badge variant="destructive">{r("HIGH")}</Badge>}
          {p.originLabel && <span>{t("originLabel", { label: p.originLabel })}</span>}
        </p>
      </div>
      <nav aria-label={t("details")} className="border-b pb-2">
        <NavLinks items={tabs} exactFirst className="overflow-x-auto" />
      </nav>
    </header>
  );
}
