import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";
import * as skillService from "@/lib/skills/service";
import { SkillDetail } from "@/components/skills/skill-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return buildPageMetadata({
    title: "Skill Detail",
    description: "View and execute your AI skill.",
    path: `/account/skills/${id}`,
  });
}

export default async function SkillDetailPage({
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
    redirect("/account");
  }

  const serialized = {
    ...skill,
    temperature: skill.temperature ? String(skill.temperature) : null,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
    inputs: skill.inputs.map((i) => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    })),
    outputs: skill.outputs.map((o) => ({
      ...o,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
  };

  return (
    <main className="flex flex-1 flex-col bg-canvas px-6 py-16 md:px-12 md:py-24">
      <div className="mx-auto w-full max-w-[720px]">
        <SkillDetail skill={serialized} />
      </div>
    </main>
  );
}
