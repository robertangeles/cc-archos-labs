import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteSocialAccount } from "@/lib/social/token";
import { clientIpFromRequest, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// POST /api/social/linkedin/disconnect
// Requires authentication. Deletes the stored LinkedIn social account
// (tokens are hard-deleted, not soft-revoked — LinkedIn does not offer
// a server-side token revocation endpoint).

const DISCONNECTS_PER_IP_PER_HOUR = 20;

export async function POST(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const ip = clientIpFromRequest(request);
  const limit = rateLimit(
    `linkedin-disconnect:ip:${ip}`,
    DISCONNECTS_PER_IP_PER_HOUR,
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 },
    );
  }

  await deleteSocialAccount(auth.user.id, "linkedin");

  return NextResponse.json({ ok: true });
}
