import { getCurrentUser } from "@/lib/auth/current-user";
import { rateLimit } from "@/lib/rate-limit";
import { appendStepPromptSchema } from "@/lib/workflows/validation";
import { appendStepPrompt } from "@/lib/workflows/service";

export const runtime = "nodejs";

// E1 "make permanent" — append regenerate feedback to a step's persisted prompt.
// Separate from the workflow PUT (which rewrites every step row); this touches
// only the one step. A definition mutation, deliberately NOT the run-amend route.
const APPEND_PROMPT_HOURLY_LIMIT = 60;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) return json({ error: "Authentication required" }, 401);

  const rl = rateLimit(`workflow-step-prompt:${auth.user.id}`, APPEND_PROMPT_HOURLY_LIMIT);
  if (!rl.ok) return json({ error: "Too many changes — slow down and try again shortly." }, 429);

  const { id, stepId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = appendStepPromptSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const result = await appendStepPrompt(id, stepId, auth.user.id, parsed.data.feedback);
  if (result === "not_found") return json({ error: "Not found" }, 404);

  return json({ success: true }, 200);
}
