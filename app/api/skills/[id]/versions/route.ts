import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import * as skillService from "@/lib/skills/service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const { id } = await params;
  const versions = await skillService.listVersions(id, auth.user.id);
  if (!versions) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ versions });
}
