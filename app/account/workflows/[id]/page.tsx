import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { WorkflowBuilder } from "@/components/workflows/workflow-builder";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Workflow",
    description: "Configure your AI orchestration pipeline.",
    path: "/account/workflows",
  });
}

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkflowBuilder workflowId={id} />;
}
