import { z } from "zod";
import { generateReport } from "../../../../lib/diagnostic/report";
import {
  rateLimit,
  clientIpFromRequest,
} from "../../../../lib/rate-limit";
import { signLeadSession } from "../../../../lib/auth-lead";
import { setLeadSessionCookie } from "../../../../lib/auth-server";
import { sendLeadNotification } from "../../../../lib/lead-notification";

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

const LeadSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(120),
  lastName: z.string().trim().min(1, "Last name is required").max(120),
  email: z.email({ error: "Enter a valid work email" }).max(254),
  jobTitle: z.string().trim().min(1, "Job title is required").max(200),
  organisation: z
    .string()
    .trim()
    .min(1, "Organisation is required")
    .max(200),
  phone: z.string().trim().max(50).optional(),
});

const RequestSchema = z.object({
  answers: AnswersSchema,
  lead: LeadSchema,
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
      lead: parsed.data.lead,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    // Set lead session cookie so the report page can verify ownership.
    // 30-day TTL per lib/auth-lead.ts.
    const token = await signLeadSession(result.leadId);
    await setLeadSessionCookie(token);

    // Fire the internal "you've got a new lead" notification. Awaited
    // so a transient send error gets logged before we return, but
    // sendLeadNotification swallows its own errors — a failed send
    // never breaks the user flow.
    await sendLeadNotification({
      firstName: parsed.data.lead.firstName,
      lastName: parsed.data.lead.lastName,
      email: parsed.data.lead.email.toLowerCase(),
      jobTitle: parsed.data.lead.jobTitle,
      organisation: parsed.data.lead.organisation,
      phone: parsed.data.lead.phone,
      tier: result.result.tier.tier,
      tierLabel: result.result.tier.label,
      totalScore: result.result.score.total,
      isPriority: result.result.isPriority,
      priorityReasons: result.result.priorityReasons,
      sessionId: result.sessionId,
      origin: new URL(request.url).origin,
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
