import "server-only";
import { eq, and, lte, asc, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { scheduledSocialPost, cronHeartbeat, users } from "@/lib/db/schema";
import { publishToSocial } from "@/lib/social/publish";
import type { SocialPlatform } from "@/lib/social/types";
import { buildPublishConfirmEmail } from "@/lib/social/schedule-emails";
import { getResend } from "@/lib/resend";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_LIMIT = 20;
const LOCK_TTL_MS = 5 * 60_000; // 5 minutes
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcessResult {
  ok: true;
  recovered: number;
  processed: number;
  published: number;
  failed: number;
  details: Array<{
    id: string;
    platform: string;
    outcome: "published" | "failed" | "retry";
    detail?: string;
  }>;
}

// ---------------------------------------------------------------------------
// recoverStaleLocks — release rows stranded by a crashed worker
// ---------------------------------------------------------------------------

async function recoverStaleLocks(now: Date): Promise<number> {
  const db = getDb();
  const stale = await db
    .select({ id: scheduledSocialPost.id })
    .from(scheduledSocialPost)
    .where(
      and(
        eq(scheduledSocialPost.status, "processing"),
        lte(scheduledSocialPost.lockedUntil, now),
      ),
    );

  if (stale.length === 0) return 0;

  const ids = stale.map((r) => r.id);
  await db
    .update(scheduledSocialPost)
    .set({
      status: "pending",
      lockedBy: null,
      lockedUntil: null,
      updatedAt: now,
    })
    .where(inArray(scheduledSocialPost.id, ids));

  return ids.length;
}

// ---------------------------------------------------------------------------
// dequeueBatch — FOR UPDATE SKIP LOCKED dequeue
// ---------------------------------------------------------------------------

async function dequeueBatch(
  now: Date,
  workerId: string,
): Promise<
  Array<{
    id: string;
    userId: string;
    platform: string;
    content: string;
    attempts: number;
  }>
> {
  const db = getDb();
  const lockUntil = new Date(now.getTime() + LOCK_TTL_MS);

  return await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: scheduledSocialPost.id,
        userId: scheduledSocialPost.userId,
        platform: scheduledSocialPost.platform,
        content: scheduledSocialPost.content,
        attempts: scheduledSocialPost.attempts,
      })
      .from(scheduledSocialPost)
      .where(
        and(
          eq(scheduledSocialPost.status, "pending"),
          lte(scheduledSocialPost.scheduledFor, now),
        ),
      )
      .orderBy(asc(scheduledSocialPost.scheduledFor))
      .limit(BATCH_LIMIT)
      .for("update", { skipLocked: true });

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);

    await tx
      .update(scheduledSocialPost)
      .set({
        status: "processing",
        lockedBy: workerId,
        lockedUntil: lockUntil,
        attempts: sql`${scheduledSocialPost.attempts} + 1`,
        lastAttemptedAt: now,
        updatedAt: now,
      })
      .where(inArray(scheduledSocialPost.id, ids));

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      platform: r.platform,
      content: r.content,
      // attempts reflects the value BEFORE the +1 above; the actual
      // attempt count for retry logic is +1.
      attempts: r.attempts + 1,
    }));
  });
}

// ---------------------------------------------------------------------------
// settleRow — mark a single row after publish attempt
// ---------------------------------------------------------------------------

async function settleRow(
  id: string,
  now: Date,
  update: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db
    .update(scheduledSocialPost)
    .set({
      ...update,
      lockedBy: null,
      lockedUntil: null,
      updatedAt: now,
    })
    .where(eq(scheduledSocialPost.id, id));
}

// ---------------------------------------------------------------------------
// processScheduledSocial — main entry point
// ---------------------------------------------------------------------------

