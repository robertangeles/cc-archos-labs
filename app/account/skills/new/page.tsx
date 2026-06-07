import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SkillCreator } from "@/components/skills/skill-creator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "New Skill",
    description: "Create a new AI skill.",
    path: "/account/skills/new",
  });
}

export default async function NewSkillPage() {
  const auth = await getCurrentUser();
  if (!auth) {
    redirect("/login?redirect=/account/skills/new");
  }

  return (
    <main className="flex flex-1 flex-col bg-canvas px-6 py-16 md:px-12 md:py-24">
      <div className="mx-auto w-full max-w-[720px]">
        <p className="uppercase text-eyebrow text-ink-subtle">New Skill</p>
        <h1 className="mt-4 text-3xl font-semibold text-ink md:text-4xl">
          Create a Skill
        </h1>
        <p className="mt-2 text-sm text-ink-subtle">
          Build a reusable AI skill with custom prompts and model settings.
        </p>

        <div className="mt-10">
          <SkillCreator />
        </div>
      </div>
    </main>
  );
}
