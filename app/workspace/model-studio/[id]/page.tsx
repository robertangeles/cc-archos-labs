import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ModelDetailView } from "@/components/model-studio/canvas/model-detail-view";

export const runtime = "nodejs";
// Per-user, cookie-scoped canvas — never prerender.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Model Studio",
    description: "Model the data — entities, attributes, and relationships on a layered canvas.",
    path: "/workspace/model-studio",
  });
}

// Model detail / canvas. /workspace has no shared layout, so this page guards
// auth itself (mirroring the list page); org-scoping is enforced by the API the
// client view calls — GET /api/model-studio/:id 404s for a model outside the
// caller's org, which the client renders as "Model not found".
export default async function ModelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await getCurrentUser();
  const { id } = await params;
  if (!auth) {
    redirect(`/login?redirect=/workspace/model-studio/${id}`);
  }

  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <ModelDetailView modelId={id} />
    </main>
  );
}
