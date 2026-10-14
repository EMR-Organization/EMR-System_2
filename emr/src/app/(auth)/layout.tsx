import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("Common");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-1">
        <p className="text-lg font-semibold tracking-tight text-primary">{t("appName")}</p>
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
