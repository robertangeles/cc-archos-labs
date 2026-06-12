import "server-only";
import crypto from "node:crypto";
import { eq, and, gte } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { publishLog } from "@/lib/db/schema";
import { getSocialAccount, updateSocialTokens, markDisconnected } from "./token";
import { publishToTwitter, refreshTwitterToken } from "./twitter";
import { publishToLinkedIn, refreshLinkedInToken } from "./linkedin";
import { publishToBluesky, refreshBlueskySession, getBlueskySession } from "./bluesky";
import { getIntegrationConfig } from "@/lib/integration-config";
import type {
  SocialPlatform,
  PublishRequest,
  PublishResult,
  PlatformPublishResult,
} from "./types";

function contentHash(content: string, platform: string): string {
  return crypto
    .createHash("sha256")
    .update(`${platform}:${content}`)
    .digest("hex")
    .slice(0, 16);
}

async function isDuplicate(
  userId: string,
  platform: string,
  hash: string,
): Promise<boolean> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 60_000);
  const rows = await db
    .select({ id: publishLog.id })
    .from(publishLog)
    .where(
      and(
        eq(publishLog.userId, userId),
        eq(publishLog.platform, platform),
        eq(publishLog.contentHash, hash),
        eq(publishLog.status, "success"),
        gte(publishLog.createdAt, cutoff),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function refreshTokenIfExpired(
  userId: string,
  platform: SocialPlatform,
  account: {
    id: string;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
    accountIdentifier: string;
  },
): Promise<{ accessToken: string; failed: boolean }> {
  const now = new Date();
  if (account.tokenExpiresAt && account.tokenExpiresAt > now) {
    return { accessToken: account.accessToken, failed: false };
  }

  if (!account.refreshToken) {
    await markDisconnected(userId, platform);
    return { accessToken: "", failed: true };
  }

  try {
    if (platform === "twitter") {
      const tokens = await refreshTwitterToken(account.refreshToken);
      if (!tokens) {
        await markDisconnected(userId, platform);
        return { accessToken: "", failed: true };
      }
      await updateSocialTokens(account.id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      });
      return { accessToken: tokens.access_token, failed: false };
    }

    if (platform === "linkedin") {
      const config = await getIntegrationConfig();
      const tokens = await refreshLinkedInToken(
        account.refreshToken,
        config.linkedinClientId!,
        config.linkedinClientSecret!,
      );
      if (!tokens) {
        await markDisconnected(userId, platform);
        return { accessToken: "", failed: true };
      }
      await updateSocialTokens(account.id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + (tokens.expires_in ?? 5184000) * 1000),
      });
      return { accessToken: tokens.access_token, failed: false };
    }

    if (platform === "bluesky") {
      try {
        const session = await refreshBlueskySession(account.refreshToken);
        await updateSocialTokens(account.id, {
          accessToken: account.accessToken,
          refreshToken: session.refreshJwt,
        });
        return { accessToken: session.accessJwt, failed: false };
      } catch {
        const session = await getBlueskySession(
          account.accessToken,
          account.accountIdentifier,
        );
        await updateSocialTokens(account.id, {
          accessToken: account.accessToken,
          refreshToken: session.refreshJwt,
        });
        return { accessToken: session.accessJwt, failed: false };
      }
    }

    return { accessToken: account.accessToken, failed: false };
  } catch {
    await markDisconnected(userId, platform);
    return { accessToken: "", failed: true };
  }
}

async function publishToPlatform(
  platform: SocialPlatform,
  accessToken: string,
  providerSubject: string,
  accountIdentifier: string,
  content: string,
): Promise<{ url?: string; error?: string }> {
  if (platform === "twitter") {
    const result = await publishToTwitter(accessToken, content);
    if (!result) return { error: "Twitter API returned no response." };
    return { url: `https://x.com/i/status/${result.id}` };
  }
  if (platform === "linkedin") {
    const urn = await publishToLinkedIn(accessToken, providerSubject, content);
    if (!urn) return { error: "LinkedIn API returned no response." };
    return { url: `https://www.linkedin.com/feed/` };
  }
  if (platform === "bluesky") {
    const result = await publishToBluesky(
      accessToken,
      providerSubject,
      accountIdentifier,
      content,
    );
    return { url: result.url };
  }
  return { error: `Unknown platform: ${platform}` };
}

export async function publishToSocial(
  userId: string,
  request: PublishRequest,
): Promise<PublishResult> {
  const results: PlatformPublishResult[] = [];

  for (const [platformKey, platformContent] of Object.entries(
    request.platforms,
  )) {
    const platform = platformKey as SocialPlatform;
    if (!platformContent?.content) continue;

    const hash = contentHash(platformContent.content, platform);
    const start = Date.now();

    const account = await getSocialAccount(userId, platform);
    if (!account || !account.isConnected) {
      results.push({
        platform,
        status: "reconnect_required",
        error: "Account not connected.",
      });
      continue;
    }

    if (await isDuplicate(userId, platform, hash)) {
      results.push({
        platform,
        status: "error",
        error: "Duplicate content detected. Wait 60 seconds before re-posting.",
      });
      continue;
    }

    const { accessToken, failed } = await refreshTokenIfExpired(
      userId,
      platform,
      account,
    );
    if (failed) {
      results.push({
        platform,
        status: "reconnect_required",
        error: "Token expired. Please reconnect your account.",
      });
      continue;
    }

    try {
      const { url, error } = await publishToPlatform(
        platform,
        accessToken,
        account.providerSubject,
        account.accountIdentifier,
        platformContent.content,
      );

      if (error) {
        results.push({ platform, status: "error", error });
        await logPublish(userId, account.id, platform, platformContent.content, hash, "failed", error, null, Date.now() - start);
        continue;
      }

      results.push({ platform, status: "success", publishedUrl: url });
      await logPublish(userId, account.id, platform, platformContent.content, hash, "success", null, url ?? null, Date.now() - start);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Publish failed.";
      results.push({ platform, status: "error", error: message });
      await logPublish(userId, account.id, platform, platformContent.content, hash, "failed", message, null, Date.now() - start);
    }
  }

  return { results };
}

async function logPublish(
  userId: string,
  socialAccountId: string,
  platform: string,
  content: string,
  hash: string,
  status: string,
  errorMessage: string | null,
  publishedUrl: string | null,
  durationMs: number,
): Promise<void> {
  try {
    const db = getDb();
    await db.insert(publishLog).values({
      userId,
      socialAccountId,
      platform,
      contentPreview: content.slice(0, 500),
      contentHash: hash,
      status,
      errorMessage,
      publishedUrl,
      durationMs,
    });
  } catch {
    console.error("[publish-log] Failed to write publish log entry");
  }
}
