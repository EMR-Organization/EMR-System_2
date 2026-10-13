"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

export type NavItem = { href: string; label: string };

/** Nav links with the current section highlighted. */
/**
 * `exactFirst`: the first item (e.g. a trip's Overview, whose href is a prefix
 * of the other tabs) is only current on its exact path.
 */
export function NavLinks({ items, className, exactFirst = false }: { items: NavItem[]; className?: string; exactFirst?: boolean }) {
  const pathname = usePathname();
  return (
    <ul className={cn("flex gap-1", className)}>
      {items.map((item, i) => {
        const exact = exactFirst && i === 0;
        const active = pathname === item.href || (!exact && pathname.startsWith(`${item.href}/`));
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "block rounded-md px-3 py-2 text-sm whitespace-nowrap hover:bg-muted",
                active && "bg-muted font-medium text-foreground",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