export async function processScheduledSocial(
  now: Date,
): Promise<ProcessResult> {
  const workerId = `render-cron-${now.getTime()}`;

  // 1. Recover stale locks
  let recovered = 0;
  try {
    recovered = await recoverStaleLocks(now);
  } catch (err) {
    console.error("[cron/social] recoverStaleLocks failed:", err);
  }

  // 2. Dequeue batch
  const batch = await dequeueBatch(now, workerId);

  if (batch.length === 0) {
    return { ok: true, recovered, processed: 0, published: 0, failed: 0, details: [] };
  }

  // 3. Group by (userId, platform) to prevent OAuth token refresh races.
  //    Different groups can run concurrently; same group is serial.
  const groups = new Map<string, typeof batch>();
  for (const row of batch) {
    const key = `${row.userId}::${row.platform}`;
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const details: ProcessResult["details"] = [];
  let published = 0;
  let failed = 0;

  // Process all groups concurrently; rows within a group are serial.
  await Promise.all(
    Array.from(groups.values()).map(async (rows) => {
      for (const row of rows) {
        try {
          const result = await publishToSocial(row.userId, {
            platforms: {
              [row.platform as SocialPlatform]: { content: row.content },
            },
          });

          // publishToSocial returns { results: PlatformPublishResult[] }.
          // We sent exactly one platform, so take the first result.
          const platformResult = result.results[0];

          if (!platformResult) {
            // Defensive: no result returned at all — treat as error
            await settleRow(row.id, now, {
              status: row.attempts >= MAX_ATTEMPTS ? "failed" : "pending",
              errorMessage: "No result returned from publish.",
            });
            if (row.attempts >= MAX_ATTEMPTS) {
              failed++;
              details.push({ id: row.id, platform: row.platform, outcome: "failed", detail: "No result returned from publish." });
            } else {
              details.push({ id: row.id, platform: row.platform, outcome: "retry", detail: "No result returned from publish." });
            }
            continue;
          }

          if (platformResult.status === "success") {
            await settleRow(row.id, now, {
              status: "published",
              publishedUrl: platformResult.publishedUrl ?? null,
              publishedAt: now,
            });
            published++;
            details.push({ id: row.id, platform: row.platform, outcome: "published" });

            try {
              await sendPublishConfirmation(
                row.userId,
                row.platform,
                row.content,
                platformResult.publishedUrl ?? null,
                now.toISOString(),
              );
            } catch (emailErr) {
              console.error("[cron/social] publish confirm email failed for", row.id, emailErr);
            }
          } else if (platformResult.status === "reconnect_required") {
            const msg = `Token expired. Reconnect your ${row.platform} account.`;
            await settleRow(row.id, now, {
              status: "failed",
              errorMessage: msg,
            });
            failed++;
            details.push({ id: row.id, platform: row.platform, outcome: "failed", detail: msg });
          } else {
            // status === "error"
            const errMsg = (platformResult.error ?? "Unknown error").slice(0, 500);
            if (row.attempts >= MAX_ATTEMPTS) {
              await settleRow(row.id, now, {
                status: "failed",
                errorMessage: errMsg,
              });
              failed++;
              details.push({ id: row.id, platform: row.platform, outcome: "failed", detail: errMsg });
            } else {
              await settleRow(row.id, now, {
                status: "pending",
                errorMessage: errMsg,
              });
              details.push({ id: row.id, platform: row.platform, outcome: "retry", detail: errMsg });
            }
          }
        } catch (err) {
          const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
          try {
            if (row.attempts >= MAX_ATTEMPTS) {
              await settleRow(row.id, now, { status: "failed", errorMessage: errMsg });
              failed++;
              details.push({ id: row.id, platform: row.platform, outcome: "failed", detail: errMsg });
            } else {
              await settleRow(row.id, now, { status: "pending", errorMessage: errMsg });
              details.push({ id: row.id, platform: row.platform, outcome: "retry", detail: errMsg });
            }
          } catch (settleErr) {
            console.error("[cron/social] settle failed for", row.id, settleErr);
          }
        }
      }
    }),
  );

  // 4. Heartbeat
  await touchHeartbeat({
    processed: batch.length,
    failed,
    durationMs: Date.now() - now.getTime(),
  });

  return { ok: true, recovered, processed: batch.length, published, failed, details };
}

// ---------------------------------------------------------------------------
// touchHeartbeat — upsert cron_heartbeat row for social publisher
// ---------------------------------------------------------------------------

async function touchHeartbeat(input: {
  processed: number;
  failed: number;
  durationMs: number;
}): Promise<void> {
  try {
    const now = new Date();
    const db = getDb();
    const existing = await db
      .select({ id: cronHeartbeat.id })
      .from(cronHeartbeat)
      .where(eq(cronHeartbeat.id, "social-publisher"))
      .limit(1);

    if (existing[0]) {
      await db
        .update(cronHeartbeat)
        .set({
          lastRunAt: now,
          lastRunJobsProcessed: input.processed,
          lastRunJobsFailed: input.failed,
          lastRunDurationMs: input.durationMs,
          updatedAt: now,
        })
        .where(eq(cronHeartbeat.id, "social-publisher"));
    } else {
      await db.insert(cronHeartbeat).values({
        id: "social-publisher",
        lastRunAt: now,
        lastRunJobsProcessed: input.processed,
        lastRunJobsFailed: input.failed,
        lastRunDurationMs: input.durationMs,
      });
    }
  } catch (err) {
    console.error("[cron/social] heartbeat update failed:", err);
  }
}

// ---------------------------------------------------------------------------
// sendPublishConfirmation — email user on successful scheduled publish
// ---------------------------------------------------------------------------

async function sendPublishConfirmation(
  userId: string,
  platform: string,
  content: string,
  publishedUrl: string | null,
  scheduledFor: string,
): Promise<void> {
  const db = getDb();
  const userRows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userRows[0]?.email) return;

  const email = buildPublishConfirmEmail({
    platform,
    contentPreview: content.slice(0, 200),
    publishedUrl,
    scheduledFor,
    displayTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const { resend, from } = await getResend();
  await resend.emails.send({
    from,
    to: userRows[0].email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
}
