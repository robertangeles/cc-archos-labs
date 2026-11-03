import { getIntegrationConfig } from "../../../../../../lib/integration-config";
import { getMe } from "../../../../../../lib/x-articles/client";

export const runtime = "nodejs";

// POST /api/admin/integrations/test/x
//
// Sanity-check the stored X keys with a read-only GET /2/users/me. It signs
// with the four OAuth 1.0a keys, costs nothing and changes nothing; the answer
// names the account the keys act as, so the admin can see it is the right one.
// Same no-in-route-auth pattern as the typesafe/resend test routes (the
// /api/admin path is gated by proxy.ts). The keys never leave this function.

export async function POST() {
  let config: Awaited<ReturnType<typeof getIntegrationConfig>>;
  try {
    config = await getIntegrationConfig();
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Integration config unreachable — admin pwd may need re-set.",
      },
      { status: 503 },
    );
  }

  const { xApiKey, xApiSecret, xAccessToken, xAccessTokenSecret } = config;
  if (!xApiKey || !xApiSecret || !xAccessToken || !xAccessTokenSecret) {
    return Response.json(
      { ok: false, error: "X keys are not fully configured." },
      { status: 400 },
    );
  }

  const result = await getMe(
    {
      apiKey: xApiKey,
      apiSecret: xApiSecret,
      accessToken: xAccessToken,
      accessTokenSecret: xAccessTokenSecret,
    },
    { timeoutMs: 15_000 },
  );

  // 200 below: the test ran; the result is the keys' state.
  if (result.ok) {
    return Response.json({
      ok: true,
      message: `Connected to X as @${result.value.username}.`,
    });
  }
  if (result.kind === "auth") {
    return Response.json(
      {
        ok: false,
        error:
          "X rejected the keys. Check them in the X developer portal and try again.",
        status: result.status,
      },
      { status: 200 },
    );
  }
  if (result.kind === "rate_limited") {
    return Response.json(
      {
        ok: false,
        error: "X is busy (429). Try again in a minute.",
        status: 429,
      },
      { status: 200 },
    );
  }
  // X API is pay-per-use: 402 is how an empty credit balance or a spending
  // cap shows up, which "service may be down" would hide.
  if (result.status === 402) {
    return Response.json(
      {
        ok: false,
        error:
          "X says the account has no API credits left (402). Add credits or raise the spending cap in the X developer console.",
        status: 402,
      },
      { status: 200 },
    );
  }
  if (result.status !== undefined) {
    return Response.json(
      {
        ok: false,
        error: `X responded ${result.status} — service may be down.`,
        status: result.status,
      },
      { status: 200 },
    );
  }
  // detail is the error name only (see client.ts), safe to log.
  console.error("[admin/integrations/test/x] request failed:", result.detail);
  return Response.json(
    {
      ok: false,
      error: "Couldn't reach X. Check your network and try again.",
    },
    { status: 200 },
  );
}
