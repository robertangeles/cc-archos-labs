import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { buildPageMetadata } from "@/lib/site-config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ProfileEdit } from "./profile-edit";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Profile",
    description: "Manage your Archos Labs profile.",
    path: "/account",
  });
}

export default async function ProfilePage() {
  const auth = await getCurrentUser();
  if (!auth) {
    redirect("/login?redirect=/account");
  }

  const db = getDb();
  const [userRow] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, auth.user.id))
    .limit(1);
  const hasPassword = !!userRow?.passwordHash;

  return (
    <div className="rounded-lg border border-hairline bg-surface-1 p-6">
      <h2 className="text-body-sm font-semibold text-ink">Profile</h2>
      <div className="mt-4">
        <ProfileEdit
          displayName={auth.user.displayName || ""}
          email={auth.user.email}
          hasPassword={hasPassword}
        />
      </div>
    </div>
  );
}
