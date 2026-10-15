import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("NotFound");
  return (
    <div className="mx-auto grid max-w-md gap-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      <Link href="/trips" className="text-sm text-primary underline-offset-4 hover:underline">
        {t("back")}
      </Link>
    </div>
  );
}
