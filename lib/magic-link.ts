import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { magicLinkToken } from "./db/schema";

// Magic-link sign-in helpers for returning leads (W4 Pass 2).
//
// Flow:
//   1. POST /api/auth/lead/request finds a lead by email and calls
//      mintMagicLinkToken(leadId). The raw token comes back as a string.
//      We embed it in the email link.
//   2. GET /api/auth/lead/verify?token=… calls consumeMagicLinkToken(raw).
//      Returns the leadId on success, null on any failure (expired,
//      already used, not found). One-time use enforced by setting
//      consumed_at in the same UPDATE.
//
// The DB never sees the raw token — we store the sha256 digest. The
// link in the email is the only place the raw token exists.

const TOKEN_TTL_MS = 15 * 60 * 1000;

// 32 bytes → 64 hex chars. Generous entropy; effectively unguessable.
const TOKEN_BYTES = 32;

export interface MintedMagicLink {
  /** The raw token to embed in the email link. Never stored. */
  rawToken: string;
  /** When the token expires (UTC). Convenience for email copy. */
  expiresAt: Date;
}

export async function mintMagicLinkToken(
  leadId: string,
): Promise<MintedMagicLink> {
  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  const db = getDb();
  await db.insert(magicLinkToken).values({
    leadId,
    tokenHash,
    expiresAt,
  });

  return { rawToken, expiresAt };
}

export async function consumeMagicLinkToken(
  rawToken: string,
): Promise<{ leadId: string } | null> {
  // Reject obviously malformed tokens before hitting the DB.
  if (!/^[0-9a-f]{64}$/i.test(rawToken)) {
    return null;
  }

  const tokenHash = sha256Hex(rawToken);
  const db = getDb();

  // Single UPDATE: mark consumed only if the row exists, isn't expired,
  // and hasn't been consumed yet. Returning gives us the leadId atomically
  // so a replay race can't double-consume.
  const now = new Date();
  const rows = await db
    .update(magicLinkToken)
    .set({ consumedAt: now, updatedAt: now })
    .where(
      and(
        eq(magicLinkToken.tokenHash, tokenHash),
        gt(magicLinkToken.expiresAt, now),
        isNull(magicLinkToken.consumedAt),
      ),
    )
    .returning({ leadId: magicLinkToken.leadId });

  if (rows.length === 0) {
    return null;
  }

  return { leadId: rows[0].leadId };
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
