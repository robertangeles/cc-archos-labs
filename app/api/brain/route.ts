import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteBrain } from "@/lib/brain/provision";

export const runtime = "nodejs";

export async function DELETE() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  try {
    await deleteBrain(auth.user.id);
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Deletion failed" },
      { status: 500 },
    );
  }
}
