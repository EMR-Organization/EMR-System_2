import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/app/account/actions";
import { Button } from "@/components/ui/button";

export async function SignOutButton() {
  const t = await getTranslations("Common");
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline">
        {t("signOut")}
      </Button>
    </form>
  );
}
