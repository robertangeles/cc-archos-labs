import "server-only";
import { getIntegrationConfig } from "../integration-config";

// Failure alerting for an unattended pipeline.
//
// The whole design assumes nobody is watching, which means the first signal of
// a stall would otherwise be noticing the blog went quiet a week later. This
// is the counterweight: anything that parks a post or wedges the queue sends
// one email.
//
// Best-effort by construction — a failed alert must never fail the run that
// was trying to report a problem. Every path here swallows and logs.

export type AlertKind =
  | "item-failed"
  | "draft-parked"
  | "queue-dry"
  | "locks-exhausted"
  | "preflight-failed";

export interface AlertInput {
  kind: AlertKind;
  subject: string;
  body: string;
  /** From config. Empty disables alerting entirely. */
  to: string;
}

const SUBJECT_PREFIX = "[ALERT] Blog agent";

export async function sendAlert(input: AlertInput): Promise<boolean> {
  if (!input.to) return false;

  let apiKey: string | null = null;
  let from = "Archos Labs <hello@archoslabs.xyz>";
  try {
    const config = await getIntegrationConfig();
    apiKey = config.resendApiKey ?? null;
    if (config.resendFromEmail) from = config.resendFromEmail;
  } catch (err) {
    console.error("[blog-agent/alert] integration config unavailable:", err);
    return false;
  }
  if (!apiKey) {
    console.error("[blog-agent/alert] no Resend key configured; alert dropped");
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: `${SUBJECT_PREFIX}: ${input.subject}`,
        text: input.body,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[blog-agent/alert] Resend returned ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[blog-agent/alert] send failed:", err);
    return false;
  }
}

/** Human-readable body for a run that did not produce a publishable post. */
export function describeRunFailure(input: {
  outcome: string;
  itemId?: string;
  postId?: string;
  detail?: string;
}): string {
  return [
    `The blog agent finished with outcome: ${input.outcome}.`,
    input.detail ? `\nReason: ${input.detail}` : "",
    input.itemId ? `\nPlan item: ${input.itemId}` : "",
    input.postId
      ? `\nA draft was saved so nothing is lost: /admin/blog/posts/${input.postId}`
      : "\nNo draft was saved.",
    "\n\nNothing was published. Agent posts never go live until you clear the",
    "review flag on them, so this is a quality signal, not an outage.",
  ]
    .filter(Boolean)
    .join("");
}
