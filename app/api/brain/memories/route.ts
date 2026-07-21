import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { rateLimit } from "@/lib/rate-limit";
import {
  listMemoriesFromDb,
  deleteMemoryFromDb,
  listWorkspaceMemoriesFromDb,
  deactivateWorkspaceMemory,
} from "@/lib/brain/memory";
import { getOrgIdFromCookies, resolveOrgContext } from "@/lib/auth/org-context";

export const runtime = "nodejs";

/**
 * Read the caller's active org, re-validating membership. Returns null when
 * the user has no org — the workspace tier is then simply absent from the
 * response rather than an error, because the private tier still renders.
 */
async function activeOrg(userId: string) {
  return resolveOrgContext(userId, await getOrgIdFromCookies());
}

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const items = await listMemoriesFromDb(auth.user.id);

  // Org-shared workspace tier. Fail-soft and org-scoped: a resolve/query
  // failure degrades the page to the private tier instead of 500ing, matching
  // how the rest of the brain treats memory as best-effort enrichment.
  let workspace: Awaited<ReturnType<typeof listWorkspaceMemoriesFromDb>> = [];
  let canDeleteWorkspace = false;
  try {
    const ctx = await activeOrg(auth.user.id);
    if (ctx) {
      workspace = await listWorkspaceMemoriesFromDb(ctx.orgId);
      // Deleting org-shared knowledge affects every teammate, so it is an
      // owner/admin action. Members read but do not prune.
      canDeleteWorkspace = ctx.role === "owner" || ctx.role === "admin";
    }
  } catch {
    workspace = [];
  }

  // `slug` carries the memory row id, which DELETE uses to scope the delete.
  return NextResponse.json({
    memories: items.map((m) => ({
      slug: m.id,
      title: m.title,
      content: m.content,
      updatedAt: m.updatedAt,
    })),
    workspace: workspace.map((m) => ({
      slug: m.id,
      sourceType: m.sourceType,
      sourceEntityId: m.sourceEntityId,
      entityName: m.entityName,
      content: m.content,
      updatedAt: m.updatedAt,
    })),
    canDeleteWorkspace,
  });
}

export async function DELETE(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const limit = rateLimit(`brain-delete:${auth.user.id}`, 50);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 },
    );
  }

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,199}$/;
  if (!slug || slug.includes("..") || slug.includes("//") || !SLUG_PATTERN.test(slug)) {
    return NextResponse.json(
      { error: "Invalid slug" },
      { status: 400 },
    );
  }

  // Workspace tier: org-scoped soft delete, owner/admin only. The org comes
  // from the server-resolved context, never from the request, so a valid id
  // for another org's row resolves to "not found" rather than a delete.
  if (searchParams.get("scope") === "workspace") {
    const ctx = await activeOrg(auth.user.id);
    if (!ctx) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      return NextResponse.json(
        { error: "Only owners and admins can remove shared workspace memories" },
        { status: 403 },
      );
    }
    const removed = await deactivateWorkspaceMemory(ctx.orgId, slug);
    if (!removed) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  }

  const deleted = await deleteMemoryFromDb(auth.user.id, slug);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
