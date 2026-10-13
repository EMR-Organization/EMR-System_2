import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AgeText } from "@/components/age";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { orSignIn } from "@/server/page";
import { doctorQueue } from "@/server/services/dashboard";
import { me } from "@/server/services/users";

type Props = PageProps<"/trips/[tripId]/queue">;

// "My patients" (render_doctor_patient_list in the old app).
export default function QueuePage({ params, searchParams }: Props) {
  return (
    <Suspense>
      <Queue params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Queue({ params, searchParams }: Props) {
  const t = await getTranslations("Queue");
  const sp = await getTranslations("Specialties");
  const g = await getTranslations("Gender");
  const { tripId } = await params;
  const { specialty: requested } = await searchParams;
  const [user, queue] = await orSignIn(() =>
    Promise.all([me(), doctorQueue({ tripId, specialty: typeof requested === "string" ? requested : undefined })]),
  );
  const today = new Date().toISOString();

  return (
    <div className="grid gap-4">
      <AutoRefresh />
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">{queue.specialty ? t("titleFor", { specialty: sp(queue.specialty) }) : t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      {user.role === "ADMIN" && (
        <nav aria-label={t("choose")} className="flex flex-wrap gap-2 text-sm">
          {(["PHYSICIAN", "DENTIST", "PEDIATRICIAN"] as const).map((s) => (
            <Link
              key={s}
              href={`?specialty=${s}`}
              aria-current={queue.specialty === s ? "page" : undefined}
              className="rounded-md border px-3 py-1.5 aria-[current=page]:bg-muted aria-[current=page]:font-medium"
            >
              {sp(s)}
            </Link>
          ))}
        </nav>
      )}

      {queue.specialty && queue.patients.length === 0 && <p className="text-muted-foreground">{t("empty", { specialty: sp(queue.specialty) })}</p>}

      {queue.patients.length > 0 && (
        <ul className="divide-y rounded-xl border">
          {queue.patients.map((p) => {
            const seen = p.hasDiagnosis || p.activeMedications > 0;
            return (
              <li key={p.id}>
                <Link href={`/patients/${p.id}/diagnosis`} prefetch={false} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50">
                  <span className="grid">
                    <span className="font-medium">
                      {p.lastName}, {p.firstName}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {p.label} · {g(p.gender)} · <AgeText patient={p} today={today} />
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Badge variant={seen ? "secondary" : "default"}>{seen ? t("seen") : t("waiting")}</Badge>
                    {p.hasDiagnosis && <Badge variant="outline">{t("diagnosed")}</Badge>}
                    {p.activeMedications > 0 && <Badge variant="outline">{t("meds", { count: p.activeMedications })}</Badge>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
