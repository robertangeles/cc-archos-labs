import { getCurrentUser } from "@/lib/auth/current-user";
import { rateLimit } from "@/lib/rate-limit";
import { regenerateStepSchema } from "@/lib/workflows/validation";
import { getRun } from "@/lib/workflows/runs";
import {
  preflightRegenerate,
  regenerateStream,
  tryAcquireRun,
  releaseRun,
} from "@/lib/workflows/regenerate";
import * as workflowService from "@/lib/workflows/service";

export const runtime = "nodejs";
export const maxDuration = 300;

// Per-user cap on a route that mints paid LLM calls. In-memory + per-instance
// (see lib/rate-limit.ts) — adequate while single-user; swap for a durable
// limiter when this runs multi-instance or faces the public.
const REGENERATE_HOURLY_LIMIT = 30;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string; stepId: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) return json({ error: "Authentication required" }, 401);

  const rl = rateLimit(`workflow-regenerate:${auth.user.id}`, REGENERATE_HOURLY_LIMIT);
  if (!rl.ok) return json({ error: "Too many regenerations — slow down and try again shortly." }, 429);

  const { id, runId, stepId } = await params;

  // Ownership + current workflow steps in one call.
  const wf = await workflowService.getWorkflow(id, auth.user.id);
  if (!wf) return json({ error: "Not found" }, 404);

  const run = await getRun(runId, id);
  if (!run) return json({ error: "Run not found" }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = regenerateStepSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }
  const { feedback, rerunDownstream, overrideModel } = parsed.data;

  // Preflight returns proper HTTP status BEFORE the stream opens (an SSE body is
  // always 200, so eligibility/drift must be decided here).
  const preflight = preflightRegenerate({
    currentSteps: wf.steps,
    snapshot: run.stepResults,
    targetStepId: stepId,
    rerunDownstream,
  });
  if (!preflight.ok) return json({ error: preflight.reason }, preflight.code);

  // One regenerate per run at a time (last-write-wins is still possible across
  // instances; this covers the common single-instance two-tab case).
  if (!tryAcquireRun(runId)) {
    return json({ error: "This run is already regenerating. Wait for it to finish." }, 409);
  }

  const gen = regenerateStream({
    workflowId: id,
    runId,
    userId: auth.user.id,
    currentSteps: wf.steps,
    run,
    targetStepId: stepId,
    feedback,
    rerunDownstream,
    overrideModel,
    preflight,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of gen) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Regeneration failed";
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`));
        } catch {
          /* stream already gone */
        }
      } finally {
        releaseRun(runId);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    async cancel() {
      // Client disconnected — end the generator so its finally persists the
      // completed-so-far amend (a billed result is never lost), then release.
      await gen.return(undefined);
      releaseRun(runId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
