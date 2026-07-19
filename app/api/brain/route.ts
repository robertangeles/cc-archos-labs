import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteAllMemoriesFromDb } from "@/lib/brain/memory";

export const runtime = "nodejs";

export async function DELETE() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const count = await deleteAllMemoriesFromDb(auth.user.id);
  return NextResponse.json({
    deleted: true,
    pagesDeleted: count,
    pagesDeleteFailed: 0,
  });
}
