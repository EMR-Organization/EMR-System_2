import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { localDay } from "@/lib/shared/dates";
import { orSignIn } from "@/server/page";
import { listPhotos } from "@/server/services/photos";
import { loadPatient, loadPermissions } from "../data";
import { PhotoUploadForm } from "../doctor-forms";

type Props = PageProps<"/patients/[patientId]/photos">;

export default function PhotosPage({ params }: Props) {
  return (
    <Suspense>
      <Photos params={params} />
    </Suspense>
  );
}

async function Photos({ params }: Pick<Props, "params">) {
  const t = await getTranslations("Photos");
  const format = await getFormatter();
  const { patientId } = await params;
  const p = await orSignIn(() => loadPatient(patientId));
  const [items, permissions] = await orSignIn(() => Promise.all([listPhotos(patientId), loadPermissions(p.tripId)]));

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((ph) => {
                const kind = ph.kind === "PROFILE" ? t("profile") : t("medical");
                return (
                  <li key={ph.id} className="grid gap-1 text-xs">
                    {/* Served by /api/photos/[id]: checked and audited on every load. */}
                    <a href={`/api/photos/${ph.id}`} target="_blank" rel="noopener" aria-label={t("viewFull")}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- private, per-user images; never through the image optimizer cache */}
                      <img
                        src={`/api/photos/${ph.id}`}
                        alt={t("alt", { kind, description: ph.description ?? ph.category ?? "" })}
                        loading="lazy"
                        className="aspect-square w-full rounded-lg border object-cover"
                      />
                    </a>
                    <span className="flex flex-wrap gap-1">
                      <Badge variant={ph.kind === "PROFILE" ? "default" : "secondary"}>{kind}</Badge>
                      {ph.category && <Badge variant="outline">{ph.category}</Badge>}
                    </span>
                    {ph.description && <span>{ph.description}</span>}
                    <span className="text-muted-foreground">
                      {format.dateTime(ph.takenOn ?? ph.createdAt, { dateStyle: "medium", timeZone: ph.takenOn ? "UTC" : undefined })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      {permissions.includes("photo.write") && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("upload")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoUploadForm patientId={patientId} today={localDay()} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
