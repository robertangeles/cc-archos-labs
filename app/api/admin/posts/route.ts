// GET /api/admin/posts
//   List posts for the admin Posts table. Query params drive filtering:
//     ?status=all|draft|scheduled|published|needs_review|archived
//     ?search=<title-or-slug substring>
//     ?categoryId=<uuid>
//     ?page=<n>&pageSize=<25-default-max-100>
//
// POST /api/admin/posts
//   Create a new post + initial revision in a single tx. Body validated
//   by PostCreateSchema (Zod). Returns 201 with { post, sideEffects }.
//
// Both routes are gated by proxy.ts — unauthenticated callers get 401
// before they reach this handler.

import { createPost, listPostsForAdmin } from "../../../../lib/posts-admin";
import {
  PostCreateSchema,
  PostListQuerySchema,
} from "../../../../lib/posts-admin/schema";
import {
  DuplicateSlugError,
  InvalidScheduleError,
} from "../../../../lib/posts-admin/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    // Build a flat object from searchParams so Zod can coerce the
    // numeric / enum fields. URLSearchParams returns string-only.
    const raw: Record<string, string> = {};
    for (const [k, v] of url.searchParams.entries()) {
      raw[k] = v;
    }
    const parsed = PostListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return Response.json(
        {
          ok: false,
          error: `${first?.path.join(".") || "query"}: ${
            first?.message ?? "Invalid query."
          }`,
        },
        { status: 400 },
      );
    }

    const result = await listPostsForAdmin(parsed.data);
    return Response.json({ ok: true, data: result });
  } catch (err) {
    console.error("Posts GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load posts." },
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

  const parsed = PostCreateSchema.safeParse(body);
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
    const result = await createPost(parsed.data);
    return Response.json({ ok: true, data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateSlugError) {
      return Response.json({ ok: false, error: err.message }, { status: 409 });
    }
    if (err instanceof InvalidScheduleError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error("Posts POST crash:", err);
    return Response.json(
      { ok: false, error: "Could not create post." },
      { status: 500 },
    );
  }
}
