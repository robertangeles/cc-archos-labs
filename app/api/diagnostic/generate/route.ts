import { z } from "zod";
import { generateReport } from "../../../../lib/diagnostic/report";
import {
  rateLimit,
  clientIpFromRequest,
} from "../../../../lib/rate-limit";

export const runtime = "nodejs";

// Each report costs ~$0.03 in OpenRouter spend (Claude Sonnet 4.6 at
// ~1.8K input + 1.5K output tokens). Capping at 5 reports per IP per
// hour bounds a single attacker at ~$0.15/hr — manageable while not
// throttling legitimate testing. Tune up for launch once we see real
// traffic patterns.
const REPORTS_PER_IP_PER_HOUR = 5;

const AnswersSchema = z
  .record(
    z.string().regex(/^q\d+[a-z]?$/, "Invalid question id"),
    z.enum(["A", "B", "C", "D", "E"]),
  )
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "No answers supplied",
  });

const RequestSchema = z.object({
  answers: AnswersSchema,
});

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`diagnostic:${ip}`, REPORTS_PER_IP_PER_HOUR);
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "Too many reports requested. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((limit.resetAt - Date.now()) / 1000),
          ),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return Response.json(
      { ok: false, error: first?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  // Q12 is the final question of every flow — its absence means the
  // session isn't complete. Reject rather than burn an OpenRouter call
  // on a partial set.
  if (!parsed.data.answers.q12) {
    return Response.json(
      { ok: false, error: "Assessment incomplete — Q12 missing." },
      { status: 400 },
    );
  }

  try {
    const result = await generateReport({
      answers: parsed.data.answers,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return Response.json({ ok: true, sessionId: result.sessionId });
  } catch (err) {
    console.error("Diagnostic generate crash:", err);
    return Response.json(
      {
        ok: false,
        error:
          "We couldn't generate your report right now. Please try again.",
      },
      { status: 500 },
    );
  }
}
