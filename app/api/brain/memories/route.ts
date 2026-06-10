import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBrainToken } from "@/lib/brain/provision";
import { callMcp } from "@/lib/brain/client";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const token = await getBrainToken(auth.user.id);
  if (!token) {
    return NextResponse.json({ memories: [] });
  }

  try {
    const response = await callMcp(token, "list_pages", { limit: 100 });
    if (response.error) {
      return NextResponse.json({ memories: [] });
    }

    const pages = parseListResult(response.result);

    const memoriesWithContent = await Promise.all(
      pages.slice(0, 50).map(async (page) => {
        try {
          const pageResp = await callMcp(token, "get_page", { slug: page.slug }, 5000);
          const content = parsePageContent(pageResp.result);
          return {
            slug: page.slug,
            title: page.title || "Memory",
            content: content || page.title || page.slug,
            updatedAt: page.updated_at,
          };
        } catch {
          return {
            slug: page.slug,
            title: page.title || "Memory",
            content: page.title || page.slug,
            updatedAt: page.updated_at,
          };
        }
      }),
    );

    return NextResponse.json({ memories: memoriesWithContent });
  } catch {
    return NextResponse.json({ memories: [] });
  }
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
  if (!slug) {
    return NextResponse.json(
      { error: "slug parameter required" },
      { status: 400 },
    );
  }

  const token = await getBrainToken(auth.user.id);
  if (!token) {
    return NextResponse.json(
      { error: "Brain not provisioned" },
      { status: 404 },
    );
  }

  try {
    const response = await callMcp(token, "delete_page", { slug });
    if (response.error) {
      return NextResponse.json(
        { error: "Could not delete. Try again." },
        { status: 500 },
      );
    }
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json(
      { error: "Could not delete. Try again." },
      { status: 500 },
    );
  }
}

interface PageMeta {
  slug: string;
  title?: string;
  type?: string;
  updated_at?: string;
}

function parseListResult(result: unknown): PageMeta[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.content)) return [];

  for (const item of r.content) {
    if (typeof item === "object" && item !== null && "text" in item) {
      const text = (item as { text: string }).text;
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        continue;
      }
    }
  }
  return [];
}

function parsePageContent(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.content)) return null;

  for (const item of r.content) {
    if (typeof item === "object" && item !== null && "text" in item) {
      const text = (item as { text: string }).text;
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed === "object" && parsed !== null) {
          const p = parsed as Record<string, unknown>;
          if (typeof p.compiled_truth === "string" && p.compiled_truth.length > 0) {
            return p.compiled_truth;
          }
          if (typeof p.content === "string") {
            return String(p.content).replace(/^---[\s\S]*?---\n*/, "").trim();
          }
        }
      } catch {
        return text;
      }
    }
  }
  return null;
}
