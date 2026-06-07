import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { WorkflowCreator } from "@/components/workflows/workflow-creator";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "New Workflow",
    description: "Create a new AI orchestration pipeline.",
    path: "/account/workflows/new",
  });
}

export default function NewWorkflowPage() {
  return <WorkflowCreator />;
}
