import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { listMySessions, me } from "@/server/services/users";
import { ChangePasswordForm, RevokeSessionButton } from "./account-forms";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AccountPage() {
  const t = await getTranslations("Account");
  const c = await getTranslations("Common");
  return (
    <main className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-6 md:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense fallback={<p className="text-muted-foreground">{c("loading")}</p>}>
        <AccountDetails />
      </Suspense>
    </main>
  );
}

async function AccountDetails() {
  const t = await getTranslations("Account");
  const r = await getTranslations("Roles");
  const format = await getFormatter();
  const [user, sessions] = await orSignIn(() => Promise.all([me(), listMySessions()]));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{user.name}</CardTitle>
          <CardDescription className="flex items-center gap-2">
            {user.email} <Badge variant="secondary">{r(user.role)}</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("devices")}</h2>
          </CardTitle>
          <CardDescription>{t("devicesHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                <div className="grid gap-0.5">
                  <span className="font-medium break-all">
                    {s.userAgent ?? t("unknownDevice")} {s.current && <Badge>{t("thisDevice")}</Badge>}
                  </span>
                  <span className="text-muted-foreground">
                    {s.ipAddress ?? "—"} · {t("lastActive", { time: format.dateTime(s.lastActiveAt, { dateStyle: "medium", timeStyle: "short" }) })}
                  </span>
                </div>
                {!s.current && <RevokeSessionButton sessionId={s.id} />}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("changePassword")}</h2>
          </CardTitle>
          <CardDescription>{t("changePasswordHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </>
  );
}
