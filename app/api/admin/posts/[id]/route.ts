// GET    /api/admin/posts/[id]  — fetch one post for the admin edit view
// PUT    /api/admin/posts/[id]  — update + append revision (optimistic lock)
// DELETE /api/admin/posts/[id]  — soft-delete via archived_at (NOT a hard
//                                  delete; restore via POST .../restore)
//
// Gated by proxy.ts. Bodies validated against PostUpdateSchema (which
// adds the required `expectedUpdatedAt` field for optimistic locking).

import {
  archivePost,
  getAdminPostById,
  updatePost,
} from "../../../../../lib/posts-admin";
import { PostUpdateSchema } from "../../../../../lib/posts-admin/schema";
import {
  ConcurrentEditError,
  DuplicateSlugError,
  InvalidScheduleError,
  PostNotFoundError,
} from "../../../../../lib/posts-admin/types";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const post = await getAdminPostById(id);
    if (!post) {
      return Response.json(
        { ok: false, error: "Post not found." },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, data: post });
  } catch (err) {
    console.error("Posts [id] GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load post." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = PostUpdateSchema.safeParse(body);
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
    const { expectedUpdatedAt, ...input } = parsed.data;
    const result = await updatePost(id, input, expectedUpdatedAt);
    return Response.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof PostNotFoundError) {
      return Response.json({ ok: false, error: err.message }, { status: 404 });
    }
    if (err instanceof DuplicateSlugError) {
      return Response.json({ ok: false, error: err.message }, { status: 409 });
    }
    if (err instanceof InvalidScheduleError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 });
    }
    if (err instanceof ConcurrentEditError) {
      return Response.json(
        {
          ok: false,
          error: err.message,
          reason: "stale_updated_at",
          currentUpdatedAt: err.currentUpdatedAt.toISOString(),
        },
        { status: 409 },
      );
    }
    console.error("Posts [id] PUT crash:", err);
    return Response.json(
      { ok: false, error: "Could not save post." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const archived = await archivePost(id);
    return Response.json({ ok: true, data: archived });
  } catch (err) {
    if (err instanceof PostNotFoundError) {
      return Response.json({ ok: false, error: err.message }, { status: 404 });
    }
    console.error("Posts [id] DELETE crash:", err);
    return Response.json(
      { ok: false, error: "Could not archive post." },
      { status: 500 },
    );
  }
}
