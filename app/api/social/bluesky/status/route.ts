import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSocialAccount } from "@/lib/social/token";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const account = await getSocialAccount(auth.user.id, "bluesky");

  if (!account || !account.isConnected) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    accountName: account.accountIdentifier,
  });
}
