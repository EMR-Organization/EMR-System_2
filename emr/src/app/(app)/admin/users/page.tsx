import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { listUsers, me } from "@/server/services/users";
import { PendingActions, UserRowActions } from "./user-actions";

export default async function AdminUsersPage() {
  const t = await getTranslations("AdminUsers");
  const c = await getTranslations("Common");
  return (
    <main className="mx-auto grid w-full grid-cols-[minmax(0,1fr)] max-w-5xl gap-6 px-4 py-6 md:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense fallback={<p className="text-muted-foreground">{c("loading")}</p>}>
        <Users />
      </Suspense>
    </main>
  );
}

async function Users() {
  const t = await getTranslations("AdminUsers");
  const r = await getTranslations("Roles");
  const sp = await getTranslations("Specialties");
  const st = await getTranslations("Statuses");
  const format = await getFormatter();
  // listUsers checks user.manage; a non-admin gets the 404 page.
  const [self, users] = await orSignIn(() => Promise.all([me(), listUsers()]));
  const pending = users.filter((u) => u.status === "PENDING");

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>
              {t("pending")} {pending.length > 0 && <Badge>{pending.length}</Badge>}
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("pendingEmpty")}</p>
          ) : (
            <ul className="divide-y">
              {pending.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="grid text-sm">
                    <span className="font-medium">
                      {u.name} <Badge variant="secondary">{r(u.role)}</Badge>
                    </span>
                    <span className="text-muted-foreground">{u.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("registered", { time: format.dateTime(u.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}
                    </span>
                  </div>
                  <PendingActions user={{ id: u.id, name: u.name }} isDoctor={u.role === "DOCTOR"} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("all")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {users
              .filter((u) => u.status !== "PENDING")
              .map((u) => {
                const { locked } = u;
                return (
                  <li key={u.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-start">
                    <div className="grid text-sm">
                      <span className="flex flex-wrap items-center gap-1.5 font-medium">
                        {u.name}
                        {u.id === self.id && <Badge variant="outline">{t("you")}</Badge>}
                      </span>
                      <span className="text-muted-foreground">{u.email}</span>
                      <span className="flex flex-wrap gap-1.5 pt-1">
                        <Badge variant="secondary">
                          {r(u.role)}
                          {u.specialty ? ` · ${sp(u.specialty)}` : ""}
                        </Badge>
                        <Badge variant={u.status === "ACTIVE" ? "outline" : "destructive"}>{st(u.status)}</Badge>
                        {locked && <Badge variant="destructive">{t("locked")}</Badge>}
                      </span>
                    </div>
                    <UserRowActions user={{ id: u.id, name: u.name }} status={u.status} locked={locked} isSelf={u.id === self.id} />
                  </li>
                );
              })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
