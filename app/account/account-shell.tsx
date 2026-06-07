"use client";

import { usePathname } from "next/navigation";
import { WorkspaceNav } from "./workspace-nav";

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
  const isProfile = pathname === "/account";

  if (isProfile) {
    return (
      <>
        <div className="mb-12 flex items-center justify-between gap-x-4">
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
        <div className="min-w-0">{children}</div>
      </>
    );
  }

  return (
    <>
      <div className="mb-12 flex items-center justify-between gap-x-4">
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
        <aside>
          <WorkspaceNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
