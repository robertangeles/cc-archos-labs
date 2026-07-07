import {
  r2ChatConfigFromIntegration,
  buildR2ChatClient,
  headChatBucket,
} from "../../../../../../lib/r2-chat-documents";

export const runtime = "nodejs";

// POST /api/admin/integrations/test/r2-chat
//
// Sanity-check the configured private R2 (chat documents) credentials with a
// HeadBucket against the configured bucket. No object is written or read.
// Same no-in-route-auth pattern as the openrouter/resend test routes (the
// /api/admin path is gated by middleware).

export async function POST() {
  let config: Awaited<ReturnType<typeof r2ChatConfigFromIntegration>>;
  try {
    config = await r2ChatConfigFromIntegration();
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Integration config unreachable — admin pwd may need re-set.",
      },
      { status: 503 },
    );
  }

  if (!config) {
    return Response.json(
      {
        ok: false,
        error:
          "R2 chat-documents not fully configured. Set account ID, access key, secret, and bucket.",
      },
      { status: 400 },
    );
  }

  try {
    const client = buildR2ChatClient(config);
    await headChatBucket(config, client);
    return Response.json({
      ok: true,
      message: `Connected to private R2 bucket "${config.bucketName}".`,
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    let msg: string;
    if (name === "NotFound" || name === "NoSuchBucket") {
      msg = `Bucket "${config.bucketName}" not found — check the bucket name.`;
    } else if (
      name === "Forbidden" ||
      name === "AccessDenied" ||
      name === "InvalidAccessKeyId" ||
      name === "SignatureDoesNotMatch"
    ) {
      msg =
        "R2 rejected the credentials. Check the Access Key ID + Secret (must be a bucket-scoped token).";
    } else {
      msg = "Couldn't reach R2. Check the account ID and network.";
    }
    console.error("[admin/integrations/test/r2-chat] head failed:", err);
    return Response.json({ ok: false, error: msg }, { status: 200 });
  }
}
