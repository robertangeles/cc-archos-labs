"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, GitBranch, Clock, type LucideIcon } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const items: NavItem[] = [
  { href: "/account/skills", label: "Skills", icon: Sparkles },
  { href: "/account/workflows", label: "Workflows", icon: GitBranch },
  { href: "/account/history", label: "History", icon: Clock },
];

export function WorkspaceNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-y-1">
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname.startsWith(item.href);
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
