import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SignOutButton } from "./sign-out-button";
import { AccountShell } from "./account-shell";

export const runtime = "nodejs";

export default async function AccountLayout({
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
      <div className="account-wrapper mx-auto w-full max-w-[1400px] px-6 pt-16 pb-32 md:px-12">
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

        <AccountShell
          displayName={auth.user.displayName || auth.user.email}
          signOutButton={<SignOutButton />}
        >
          {children}
        </AccountShell>
      </div>
    </main>
  );
}
