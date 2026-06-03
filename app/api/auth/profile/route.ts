import { z } from "zod";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

export const runtime = "nodejs";

const UpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  currentPassword: z.string().min(1).max(128).optional(),
  newPassword: z.string().min(8).max(128).optional(),
}).refine(
  (d) => !d.newPassword || d.currentPassword,
  { message: "Current password is required to set a new password" },
);

export async function PATCH(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { displayName, currentPassword, newPassword } = parsed.data;
  const db = getDb();

  if (newPassword) {
    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, auth.user.id))
      .limit(1);

    if (!row?.passwordHash) {
      return NextResponse.json(
        { error: "Your account uses Google sign-in. Password cannot be changed here." },
        { status: 400 },
      );
    }

    const valid = await verifyPassword(currentPassword!, row.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }

    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(newPassword),
        ...(displayName ? { displayName } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, auth.user.id));
  } else if (displayName) {
    await db
      .update(users)
      .set({ displayName, updatedAt: new Date() })
      .where(eq(users.id, auth.user.id));
  }

  return NextResponse.json({ ok: true });
}
