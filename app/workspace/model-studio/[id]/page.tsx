import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Boxes } from "lucide-react";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Model",
    description: "Model Studio canvas — coming soon.",
    path: "/workspace/model-studio",
  });
}

// Model detail / canvas — intentionally a STUB for the list-view migration.
// The canvas (entities, attributes, relationships, DDL export) is explicitly
// out of scope; this page only proves the list-view "Open" navigation lands
// somewhere coherent. Auth is guarded here, matching the list page.
export default async function ModelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await getCurrentUser();
  if (!auth) {
    const { id } = await params;
    redirect(`/login?redirect=/workspace/model-studio/${id}`);
  }

  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col items-center justify-center gap-6 px-6 py-32 md:px-12">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full" aria-hidden="true" />
          <div className="relative p-4 rounded-2xl bg-gradient-to-br from-primary/20 via-primary/5 to-transparent border border-primary/30 shadow-[0_0_24px_rgba(94,106,210,0.15)]">
            <Boxes className="h-8 w-8 text-primary" />
          </div>
        </div>
        <div className="text-center max-w-md">
          <h1 className="text-xl font-bold tracking-tight text-ink">Canvas coming soon</h1>
          <p className="mt-2 text-sm text-ink-subtle">
            The modelling canvas — entities, relationships, and DDL export — is on its way. For
            now, manage your models from the library.
          </p>
        </div>
        <Link
          href="/workspace/model-studio"
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-ink-subtle hover:text-ink hover:bg-surface-1/50 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Model Studio
        </Link>
      </div>
    </main>
  );
}
