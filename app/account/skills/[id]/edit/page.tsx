import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";
import * as skillService from "@/lib/skills/service";
import { SkillCreator } from "@/components/skills/skill-creator";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return buildPageMetadata({
    title: "Edit Skill",
    description: "Edit your AI skill.",
    path: `/account/skills/${id}/edit`,
  });
}

export default async function EditSkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await getCurrentUser();
  if (!auth) {
    redirect("/login?redirect=/account");
  }

  const { id } = await params;
  const skill = await skillService.getSkill(id, auth.user.id);

  if (!skill) {
    redirect("/account/skills");
  }

  const initialData = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category as "repurpose" | "generate" | "research" | "transform" | "extract" | "plan",
    promptTemplate: skill.promptTemplate,
    systemPrompt: skill.systemPrompt,
    defaultModel: skill.defaultModel,
    temperature: skill.temperature ? String(skill.temperature) : null,
    maxTokens: skill.maxTokens,
    inputs: skill.inputs.map((i) => ({
      key: i.key,
      type: i.type as "text" | "multiline" | "select",
      label: i.label,
      description: i.description ?? undefined,
      required: i.isRequired,
      defaultValue: i.defaultValue ?? undefined,
      options: (i.options as string[]) ?? undefined,
    })),
    outputs: skill.outputs.map((o) => ({
      key: o.key,
      type: o.type as "text" | "markdown" | "json",
      label: o.label,
      description: o.description ?? undefined,
    })),
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">Edit Skill</h2>
      <p className="mt-1 text-sm text-ink-subtle">
        {skill.name} (v{skill.currentVersion})
      </p>
      <div className="mt-8">
        <SkillCreator initialData={initialData} />
      </div>
    </div>
  );
}
