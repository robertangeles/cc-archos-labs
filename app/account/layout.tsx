import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { WorkspaceNav } from "./workspace-nav";
import { SignOutButton } from "./sign-out-button";

export const runtime = "nodejs";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getCurrentUser();
  if (!auth) {
    redirect("/login?redirect=/account");
  }

  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <div className="mx-auto w-full max-w-[1400px] px-6 pt-16 pb-32 md:px-12">
        <div className="mb-12 flex items-center justify-between gap-x-4">
          <div>
            <p className="uppercase text-eyebrow text-ink-subtle">
              Your Workspace
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-ink md:text-3xl">
              {auth.user.displayName || auth.user.email}
            </h1>
          </div>
          <SignOutButton />
        </div>

        {auth.user.emailVerifiedAt === null && (
          <div className="mb-8 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-5 py-3">
            <p className="text-sm font-medium text-yellow-300">
              Email not verified
            </p>
            <p className="mt-1 text-xs text-yellow-300/70">
              Check your inbox for a verification link. You need to verify
              your email before using Archos Labs tools.
            </p>
          </div>
        )}

        <div className="grid gap-x-12 gap-y-8 md:grid-cols-[200px_1fr]">
          <aside>
            <WorkspaceNav />
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </main>
  );
}
