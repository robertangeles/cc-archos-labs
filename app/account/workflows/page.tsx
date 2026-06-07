import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { WorkflowsList } from "@/components/workflows/workflows-list";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Workflows",
    description: "Manage your AI orchestration pipelines.",
    path: "/account/workflows",
  });
}

export default function WorkflowsPage() {
  return <WorkflowsList />;
}
