import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Shown after registering, or after a correct password for an account that
// isn't active. Holds no data; the status comes from the URL.

export default async function PendingPage({ searchParams }: PageProps<"/pending">) {
  const t = await getTranslations("Pending");
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("title")}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <Suspense>
          <StatusMessage searchParams={searchParams} />
        </Suspense>
        <Link className="text-primary underline-offset-4 hover:underline" href="/login">
          {t("back")}
        </Link>
      </CardContent>
    </Card>
  );
}

async function StatusMessage({ searchParams }: Pick<PageProps<"/pending">, "searchParams">) {
  const t = await getTranslations("Pending");
  const { status } = await searchParams;
  const key = status === "DISABLED" ? "disabled" : status === "REGISTERED" ? "registered" : "pending";
  return <p>{t(key)}</p>;
}
