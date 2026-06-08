import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  parseSlashCommand,
  getSkillAutocomplete,
} from "@/lib/chat/slash-commands";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const prefix = searchParams.get("prefix") ?? "";
  const skills = await getSkillAutocomplete(prefix, auth.user.id);
  return NextResponse.json({ skills });
}

export async function POST(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { text } = body as { text?: string };
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const result = await parseSlashCommand(text, auth.user.id);
  if (!result) {
    return NextResponse.json(
      { error: "Skill not found. Type /run to see available skills." },
      { status: 404 },
    );
  }

  return NextResponse.json(result);
}
