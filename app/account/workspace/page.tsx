import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles, GitBranch, Clock } from "lucide-react";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "My Workspace",
    description: "Your skills, workflows, and history.",
    path: "/account/workspace",
  });
}

const sections = [
  {
    href: "/account/skills",
    label: "Skills",
    description: "Create and manage AI skills",
    icon: Sparkles,
  },
  {
    href: "/account/workflows",
    label: "Workflows",
    description: "Build and run multi-step workflows",
    icon: GitBranch,
  },
  {
    href: "/account/history",
    label: "History",
    description: "Past assessments and exam attempts",
    icon: Clock,
  },
];

export default async function WorkspacePage() {
  const auth = await getCurrentUser();
  if (!auth) {
    redirect("/login?redirect=/account/workspace");
  }

  return (
    <div className="space-y-4">
      {sections.map((section) => {
        const Icon = section.icon;
        return (
          <Link
            key={section.href}
            href={section.href}
            className="flex items-center gap-4 rounded-lg border border-hairline bg-surface-1 p-5 transition-colors duration-150 hover:border-ink-subtle/30 hover:bg-surface-2"
          >
            <Icon className="h-5 w-5 shrink-0 text-ink-subtle" />
            <div>
              <p className="text-sm font-medium text-ink">{section.label}</p>
              <p className="mt-0.5 text-xs text-ink-subtle">
                {section.description}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
