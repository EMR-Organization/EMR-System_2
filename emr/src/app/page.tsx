import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { orSignIn } from "@/server/page";
import { me } from "@/server/services/users";

// Placeholder home until Phase 3 adds trips and the app shell.
export default async function Home() {
  const t = await getTranslations("Home");
  const c = await getTranslations("Common");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense fallback={<p className="text-muted-foreground">{c("loading")}</p>}>
        <SignedIn />
      </Suspense>
    </main>
  );
}

async function SignedIn() {
  const t = await getTranslations("Home");
  const r = await getTranslations("Roles");
  const user = await orSignIn(() => me());
  return (
    <div className="grid justify-items-center gap-4">
      <p>{t("signedInAs", { name: user.name, role: r(user.role) })}</p>
      <p className="text-muted-foreground">{t("comingSoon")}</p>
      <div className="flex gap-2">
        <Link href="/account" className={buttonVariants({ variant: "secondary" })}>
          {t("goToAccount")}
        </Link>
        <SignOutButton />
      </div>
    </div>
  );
}
