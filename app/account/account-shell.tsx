"use client";

import { usePathname } from "next/navigation";
import { WorkspaceNav } from "./workspace-nav";
import { ProfileTabNav } from "./profile-tab-nav";

interface AccountShellProps {
  displayName: string;
  signOutButton: React.ReactNode;
  children: React.ReactNode;
}

export function AccountShell({
  displayName,
  signOutButton,
  children,
}: AccountShellProps) {
  const pathname = usePathname();
  const isProfile =
    pathname === "/account" || pathname.startsWith("/account/personalisation");
  const isWorkspaceHome = pathname === "/account/workspace";

  if (isProfile) {
    return (
      <>
        <div className="mb-6 flex items-center justify-between gap-x-4">
          <div>
            <p className="uppercase text-eyebrow text-ink-subtle">
              Your Account
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-ink md:text-3xl">
              {displayName}
            </h1>
          </div>
          {signOutButton}
        </div>
        <ProfileTabNav />
        <div className="min-w-0">{children}</div>
      </>
    );
  }

  if (isWorkspaceHome) {
    return (
      <>
        <style>{`footer { display: none !important; }`}</style>
        <div className="-mt-16 -mb-32">
          {children}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-8 flex items-center justify-between gap-x-4 md:mb-12">
        <div>
          <p className="uppercase text-eyebrow text-ink-subtle">
            My Workspace
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-ink md:text-3xl">
            {displayName}
          </h1>
        </div>
        {signOutButton}
      </div>
      <div className="grid gap-x-12 gap-y-8 md:grid-cols-[200px_1fr]">
        <aside className="hidden md:block">
          <WorkspaceNav />
        </aside>
        <div className="min-w-0 pb-20 md:pb-0">{children}</div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas/95 backdrop-blur-sm md:hidden">
        <WorkspaceNav mobile />
      </div>
    </>
  );
}
