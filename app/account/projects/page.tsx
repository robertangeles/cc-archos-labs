import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { ProjectsView } from "@/components/projects/projects-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Projects",
    description: "Plan and track delivery work on a Kanban board.",
    path: "/account/projects",
  });
}

export default function ProjectsPage() {
  return <ProjectsView />;
}
