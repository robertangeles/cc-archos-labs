// GET /api/admin/pages
//   List pages for the admin list view. ?includeArchived=1 to surface
//   archived rows. Defaults to non-archived only.
//
// POST /api/admin/pages
//   Create a new page + initial revision in a single tx. Body validated
//   by PageCreateSchema (Zod). Returns 201 with the created row.
//
// Both routes are gated by proxy.ts — unauthenticated callers get 401
// before they reach this handler.

import {
  createPage,
  listPagesForAdmin,
} from "../../../../lib/pages";
import { PageCreateSchema } from "../../../../lib/pages/schema";
import {
  DuplicateSlugError,
  ReservedSlugError,
} from "../../../../lib/pages/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "1";
    const pages = await listPagesForAdmin({ includeArchived });
    return Response.json({ ok: true, data: pages });
  } catch (err) {
    console.error("Pages GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load pages." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = PageCreateSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return Response.json(
      {
        ok: false,
        error: `${first?.path.join(".") || "field"}: ${
          first?.message ?? "Invalid value."
        }`,
      },
      { status: 400 },
    );
  }

  try {
    const created = await createPage(parsed.data);
    return Response.json({ ok: true, data: created }, { status: 201 });
  } catch (err) {
    if (err instanceof ReservedSlugError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 });
    }
    if (err instanceof DuplicateSlugError) {
      return Response.json({ ok: false, error: err.message }, { status: 409 });
    }
    console.error("Pages POST crash:", err);
    return Response.json(
      { ok: false, error: "Could not create page." },
      { status: 500 },
    );
  }
}
