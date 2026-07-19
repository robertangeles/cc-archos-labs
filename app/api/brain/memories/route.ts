import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { rateLimit } from "@/lib/rate-limit";
import { listMemoriesFromDb, deleteMemoryFromDb } from "@/lib/brain/memory";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const items = await listMemoriesFromDb(auth.user.id);
  // `slug` carries the memory row id, which DELETE uses to scope the delete.
  return NextResponse.json({
    memories: items.map((m) => ({
      slug: m.id,
      title: m.title,
      content: m.content,
      updatedAt: m.updatedAt,
    })),
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

  const deleted = await deleteMemoryFromDb(auth.user.id, slug);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
