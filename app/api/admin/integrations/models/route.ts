import { getIntegrationConfig } from "../../../../../lib/integration-config";

export const runtime = "nodejs";

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
}

let catalogCache: { models: OpenRouterModel[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET() {
  let apiKey: string;
  try {
    const config = await getIntegrationConfig();
    apiKey = config.llmApiKey;
  } catch {
    return Response.json(
      { ok: false, error: "Integration config unreachable." },
      { status: 503 },
    );
  }

  if (!apiKey) {
    return Response.json(
      { ok: false, error: "LLM API key not configured." },
      { status: 400 },
    );
  }

  if (catalogCache && Date.now() - catalogCache.fetchedAt < CACHE_TTL_MS) {
    return Response.json({ ok: true, models: catalogCache.models });
  }

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!resp.ok) {
      return Response.json(
        { ok: false, error: `OpenRouter responded ${resp.status}.` },
        { status: 200 },
      );
    }

    const body = (await resp.json()) as { data?: OpenRouterModel[] };
    const raw = body?.data ?? [];

    const models = raw
      .filter((m) => m.id && m.name)
      .map((m) => {
        const parts = m.id.split("/");
        const provider = parts[0] ?? "unknown";
        return {
          id: m.id,
          name: m.name,
          provider: provider.charAt(0).toUpperCase() + provider.slice(1),
          description: m.description ?? "",
          contextLength: m.context_length ?? null,
        };
      });

    catalogCache = { models: raw, fetchedAt: Date.now() };

    return Response.json({ ok: true, models });
  } catch {
    return Response.json(
      { ok: false, error: "Could not reach OpenRouter." },
      { status: 200 },
    );
  }
}
