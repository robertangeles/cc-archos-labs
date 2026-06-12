import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../../../../../lib/db";
import { bookingRequest } from "../../../../../../lib/db/schema";

export const runtime = "nodejs";

// PATCH /api/admin/bookings/[id]/status
//
// Flip a booking's status. Used by the admin bookings page to mark
// calls as completed, no-show, or cancelled. The noshow_recovery cron
// job only fires when status='no_show', so this UI is the operational
// trigger for that email.
//
// Gated by proxy.ts — admin session required.

const PatchSchema = z.object({
  status: z.enum(["completed", "no_show", "cancelled"]),
});

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await request.json());
  } catch (err) {
    const msg =
      err instanceof z.ZodError
        ? `Invalid input: ${err.issues[0]?.message ?? "bad shape"}`
        : "Invalid JSON body.";
    return Response.json({ ok: false, error: msg }, { status: 400 });
  }

  try {
    const db = getDb();
    const rows = await db
      .select({ id: bookingRequest.id, status: bookingRequest.status })
      .from(bookingRequest)
      .where(eq(bookingRequest.id, id))
      .limit(1);

    if (rows.length === 0) {
      return Response.json(
        { ok: false, error: "Booking not found." },
        { status: 404 },
      );
    }

    await db
      .update(bookingRequest)
      .set({ status: body.status, updatedAt: new Date() })
      .where(eq(bookingRequest.id, id));

    return Response.json({ ok: true, status: body.status });
  } catch (err) {
    console.error("[admin/bookings/status] PATCH failed:", err);
    return Response.json(
      { ok: false, error: "Could not update booking status." },
      { status: 500 },
    );
  }
}
