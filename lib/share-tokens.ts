import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { assessmentSession, shareToken } from "./db/schema";

// Shareable-report tokens — C-2.
//
// Lets a lead generate a public URL for a specific report so they can
// forward to a CFO / board / collaborator without that recipient
// registering. The raw token lives only in the URL; the DB stores the
// sha256 digest. Properties (locked 2026-05-13):
//   - 7-day TTL.
//   - "One consume, re-views OK": consumed_at stamps on first view for
//     audit; subsequent views still render until expiry or revocation.
//   - Many active tokens per report — independent, each revocable.

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32; // 64 hex chars, ~256 bits entropy

export interface MintedShareToken {
  /** The raw token to embed in the URL. Never stored. */
  rawToken: string;
  /** When the token expires (UTC). */
  expiresAt: Date;
  /** Internal DB id, returned so the owner UI can list / revoke. */
  id: string;
}

/**
 * Issue a new share token for a report. Caller has already verified
 * the requesting user owns the assessment session.
 */
export async function mintShareToken(
  assessmentSessionId: string,
): Promise<MintedShareToken> {
  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  const db = getDb();
  const rows = await db
    .insert(shareToken)
    .values({
      assessmentSessionId,
      tokenHash,
      expiresAt,
    })
    .returning({ id: shareToken.id });

  if (rows.length === 0) {
    throw new Error("mintShareToken: insert returned no row");
  }

  return { rawToken, expiresAt, id: rows[0].id };
}

export interface VerifiedShareToken {
  assessmentSessionId: string;
  shareTokenId: string;
}

/**
 * Validate a raw token from a share URL. Returns the session id if the
 * token exists, isn't expired, and isn't revoked. Stamps `consumed_at`
 * on the first valid lookup (audit only — re-views still resolve).
 * Returns null on any failure path so callers can render a generic
 * 404 without leaking the failure mode.
 */
export async function verifyShareToken(
  rawToken: string,
): Promise<VerifiedShareToken | null> {
  if (!/^[0-9a-f]{64}$/i.test(rawToken)) return null;

  const tokenHash = sha256Hex(rawToken);
  const db = getDb();

  // Single UPDATE that:
  //   - matches by hash
  //   - rejects expired or revoked tokens via the WHERE clause
  //   - COALESCE stamps consumed_at only when it was NULL (preserves
  //     the original first-consume timestamp on subsequent visits)
  //   - returns the session id so the caller can render the report
  const now = new Date();
  const rows = await db
    .update(shareToken)
    .set({
      consumedAt: sql`COALESCE(${shareToken.consumedAt}, ${now})`,
      updatedAt: now,
    })
    .where(
      and(
        eq(shareToken.tokenHash, tokenHash),
        gt(shareToken.expiresAt, now),
        isNull(shareToken.revokedAt),
      ),
    )
    .returning({
      shareTokenId: shareToken.id,
      assessmentSessionId: shareToken.assessmentSessionId,
    });

  if (rows.length === 0) return null;
  return {
    shareTokenId: rows[0].shareTokenId,
    assessmentSessionId: rows[0].assessmentSessionId,
  };
}

/**
 * Revoke a token immediately. Caller has already verified ownership.
 * Idempotent — revoking an already-revoked token returns true and
 * leaves the original revoked_at in place.
 */
export async function revokeShareToken(shareTokenId: string): Promise<boolean> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      shareTokenId,
    )
  ) {
    return false;
  }
  const db = getDb();
  const now = new Date();
  const rows = await db
    .update(shareToken)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(eq(shareToken.id, shareTokenId), isNull(shareToken.revokedAt)),
    )
    .returning({ id: shareToken.id });
  return rows.length > 0;
}

export interface ShareTokenSummary {
  id: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

/**
 * List the active (non-revoked, non-expired) share tokens for a
 * session, newest first. Caller has already verified ownership.
 */
export async function listSessionShareTokens(
  assessmentSessionId: string,
): Promise<ShareTokenSummary[]> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({
      id: shareToken.id,
      expiresAt: shareToken.expiresAt,
      consumedAt: shareToken.consumedAt,
      createdAt: shareToken.createdAt,
    })
    .from(shareToken)
    .where(
      and(
        eq(shareToken.assessmentSessionId, assessmentSessionId),
        isNull(shareToken.revokedAt),
        gt(shareToken.expiresAt, now),
      ),
    )
    .orderBy(desc(shareToken.createdAt));
  return rows;
}

/**
 * Cheap helper used by the revoke route — confirms the lead owns the
 * session that owns the token. Returns the session id if owned, null
 * if either the token doesn't exist or the owner check fails.
 */
export async function getOwningSessionForShareToken(
  shareTokenId: string,
): Promise<{ assessmentSessionId: string; leadId: string | null } | null> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      shareTokenId,
    )
  ) {
    return null;
  }
  const db = getDb();
  const rows = await db
    .select({
      assessmentSessionId: shareToken.assessmentSessionId,
      leadId: assessmentSession.leadId,
    })
    .from(shareToken)
    .innerJoin(
      assessmentSession,
      eq(assessmentSession.id, shareToken.assessmentSessionId),
    )
    .where(eq(shareToken.id, shareTokenId))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0];
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
