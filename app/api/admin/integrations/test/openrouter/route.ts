import { getIntegrationConfig } from "../../../../../../lib/integration-config";

export const runtime = "nodejs";

// POST /api/admin/integrations/test/openrouter
//
// Sanity-check the configured OpenRouter API key. Calls GET /models
// which requires only the API key and returns 200 + a list on success.
// No tokens consumed, no model call made.

export async function POST() {
  let apiKey: string;
  try {
    const config = await getIntegrationConfig();
    apiKey = config.llmApiKey;
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Integration config unreachable — admin pwd may need re-set.",
      },
      { status: 503 },
    );
  }

  if (!apiKey) {
    return Response.json(
      { ok: false, error: "LLM API key not configured." },
      { status: 400 },
    );
  }

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (resp.status === 401 || resp.status === 403) {
      return Response.json(
        {
          ok: false,
          error: "OpenRouter rejected the API key. Rotate it and try again.",
          status: resp.status,
        },
        { status: 200 },
      );
    }
    if (!resp.ok) {
      return Response.json(
        {
          ok: false,
          error: `OpenRouter responded ${resp.status} — service may be down.`,
          status: resp.status,
        },
        { status: 200 },
      );
    }

    const body = (await resp.json().catch(() => null)) as {
      data?: Array<{ id: string }>;
    } | null;
    const modelCount = body?.data?.length ?? 0;

    return Response.json({
      ok: true,
      message: `OpenRouter API key valid. ${modelCount} model(s) available.`,
      modelCount,
    });
  } catch (err) {
    console.error("[admin/integrations/test/openrouter] fetch failed:", err);
    return Response.json(
      {
        ok: false,
        error: "Couldn't reach OpenRouter. Network issue or DNS problem.",
      },
      { status: 200 },
    );
  }
}
