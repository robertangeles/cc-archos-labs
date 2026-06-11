"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/account", label: "Profile" },
  { href: "/account/personalisation", label: "Personalisation" },
  { href: "/account/social-accounts", label: "Social Accounts" },
] as const;

export function ProfileTabNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-8 flex gap-1 border-b border-hairline">
      {tabs.map((t) => {
        const active =
          t.href === "/account"
            ? pathname === "/account"
            : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors duration-150 ${
              active ? "text-ink" : "text-ink-subtle hover:text-ink"
            }`}
          >
            {t.label}
            {active && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
