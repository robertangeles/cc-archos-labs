import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { SkillCreator } from "@/components/skills/skill-creator";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "New Skill",
    description: "Create a new AI skill.",
    path: "/account/skills/new",
  });
}

export default function NewSkillPage() {
  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">Create a Skill</h2>
      <p className="mt-1 text-sm text-ink-subtle">
        Build a reusable AI skill with custom prompts and model settings.
      </p>
      <div className="mt-8">
        <SkillCreator />
      </div>
    </div>
  );
}
