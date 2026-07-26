"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Horizontal sub-nav for /admin/blog. Two tabs today; new tabs slot in
// by adding to `tabs` and dropping a page.tsx at the corresponding
// route. Style mirrors admin-tab-nav (sidebar) but laid out
// horizontally because we're already inside the sidebar's "Blog" slot.

const tabs: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "/admin/blog", label: "Settings", exact: true },
  { href: "/admin/blog/posts", label: "Posts" },
  { href: "/admin/blog/pipeline", label: "Blog agent" },
];

export function BlogSubNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-x-1 border-b border-hairline">
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`-mb-px border-b-2 px-4 py-3 text-sm transition-colors duration-150 ${
              active
                ? "border-primary text-ink"
                : "border-transparent text-ink-subtle hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
