import { z } from "zod";
import { listUsers } from "../../../../lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/users — paginated user list for the admin Users page.
//
// Auth: proxy.ts already gates /api/admin/** behind the admin session.
// No additional check here — the request wouldn't reach this handler
// without a valid admin cookie.

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  role: z.enum(["all", "admin", "member"]).optional(),
  active: z.enum(["all", "active", "inactive"]).optional(),
  search: z.string().max(200).optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    role: searchParams.get("role") ?? undefined,
    active: searchParams.get("active") ?? undefined,
    search: searchParams.get("search") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid query params" },
      { status: 400 },
    );
  }

  const result = await listUsers({
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    roleFilter: parsed.data.role ?? "all",
    activeFilter: parsed.data.active ?? "all",
    search: parsed.data.search,
  });

  return Response.json({ ok: true, ...result });
}
