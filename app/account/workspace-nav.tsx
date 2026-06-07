"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  User,
  Sparkles,
  Clock,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const items: NavItem[] = [
  { href: "/account", label: "Profile", icon: User },
  { href: "/account/skills", label: "Skills", icon: Sparkles },
  { href: "/account/history", label: "History", icon: Clock },
];

export function WorkspaceNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-y-1">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-ink-subtle/70">
        Workspace
      </p>
      {items.map((item) => {
        const active =
          item.href === "/account"
            ? pathname === "/account"
            : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
              active
                ? "bg-surface-2 text-ink"
                : "text-ink-subtle hover:bg-surface-1 hover:text-ink"
            }`}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
