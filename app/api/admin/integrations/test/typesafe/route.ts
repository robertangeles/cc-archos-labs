import { getIntegrationConfig } from "../../../../../../lib/integration-config";

export const runtime = "nodejs";

// POST /api/admin/integrations/test/typesafe
//
// Sanity-check the stored TypeSafe (Jev) API key with a read-only
// GET /v1/models. It lists the models the key can use, costs nothing and
// changes nothing. Observed live on 2026-10-25: a bad key returns 401
// {"detail":{"error_type":"authentication_error",...}}, no key returns 403.
// Same no-in-route-auth pattern as the resend/openrouter test routes (the
// /api/admin path is gated by proxy.ts). The key never leaves this function.

const MODELS_URL = "https://api.typesafe.ai/v1/models";

export async function POST() {
  let apiKey: string | null;
  try {
    const config = await getIntegrationConfig();
    apiKey = config.typesafeApiKey;
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
      { ok: false, error: "TypeSafe (Jev) API key not configured." },
      { status: 400 },
    );
  }

  try {
    const resp = await fetch(MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    // 200 below: the test ran; the result is the key's state.
    if (resp.status === 401 || resp.status === 403) {
      return Response.json(
        {
          ok: false,
          error:
            "TypeSafe rejected the API key. Check it in the TypeSafe console and try again.",
          status: resp.status,
        },
        { status: 200 },
      );
    }
    if (resp.status === 429 || resp.status === 529) {
      return Response.json(
        {
          ok: false,
          error: `TypeSafe is busy (${resp.status}). Try again in a minute.`,
          status: resp.status,
        },
        { status: 200 },
      );
    }
    if (!resp.ok) {
      return Response.json(
        {
          ok: false,
          error: `TypeSafe responded ${resp.status} — service may be down.`,
          status: resp.status,
        },
        { status: 200 },
      );
    }

    // The list shape is not documented for sure; count only when it is an
    // array we recognise, otherwise just confirm the key works.
    let count: number | null = null;
    try {
      const body: unknown = await resp.json();
      const list = Array.isArray(body)
        ? body
        : ((body as { data?: unknown; models?: unknown })?.data ??
          (body as { models?: unknown })?.models);
      if (Array.isArray(list)) count = list.length;
    } catch {
      // Non-JSON 200: the key still worked.
    }
    return Response.json({
      ok: true,
      message:
        count === null
          ? "Connected to TypeSafe."
          : `Connected to TypeSafe. ${count} model${count === 1 ? "" : "s"} available.`,
    });
  } catch (err) {
    // Log the error name only: a fetch error object can carry the request.
    console.error(
      "[admin/integrations/test/typesafe] request failed:",
      err instanceof Error ? err.name : "unknown",
    );
    return Response.json(
      {
        ok: false,
        error: "Couldn't reach TypeSafe. Check your network and try again.",
      },
      { status: 200 },
    );
  }
}
