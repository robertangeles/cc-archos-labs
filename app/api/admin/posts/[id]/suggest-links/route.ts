// POST /api/admin/posts/[id]/suggest-links
//   Embed the supplied draft body and return up to N most-similar
//   published posts. Used by the editor's "Suggest internal links"
//   drawer.
//
//   The id in the URL is excluded from results (don't suggest linking
//   to self). Body is the draft content as the admin currently sees
//   it in the editor — we embed THAT, not whatever's in the DB.
//
//   Rate-limited: 60 calls per hour per IP. Each call is one
//   OpenRouter embedding (~$0.0003) + one pgvector ANN query
//   (sub-100ms).
//
// Gated by proxy.ts.

import { z } from "zod";
import { suggestInternalLinks } from "../../../../../../lib/posts-admin/similarity";
import { EmbeddingError } from "../../../../../../lib/embeddings";
import { clientIpFromRequest, rateLimit } from "../../../../../../lib/rate-limit";

export const runtime = "nodejs";

const SUGGEST_LIMIT_PER_HOUR = 60;
const DEFAULT_RESULTS = 5;
const MAX_RESULTS = 20;

const SuggestLinksBodySchema = z.object({
  title: z.string().min(1).max(200),
  excerpt: z.string().max(2000).optional().nullable(),
  contentMd: z.string().max(200_000).optional().nullable(),
  limit: z.coerce.number().int().min(1).max(MAX_RESULTS).optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`posts:suggest-links:${ip}`, SUGGEST_LIMIT_PER_HOUR);
  if (!limit.ok) {
    return Response.json(
      {
        ok: false,
        error: "Rate limit reached — try again in an hour.",
        resetAt: new Date(limit.resetAt).toISOString(),
      },
      {
        status: 429,
        headers: {
          "Retry-After": Math.max(
            1,
            Math.ceil((limit.resetAt - Date.now()) / 1000),
          ).toString(),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = SuggestLinksBodySchema.safeParse(body);
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
    const suggestions = await suggestInternalLinks({
      excludePostId: id,
      draftContent: {
        title: parsed.data.title,
        excerpt: parsed.data.excerpt,
        contentMd: parsed.data.contentMd,
      },
      limit: parsed.data.limit ?? DEFAULT_RESULTS,
    });
    return Response.json({ ok: true, data: suggestions });
  } catch (err) {
    if (err instanceof EmbeddingError) {
      // Embedding vendor failure — return 503 so the UI can show a
      // "try again later" message rather than a generic 500.
      return Response.json(
        { ok: false, error: "Suggestions unavailable — try again shortly." },
        { status: 503 },
      );
    }
    console.error("Posts suggest-links crash:", err);
    return Response.json(
      { ok: false, error: "Could not generate suggestions." },
      { status: 500 },
    );
  }
}
