import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { myPermissions } from "@/server/services/users";
import { ImportForm } from "./import-form";

export default function DataPage({ params }: PageProps<"/trips/[tripId]/data">) {
  return (
    <Suspense>
      <Data params={params} />
    </Suspense>
  );
}

async function Data({ params }: Pick<PageProps<"/trips/[tripId]/data">, "params">) {
  const t = await getTranslations("Data");
  const { tripId } = await params;
  const permissions = await orSignIn(() => myPermissions({ tripId }));
  if (!permissions.includes("data.export")) notFound();

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("exportTitle")}</h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t("exportIntro")}</p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {/* Plain links: file downloads, each one audited. */}
          <a href={`/api/trips/${tripId}/export?format=csv`} className={buttonVariants({ variant: "outline" })} download>
            {t("csv")}
          </a>
          <a href={`/api/trips/${tripId}/export?format=json`} className={buttonVariants({ variant: "outline" })} download>
            {t("json")}
          </a>
        </CardContent>
      </Card>
      {permissions.includes("data.import") && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("importTitle")}</h2>
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t("importIntro")}</p>
          </CardHeader>
          <CardContent>
            <ImportForm tripId={tripId} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
