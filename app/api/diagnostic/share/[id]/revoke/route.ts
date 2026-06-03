import {
  getOwningSessionForShareToken,
  revokeShareToken,
} from "../../../../../../lib/share-tokens";
import { getCurrentUser } from "../../../../../../lib/auth/current-user";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const auth = await getCurrentUser();
  if (!auth) {
    return Response.json(
      { ok: false, error: "Sign in to revoke a share link." },
      { status: 401 },
    );
  }

  const owning = await getOwningSessionForShareToken(id);
  if (!owning || owning.userId !== auth.user.id) {
    return Response.json(
      { ok: false, error: "Token not found." },
      { status: 404 },
    );
  }

  await revokeShareToken(id);
  return Response.json({ ok: true });
}
