"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  GitBranch,
  Clock,
  MessageSquare,
  Brain,
  CalendarClock,
  Users,
  FolderKanban,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const items: NavItem[] = [
  { href: "/account/workspace", label: "Chat", icon: MessageSquare },
  { href: "/account/brain", label: "Brain", icon: Brain },
  { href: "/account/skills", label: "Skills", icon: Sparkles },
  { href: "/account/workflows", label: "Workflows", icon: GitBranch },
  { href: "/account/scheduled-posts", label: "Social Posts", icon: CalendarClock },
  { href: "/account/clients", label: "Clients", icon: Users },
  { href: "/account/projects", label: "Projects", icon: FolderKanban },
  { href: "/account/history", label: "History", icon: Clock },
];

interface WorkspaceNavProps {
  mobile?: boolean;
}

export function WorkspaceNav({ mobile }: WorkspaceNavProps) {
  const pathname = usePathname();

  if (mobile) {
    return (
      <nav className="flex items-center justify-around px-2 py-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/account/workspace"
              ? pathname === "/account/workspace"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-md px-3 py-1 transition-colors ${
                active ? "text-primary" : "text-ink-subtle"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-y-1 rounded-xl border border-hairline bg-surface-1 p-2">
      {items.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
                active
                  ? "bg-surface-3 text-ink"
                  : "text-ink-subtle hover:bg-surface-2 hover:text-ink"
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
