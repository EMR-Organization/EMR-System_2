"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

export type NavItem = { href: string; label: string };

/** Nav links with the current section highlighted. */
/** `exact`: only the exact path is "current" (for tabs where one href is a prefix of the others). */
export function NavLinks({ items, className, exact = false }: { items: NavItem[]; className?: string; exact?: boolean }) {
  const pathname = usePathname();
  return (
    <ul className={cn("flex gap-1", className)}>
      {items.map((item) => {
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
