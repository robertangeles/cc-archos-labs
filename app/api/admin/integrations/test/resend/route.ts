import { getIntegrationConfig } from "../../../../../../lib/integration-config";

export const runtime = "nodejs";

// POST /api/admin/integrations/test/resend
//
// Sanity-check that the configured Resend API key is valid. Calls
// Resend's GET /domains endpoint, which requires only the API key
// and returns 200 + a list (possibly empty) on success. Cheaper than
// sending an actual email, and doesn't pollute any inbox.
//
// 401/403 from Resend → "invalid key" (the typical failure after
// rotation). 5xx → "Resend service issue". Network error → "couldn't
// reach Resend". Anything else → "test failed".

export async function POST() {
  let apiKey: string;
  try {
    const config = await getIntegrationConfig();
    apiKey = config.resendApiKey;
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
      { ok: false, error: "Resend API key not configured." },
      { status: 400 },
    );
  }

  try {
    const resp = await fetch("https://api.resend.com/domains", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (resp.status === 401 || resp.status === 403) {
      return Response.json(
        {
          ok: false,
          error: "Resend rejected the API key. Rotate it and try again.",
          status: resp.status,
        },
        { status: 200 }, // 200 because the test ran successfully; the result is "key invalid"
      );
    }
    if (!resp.ok) {
      return Response.json(
        {
          ok: false,
          error: `Resend responded ${resp.status} — service may be down.`,
          status: resp.status,
        },
        { status: 200 },
      );
    }

    const body = (await resp.json().catch(() => null)) as {
      data?: Array<{ name?: string; status?: string }>;
    } | null;
    const domains = body?.data ?? [];

    return Response.json({
      ok: true,
      message: `Resend API key valid. ${domains.length} domain(s) configured.`,
      domains: domains.map((d) => ({ name: d.name, status: d.status })),
    });
  } catch (err: unknown) {
    console.error("[admin/integrations/test/resend] fetch failed:", err);
    return Response.json(
      {
        ok: false,
        error: "Couldn't reach Resend. Network issue or DNS problem.",
      },
      { status: 200 },
    );
  }
}
