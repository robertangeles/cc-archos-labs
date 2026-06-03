import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../lib/db";
import { assessmentSession } from "../../../../lib/db/schema";
import { mintShareToken } from "../../../../lib/share-tokens";
import { getCurrentUser } from "../../../../lib/auth/current-user";
import {
  clientIpFromRequest,
  rateLimit,
} from "../../../../lib/rate-limit";
import { getPublicOrigin } from "../../../../lib/public-origin";

export const runtime = "nodejs";

const SHARES_PER_IP_PER_HOUR = 20;

const BodySchema = z.object({
  sessionId: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      "Invalid session id",
    ),
});

export async function POST(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return Response.json(
      { ok: false, error: "Sign in to share a report." },
      { status: 401 },
    );
  }

  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`share-mint:${ip}`, SHARES_PER_IP_PER_HOUR);
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "Too many share links. Try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const db = getDb();
  const rows = await db
    .select({ userId: assessmentSession.userId })
    .from(assessmentSession)
    .where(eq(assessmentSession.id, parsed.data.sessionId))
    .limit(1);

  if (rows.length === 0 || rows[0].userId !== auth.user.id) {
    return Response.json(
      { ok: false, error: "Report not found." },
      { status: 404 },
    );
  }

  try {
    const minted = await mintShareToken(parsed.data.sessionId);
    const origin = getPublicOrigin(request);
    const url = `${origin}/tools/ai-readiness/share/${encodeURIComponent(minted.rawToken)}`;
    return Response.json({
      ok: true,
      id: minted.id,
      url,
      expiresAt: minted.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("Share mint failed:", err);
    return Response.json(
      { ok: false, error: "Could not create share link. Try again." },
      { status: 500 },
    );
  }
}
