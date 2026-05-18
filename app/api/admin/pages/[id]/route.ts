// GET    /api/admin/pages/[id]  — fetch one page for the admin edit view
// PUT    /api/admin/pages/[id]  — update + append revision (optimistic lock)
// DELETE /api/admin/pages/[id]  — soft-delete via archived_at (NOT a hard
//                                 delete; restore via POST .../restore)
//
// Gated by proxy.ts. Bodies validated against PageUpdateSchema (which
// adds the required `expectedUpdatedAt` field for optimistic locking).

import {
  archivePage,
  getAdminPageById,
  updatePage,
} from "../../../../../lib/pages";
import { PageUpdateSchema } from "../../../../../lib/pages/schema";
import {
  ConcurrentEditError,
  DuplicateSlugError,
  InvalidBlockError,
  PageNotFoundError,
  ReservedSlugError,
} from "../../../../../lib/pages/types";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const page = await getAdminPageById(id);
    if (!page) {
      return Response.json(
        { ok: false, error: "Page not found." },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, data: page });
  } catch (err) {
    console.error("Pages [id] GET crash:", err);
    return Response.json(
      { ok: false, error: "Could not load page." },
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

  const parsed = PageUpdateSchema.safeParse(body);
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
    const updated = await updatePage(id, input, expectedUpdatedAt);
    return Response.json({ ok: true, data: updated });
  } catch (err) {
    if (err instanceof PageNotFoundError) {
      return Response.json({ ok: false, error: err.message }, { status: 404 });
    }
    if (err instanceof ReservedSlugError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 });
    }
    if (err instanceof InvalidBlockError) {
      return Response.json({ ok: false, error: err.message }, { status: 400 });
    }
    if (err instanceof DuplicateSlugError) {
      return Response.json({ ok: false, error: err.message }, { status: 409 });
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
    console.error("Pages [id] PUT crash:", err);
    return Response.json(
      { ok: false, error: "Could not save page." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const archived = await archivePage(id);
    return Response.json({ ok: true, data: archived });
  } catch (err) {
    if (err instanceof PageNotFoundError) {
      return Response.json({ ok: false, error: err.message }, { status: 404 });
    }
    console.error("Pages [id] DELETE crash:", err);
    return Response.json(
      { ok: false, error: "Could not archive page." },
      { status: 500 },
    );
  }
}
