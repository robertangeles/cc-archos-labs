import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ModelStudioView } from "@/components/model-studio/model-studio-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const meta = await buildPageMetadata({
    title: "Model Studio",
    description:
      "A thinking surface for data architects — conceptual, logical, and physical layers, linked not duplicated.",
    path: "/workspace/model-studio",
  });
  // Auth-gated app surface — never index (mirrors /account + report pages).
  return { ...meta, robots: { index: false, follow: false } };
}

// /workspace has no shared layout (unlike /account), so this page guards auth
// itself, mirroring app/account/organisation/page.tsx. The Model Studio feature
// flag (read client-side) and the org-context API guards do the rest: an
// unauthenticated visitor never reaches here, and a non-admin sees the
// "Coming soon" stub until an owner|admin flips the flag.
export default async function ModelStudioPage() {
  const auth = await getCurrentUser();
  if (!auth) {
    redirect("/login?redirect=/workspace/model-studio");
  }

  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <div className="mx-auto w-full max-w-[1400px] px-6 pt-16 pb-32 md:px-12">
        <ModelStudioView />
      </div>
    </main>
  );
}
