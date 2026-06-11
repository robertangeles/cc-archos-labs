import "server-only";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { socialAccount } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/booking-crypto";
import type { SocialPlatform, SocialOAuthTokens } from "./types";

export async function storeSocialTokens(
  userId: string,
  platform: SocialPlatform,
  tokens: SocialOAuthTokens,
): Promise<void> {
  const db = getDb();
  const accessTokenEncrypted = encrypt(tokens.accessToken);
  const refreshTokenEncrypted = tokens.refreshToken
    ? encrypt(tokens.refreshToken)
    : null;

  await db
    .insert(socialAccount)
    .values({
      userId,
      platform,
      providerSubject: tokens.accountId,
      accountIdentifier: tokens.accountName,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt: tokens.expiresAt ?? null,
      isConnected: true,
    })
    .onConflictDoUpdate({
      target: [socialAccount.userId, socialAccount.platform],
      set: {
        providerSubject: tokens.accountId,
        accountIdentifier: tokens.accountName,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiresAt: tokens.expiresAt ?? null,
        isConnected: true,
        linkedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function updateSocialTokens(
  accountId: string,
  tokens: Pick<SocialOAuthTokens, "accessToken" | "refreshToken" | "expiresAt">,
): Promise<void> {
  const db = getDb();
  await db
    .update(socialAccount)
    .set({
      accessTokenEncrypted: encrypt(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken
        ? encrypt(tokens.refreshToken)
        : undefined,
      tokenExpiresAt: tokens.expiresAt ?? undefined,
      isConnected: true,
      updatedAt: new Date(),
    })
    .where(eq(socialAccount.id, accountId));
}

export async function getSocialAccount(
  userId: string,
  platform: SocialPlatform,
): Promise<{
  id: string;
  accountIdentifier: string;
  providerSubject: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  isConnected: boolean;
} | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: socialAccount.id,
      accountIdentifier: socialAccount.accountIdentifier,
      providerSubject: socialAccount.providerSubject,
      accessTokenEncrypted: socialAccount.accessTokenEncrypted,
      refreshTokenEncrypted: socialAccount.refreshTokenEncrypted,
      tokenExpiresAt: socialAccount.tokenExpiresAt,
      isConnected: socialAccount.isConnected,
    })
    .from(socialAccount)
    .where(
      and(
        eq(socialAccount.userId, userId),
        eq(socialAccount.platform, platform),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    accountIdentifier: row.accountIdentifier,
    providerSubject: row.providerSubject,
    accessToken: row.accessTokenEncrypted
      ? decrypt(row.accessTokenEncrypted)
      : "",
    refreshToken: row.refreshTokenEncrypted
      ? decrypt(row.refreshTokenEncrypted)
      : null,
    tokenExpiresAt: row.tokenExpiresAt,
    isConnected: row.isConnected,
  };
}

export async function getSocialAccountsForUser(
  userId: string,
): Promise<
  Array<{
    id: string;
    platform: string;
    accountIdentifier: string;
    isConnected: boolean;
    linkedAt: Date;
  }>
> {
  const db = getDb();
  return db
    .select({
      id: socialAccount.id,
      platform: socialAccount.platform,
      accountIdentifier: socialAccount.accountIdentifier,
      isConnected: socialAccount.isConnected,
      linkedAt: socialAccount.linkedAt,
    })
    .from(socialAccount)
    .where(eq(socialAccount.userId, userId));
}

export async function deleteSocialAccount(
  userId: string,
  platform: SocialPlatform,
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(socialAccount)
    .where(
      and(
        eq(socialAccount.userId, userId),
        eq(socialAccount.platform, platform),
      ),
    )
    .returning({ id: socialAccount.id });

  return result.length > 0;
}

export async function markDisconnected(
  userId: string,
  platform: SocialPlatform,
): Promise<void> {
  const db = getDb();
  await db
    .update(socialAccount)
    .set({ isConnected: false, updatedAt: new Date() })
    .where(
      and(
        eq(socialAccount.userId, userId),
        eq(socialAccount.platform, platform),
      ),
    );
}
