import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { SkillsList } from "@/components/skills/skills-list";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Skills",
    description: "Manage your AI skills.",
    path: "/account/skills",
  });
}

export default function SkillsPage() {
  return <SkillsList />;
}
