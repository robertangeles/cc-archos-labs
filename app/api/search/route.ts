import { embedText, EmbeddingError } from "../../../lib/embeddings";
import { searchByEmbedding } from "../../../lib/posts/find-similar";
import { searchByText } from "../../../lib/posts/search-fallback";
import { rateLimit, clientIpFromRequest } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  if (q.length < 2 || q.length > 200) {
    return Response.json(
      { error: "Query must be between 2 and 200 characters." },
      { status: 400 },
    );
  }

  const ip = clientIpFromRequest(request);
  const rl = rateLimit(`search:${ip}`, 100);
  if (!rl.ok) {
    return Response.json(
      { error: "Too many searches. Please wait." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((rl.resetAt - Date.now()) / 1000),
          ),
        },
      },
    );
  }

  try {
    const vector = await embedText(q);
    const rows = await searchByEmbedding(vector, { limit: 10 });
    return Response.json(
      { results: rows },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (err) {
    if (err instanceof EmbeddingError) {
      const rows = await searchByText(q, 10);
      return Response.json(
        { results: rows, fallback: true },
        { headers: { "Cache-Control": "private, max-age=60" } },
      );
    }
    return Response.json(
      { error: "Search is temporarily unavailable." },
      { status: 503 },
    );
  }
}
