import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AgeText } from "@/components/age";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orSignIn } from "@/server/page";
import { listPatients } from "@/server/services/patients";
import { myPermissions } from "@/server/services/users";

type Props = PageProps<"/trips/[tripId]/patients">;

export default function PatientsPage({ params, searchParams }: Props) {
  return (
    <Suspense>
      <PatientList params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

async function PatientList({ params, searchParams }: Props) {
  const t = await getTranslations("Patients");
  const sp = await getTranslations("Specialties");
  const g = await getTranslations("Gender");
  const r = await getTranslations("Risk");
  const { tripId } = await params;
  const query = await searchParams;
  const filter = { q: one(query.q), risk: one(query.risk), specialty: one(query.specialty), page: one(query.page) ?? 1 };

  const [result, permissions] = await orSignIn(() => Promise.all([listPatients({ tripId, ...filter }), myPermissions({ tripId })]));
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const today = new Date().toISOString();
  const pageHref = (page: number) =>
    `?${new URLSearchParams(Object.entries({ ...filter, page: String(page) }).filter((e): e is [string, string] => !!e[1]))}`;

  return (
    <div className="grid gap-4">
      {/* Only while not searching, so results don't shift under someone reading them. */}
      {!filter.q && <AutoRefresh />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-2" role="search">
          <Input name="q" defaultValue={filter.q} placeholder={t("search")} aria-label={t("search")} className="w-56" />
          <select name="risk" defaultValue={filter.risk ?? ""} aria-label={t("allRisks")} className="h-8 rounded-lg border bg-background px-2 text-sm">
            <option value="">{t("allRisks")}</option>
            {(["HIGH", "MEDIUM", "LOW"] as const).map((v) => (
              <option key={v} value={v}>
                {r(v)}
              </option>
            ))}
          </select>
          <select name="specialty" defaultValue={filter.specialty ?? ""} aria-label={t("allSpecialties")} className="h-8 rounded-lg border bg-background px-2 text-sm">
            <option value="">{t("allSpecialties")}</option>
            {(["PHYSICIAN", "DENTIST", "PEDIATRICIAN"] as const).map((v) => (
              <option key={v} value={v}>
                {sp(v)}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonVariants({ variant: "secondary" })}>
            {t("searchButton")}
          </button>
        </form>
        {permissions.includes("patient.register") && (
          <Link href={`/trips/${tripId}/patients/new`} className={buttonVariants()}>
            {t("register")}
          </Link>
        )}
      </div>

      <p className="text-sm text-muted-foreground">{t("count", { count: result.total })}</p>

      {result.patients.length === 0 ? (
        <p className="text-muted-foreground">{filter.q || filter.risk || filter.specialty ? t("noMatches") : t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {result.patients.map((p) => (
            <li key={p.id}>
              {/* No prefetch: opening a record is an audited view, so only a real click should load it. */}
              <Link href={`/patients/${p.id}`} prefetch={false} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50">
                <span className="grid">
                  <span className="font-medium">
                    {p.lastName}, {p.firstName}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.label} · {g(p.gender)} · <AgeText patient={p} today={today} />
                  </span>
                </span>
                <span className="flex gap-1.5">
                  <Badge variant="secondary">{sp(p.assignedSpecialty)}</Badge>
                  {p.waterRiskRating === "HIGH" && <Badge variant="destructive">{r("HIGH")}</Badge>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label={t("page", { page: result.page, pages })}>
          {result.page > 1 ? <Link href={pageHref(result.page - 1)}>{t("previous")}</Link> : <span />}
          <span className="text-muted-foreground">{t("page", { page: result.page, pages })}</span>
          {result.page < pages ? <Link href={pageHref(result.page + 1)}>{t("next")}</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
