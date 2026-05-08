import { clearSessionCookie } from "../../../../lib/auth-server";

export const runtime = "nodejs";

export async function POST() {
  await clearSessionCookie();
  return Response.json({ ok: true });
}
