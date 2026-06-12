import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteSocialAccount } from "@/lib/social/token";

export const runtime = "nodejs";

export async function POST() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  await deleteSocialAccount(auth.user.id, "bluesky");

  return NextResponse.json({ ok: true });
}
