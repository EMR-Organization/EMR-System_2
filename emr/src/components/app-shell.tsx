import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { roleHas } from "@/lib/shared/permissions";
import { orSignIn } from "@/server/page";
import { me } from "@/server/services/users";
import { NavLinks, type NavItem } from "./app-nav-links";
import { SessionTimeoutWarning } from "./session-timeout-warning";
import { SignOutButton } from "./sign-out-button";

// Sidebar on wide screens, a top bar on phones. The links shown depend on the
// role, but that's only tidiness: every page and action checks on the server.

export async function AppShell({ children }: { children: ReactNode }) {
  const c = await getTranslations("Common");
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="border-b bg-muted/30 md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3 md:block md:py-5">
          <Link href="/trips" className="font-semibold tracking-tight text-primary">
            {c("appName")}
          </Link>
        </div>
        <Suspense fallback={<div className="h-10 px-4 text-sm text-muted-foreground">{c("loading")}</div>}>
          <UserNav />
        </Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      {/* Reads the URL, which is only known per request. */}
      <Suspense>
        <SessionTimeoutWarning />
      </Suspense>
    </div>
  );
}

async function UserNav() {
  const t = await getTranslations("Nav");
  const r = await getTranslations("Roles");
  const user = await orSignIn(() => me());

  const items: NavItem[] = [{ href: "/trips", label: t("trips") }];
  if (roleHas(user.role, "search.crossTrip")) items.push({ href: "/search", label: t("search") });
  if (roleHas(user.role, "user.manage")) items.push({ href: "/admin/users", label: t("users") });
  if (roleHas(user.role, "audit.read")) items.push({ href: "/admin/audit", label: t("audit") });
  if (roleHas(user.role, "backup.run")) items.push({ href: "/admin/backups", label: t("backups") });
  if (roleHas(user.role, "sync.import")) items.push({ href: "/admin/sync", label: t("sync") });
  items.push({ href: "/account", label: t("account") });

  return (
    <nav aria-label={t("main")} className="flex flex-col gap-2 px-2 pb-3 md:gap-6">
      <NavLinks items={items} className="overflow-x-auto md:flex-col" />
      <div className="hidden px-3 text-xs text-muted-foreground md:block">
        <p className="mb-2">{t("signedInAs", { name: user.name, role: r(user.role) })}</p>
        <SignOutButton />
      </div>
    </nav>
  );
}
