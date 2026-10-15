import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { orSignIn } from "@/server/page";
import { listMembers } from "@/server/services/trips";
import { MemberSwitch } from "./member-switch";
import { titled } from "@/app/page-title";

export const generateMetadata = titled("Members");

export default function MembersPage({ params }: PageProps<"/trips/[tripId]/members">) {
  return (
    <Suspense>
      <Members params={params} />
    </Suspense>
  );
}

async function Members({ params }: Pick<PageProps<"/trips/[tripId]/members">, "params">) {
  const t = await getTranslations("Members");
  const { tripId } = await params;
  const students = await orSignIn(() => listMembers(tripId));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription>{t("intro")}</CardDescription>
      </CardHeader>
      <CardContent>
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y">
            {students.map((s) => (
              <li key={s.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="grid">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.email}
                    {s.enabled && s.enabledByName ? ` · ${t("enabledBy", { name: s.enabledByName })}` : ""}
                  </span>
                </div>
                <MemberSwitch tripId={tripId} userId={s.userId} name={s.name} enabled={s.enabled} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
