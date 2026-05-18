"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Settings sidebar nav for the admin section. New tabs slot in by adding
// an entry here + creating app/admin/(authed)/<slug>/page.tsx.

type Tab = {
  href: string;
  label: string;
  /** When true the tab renders disabled (placeholder for future work). */
  comingSoon?: boolean;
};

const tabs: Tab[] = [
  { href: "/admin/site", label: "SEO & Brand" },
  { href: "/admin/pages", label: "Pages" },
  { href: "/admin/diagnostic", label: "Diagnostic Content" },
  { href: "/admin/prompts", label: "Diagnostic Prompt" },
  { href: "/admin/integrations", label: "Integrations" },
  // Future tabs (kept here as comments — uncomment + create the page when ready):
  // { href: "/admin/profile", label: "Profile", comingSoon: true },
  // { href: "/admin/email", label: "Email Templates", comingSoon: true },
  // { href: "/admin/analytics", label: "Analytics", comingSoon: true },
];

export function AdminTabNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-y-1">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-ink-subtle/70">
        Settings
      </p>
      {tabs.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        if (tab.comingSoon) {
          return (
            <span
              key={tab.href}
              className="cursor-not-allowed rounded-md px-3 py-2 text-sm text-ink-subtle/50"
            >
              {tab.label}
              <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-subtle/40">
                soon
              </span>
            </span>
          );
        }
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
              active
                ? "bg-surface-2 text-ink"
                : "text-ink-subtle hover:bg-surface-1 hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
