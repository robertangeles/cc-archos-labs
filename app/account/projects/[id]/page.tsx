import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { ProjectDetail } from "@/components/projects/project-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Project",
    description: "Plan and track delivery work on a Kanban board.",
    path: "/account/projects",
  });
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectDetail projectId={id} />;
}
