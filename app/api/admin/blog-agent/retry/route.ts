import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../lib/db";
import { contentPlanItem } from "../../../../../lib/db/schema";

// POST /api/admin/blog-agent/retry — put a failed queue item back in line.
//
// Resets attempts to zero as well as status. The sweeper parks an item at
// three attempts, so returning it to `pending` without clearing the counter
// would let it fail once and be parked again immediately, which looks like
// the retry button not working.
//
// Deliberately does NOT run anything. It queues; the scheduled job picks it
// up. Making a button trigger a six-minute paid job synchronously is how an
// admin page becomes something you are afraid to click.

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const id = (body as { id?: unknown })?.id;
  if (typeof id !== "string" || !id) {
    return Response.json({ ok: false, error: "Missing item id." }, { status: 400 });
  }

  try {
    const db = getDb();
    // Guarded on status: only a failed item can be retried. A `running` row
    // reset to pending mid-run would be claimed twice and billed twice.
    const updated = await db
      .update(contentPlanItem)
      .set({
        status: "pending",
        attempts: 0,
        lastError: null,
        lockedBy: null,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(contentPlanItem.id, id), eq(contentPlanItem.status, "failed")))
      .returning({ id: contentPlanItem.id });

    if (updated.length === 0) {
      return Response.json(
        {
          ok: false,
          error:
            "That item is not in a failed state — it may have been retried already, or it is running now.",
        },
        { status: 409 },
      );
    }

    return Response.json({ ok: true, id: updated[0].id });
  } catch (err) {
    console.error("Blog agent retry crash:", err);
    return Response.json(
      { ok: false, error: "Could not queue that item again." },
      { status: 500 },
    );
  }
}
