import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteBrain } from "@/lib/brain/provision";
import { memoryBackend, deleteAllMemoriesFromDb } from "@/lib/brain/memory";

export const runtime = "nodejs";

export async function DELETE() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  if (memoryBackend() === "pgvector") {
    const count = await deleteAllMemoriesFromDb(auth.user.id);
    return NextResponse.json({
      deleted: true,
      pagesDeleted: count,
      pagesDeleteFailed: 0,
    });
  }

  try {
    const result = await deleteBrain(auth.user.id);
    return NextResponse.json({
      deleted: result.localDeleted,
      pagesDeleted: result.pagesDeleted,
      pagesDeleteFailed: result.pagesDeleteFailed,
    });
  } catch {
    return NextResponse.json(
      { error: "Deletion failed" },
      { status: 500 },
    );
  }
}
