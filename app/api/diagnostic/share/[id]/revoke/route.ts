import {
  getOwningSessionForShareToken,
  revokeShareToken,
} from "../../../../../../lib/share-tokens";
import { getLeadFromCookies } from "../../../../../../lib/auth-server";

export const runtime = "nodejs";

// POST /api/diagnostic/share/[id]/revoke
//   response: { ok: true } | { ok: false, error: string }
//
// Owner-only — caller must be signed in as the lead that owns the
// session this token was minted for. Returns 404 silently for any
// non-matching state so probing doesn't leak token ids.

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const session = await getLeadFromCookies();
  if (!session) {
    return Response.json(
      { ok: false, error: "Sign in to revoke a share link." },
      { status: 401 },
    );
  }

  const owning = await getOwningSessionForShareToken(id);
  if (!owning || owning.leadId !== session.leadId) {
    return Response.json(
      { ok: false, error: "Token not found." },
      { status: 404 },
    );
  }

  await revokeShareToken(id);
  return Response.json({ ok: true });
}
