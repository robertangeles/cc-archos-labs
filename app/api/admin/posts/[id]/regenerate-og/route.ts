// POST /api/admin/posts/[id]/regenerate-og
//   Synchronously regenerate the OG image for the post. Currently a
//   thin wrapper since lib/og.ts is still stubbed — once the satori +
//   Geist + R2 pipeline lands, this becomes the user-facing trigger
//   without any API change.
//
//   Rate-limited: 30 calls per hour per IP. The regen is cheap (today's
//   stub returns instantly; production will be ~2s of server CPU) but
//   the limit prevents accidental loops.
//
// Gated by proxy.ts.

import { regenerateOgForPost } from "../../../../../../lib/posts-admin";
import { PostNotFoundError } from "../../../../../../lib/posts-admin/types";
import { clientIpFromRequest, rateLimit } from "../../../../../../lib/rate-limit";

export const runtime = "nodejs";

const REGEN_OG_LIMIT_PER_HOUR = 30;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`posts:regen-og:${ip}`, REGEN_OG_LIMIT_PER_HOUR);
  if (!limit.ok) {
    return Response.json(
      {
        ok: false,
        error: "Rate limit reached — try again in an hour.",
        resetAt: new Date(limit.resetAt).toISOString(),
      },
      {
        status: 429,
        headers: {
          "Retry-After": Math.max(
            1,
            Math.ceil((limit.resetAt - Date.now()) / 1000),
          ).toString(),
        },
      },
    );
  }

  try {
    const result = await regenerateOgForPost(id);
    return Response.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof PostNotFoundError) {
      return Response.json({ ok: false, error: err.message }, { status: 404 });
    }
    console.error("Posts regenerate-og crash:", err);
    return Response.json(
      { ok: false, error: "Could not regenerate OG image." },
      { status: 500 },
    );
  }
}
