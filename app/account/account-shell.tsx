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
    pathname === "/account" ||
    pathname.startsWith("/account/personalisation") ||
    pathname.startsWith("/account/social-accounts") ||
    pathname.startsWith("/account/organisation");
  const isWorkspaceHome = pathname === "/account/workspace";
  const isWorkspaceSubpage =
    pathname === "/account/brain" ||
    pathname.startsWith("/account/skills") ||
    pathname.startsWith("/account/workflows") ||
    pathname.startsWith("/account/scheduled-posts") ||
    pathname.startsWith("/account/clients") ||
    pathname.startsWith("/account/projects") ||
    pathname.startsWith("/account/history");

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
        <style>{`
          footer { display: none !important; }
          .account-wrapper { padding: 0 !important; max-width: 100% !important; }
        `}</style>
        <div className="mx-auto max-w-[1080px] px-6 md:px-12">
          {children}
        </div>
      </>
    );
  }

  if (isWorkspaceSubpage) {
    return (
      <>
        <style>{`
          footer { display: none !important; }
          .account-wrapper { padding: 0 !important; max-width: 100% !important; }
        `}</style>
        <div className="mx-auto max-w-[1080px] px-6 md:px-12">
          <div className="mb-8 flex items-center justify-between gap-x-4 md:mb-12">
            <div>
              <p className="uppercase text-eyebrow text-ink-subtle">
                Metis Workspace
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
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-8 flex items-center justify-between gap-x-4 md:mb-12">
        <div>
          <p className="uppercase text-eyebrow text-ink-subtle">
            Metis Workspace
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
