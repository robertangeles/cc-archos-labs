import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles, GitBranch, Clock, ArrowRight } from "lucide-react";
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

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const quickLinks = [
  {
    href: "/account/skills",
    label: "Skills",
    description: "Create and run AI skills",
    icon: Sparkles,
  },
  {
    href: "/account/workflows",
    label: "Workflows",
    description: "Multi-step AI pipelines",
    icon: GitBranch,
  },
  {
    href: "/account/history",
    label: "History",
    description: "Past activity and results",
    icon: Clock,
  },
];

export default async function WorkspacePage() {
  const auth = await getCurrentUser();
  if (!auth) {
    redirect("/login?redirect=/account/workspace");
  }

  const displayName = auth.user.displayName || "there";

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      {/* Greeting — centered, display typography, breathing room */}
      <div className="w-full max-w-lg">
        <p className="text-sm font-medium tracking-wide text-primary">
          {getGreeting()}
        </p>
        <h2 className="mt-2 text-display-md text-ink">{displayName}</h2>
        <p className="mt-3 text-body text-ink-subtle">
          Your workspace is ready.
        </p>
      </div>

      {/* Quick links — three cards, subtle, earn their place */}
      <div className="mt-12 grid w-full max-w-lg gap-3">
        {quickLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-center justify-between rounded-lg border border-hairline bg-surface-1 px-5 py-4 transition-all duration-150 hover:border-hairline-strong hover:bg-surface-2"
            >
              <div className="flex items-center gap-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2 text-ink-subtle transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="text-left">
                  <p className="text-sm font-medium text-ink">{link.label}</p>
                  <p className="text-xs text-ink-tertiary">
                    {link.description}
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
