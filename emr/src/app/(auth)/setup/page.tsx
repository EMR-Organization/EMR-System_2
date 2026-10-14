import { getFormatter, getTranslations } from "next-intl/server";
import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rootCertificate } from "@/server/setup-cert";

// Device setup, before sign-in: install the hub's certificate once per device
// so the browser trusts https://emr-hub.local without warnings.

export default async function SetupPage() {
  const t = await getTranslations("Setup");
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("title")}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <p>{t("intro")}</p>
        <Suspense>
          <Certificate />
        </Suspense>
        <section className="grid gap-1">
          <h2 className="font-medium">{t("iphoneTitle")}</h2>
          <p>{t("iphone")}</p>
        </section>
        <section className="grid gap-1">
          <h2 className="font-medium">{t("androidTitle")}</h2>
          <p>{t("android")}</p>
        </section>
        <section className="grid gap-1">
          <h2 className="font-medium">{t("computerTitle")}</h2>
          <p>{t("computer")}</p>
        </section>
        <Link className="text-primary underline-offset-4 hover:underline" href="/login">
          {t("done")}
        </Link>
      </CardContent>
    </Card>
  );
}

async function Certificate() {
  await connection();
  const t = await getTranslations("Setup");
  const format = await getFormatter();
  const cert = await rootCertificate();
  if (!cert) return <p className="text-muted-foreground">{t("notAvailable")}</p>;
  return (
    <div className="grid gap-2">
      <a className={buttonVariants()} href="/setup/root.crt" download>
        {t("download")}
      </a>
      <p className="text-xs text-muted-foreground">
        {t("fingerprint")} <code className="break-all">{cert.fingerprint}</code>
      </p>
      <p className="text-xs text-muted-foreground">{t("validTo", { date: format.dateTime(cert.validTo, { dateStyle: "medium" }) })}</p>
    </div>
  );
}
