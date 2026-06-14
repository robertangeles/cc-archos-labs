import { getCurrentUser } from "@/lib/auth/current-user";
import { executeWorkflowSchema } from "@/lib/workflows/validation";
import { executeWorkflowStreaming } from "@/lib/workflows/executor";
import * as workflowService from "@/lib/workflows/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getCurrentUser();
  if (!auth) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id } = await params;

  const wf = await workflowService.getWorkflow(id, auth.user.id);
  if (!wf) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = executeWorkflowSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const gen = executeWorkflowStreaming(
          id,
          auth.user.id,
          parsed.data.inputs,
        );
        for await (const event of gen) {
          const line = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(line));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Execution failed";
        const line = `data: ${JSON.stringify({ type: "error", error: msg })}\n\n`;
        controller.enqueue(encoder.encode(line));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
