import "server-only";
import { eq } from "drizzle-orm";
import { getDb, type DB } from "./db";
import { cronHeartbeat } from "./db/schema";

// Shared heartbeat for new cron routes (the three existing writers keep their
// own inline copies; migrating them is a listed follow-up). One row per cron
// id in cron_heartbeat, written as a single atomic upsert so two overlapping
// runs cannot race a select-then-insert into a duplicate-key error.

export interface HeartbeatStats {
  processed: number;
  failed: number;
  durationMs: number;
}

export interface Heartbeat extends HeartbeatStats {
  lastRunAt: Date;
}

export async function touchHeartbeat(
  id: string,
  stats: HeartbeatStats,
  db: DB = getDb(),
): Promise<void> {
  try {
    const now = new Date();
    const values = {
      lastRunAt: now,
      lastRunJobsProcessed: stats.processed,
      lastRunJobsFailed: stats.failed,
      lastRunDurationMs: stats.durationMs,
      updatedAt: now,
    };
    await db
      .insert(cronHeartbeat)
      .values({ id, ...values })
      .onConflictDoUpdate({ target: cronHeartbeat.id, set: values });
  } catch (err) {
    // A heartbeat failure is a soft signal: the cron's work succeeded, and the
    // health check going stale is the alert.
    console.error(`[cron-heartbeat] ${id} update failed:`, err);
  }
}

export async function readHeartbeat(
  id: string,
  db: DB = getDb(),
): Promise<Heartbeat | null> {
  const rows = await db
    .select({
      lastRunAt: cronHeartbeat.lastRunAt,
      processed: cronHeartbeat.lastRunJobsProcessed,
      failed: cronHeartbeat.lastRunJobsFailed,
      durationMs: cronHeartbeat.lastRunDurationMs,
    })
    .from(cronHeartbeat)
    .where(eq(cronHeartbeat.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, durationMs: row.durationMs ?? 0 };
}
