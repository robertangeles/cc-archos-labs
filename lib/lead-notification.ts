import "server-only";
import { getResend } from "./resend";
import { getIntegrationConfig } from "./integration-config";
import {
  buildLeadNotificationEmail,
  type LeadNotificationEmailInput,
} from "./email-templates";

// Internal "you've got a new lead" email. Called from the diagnostic
// report generator after the DB writes succeed. Fire-and-log:
// failures here must not surface to the user — they've already got
// their report, and missing a notification is a Rob-side problem we
// can chase from logs.
//
// Recipient is the same address used by the contact form. One env var,
// one mailbox — fewer places for "wait, where do leads go?" confusion.
// Split into LEAD_NOTIFICATION_EMAIL later if routing diverges.

export interface SendLeadNotificationInput
  extends Omit<LeadNotificationEmailInput, "reportUrl"> {
  /** Origin of the site, used to build the absolute report URL. */
  origin: string;
  sessionId: string;
}

export async function sendLeadNotification(
  input: SendLeadNotificationInput,
): Promise<void> {
  let recipient: string;
  try {
    const config = await getIntegrationConfig();
    recipient = config.contactRecipientEmail;
  } catch (err) {
    console.error(
      "[lead-notification] integration config unreachable; skipping send:",
      err,
    );
    return;
  }
  if (!recipient) {
    console.warn(
      "[lead-notification] contactRecipientEmail empty; skipping send.",
    );
    return;
  }

  try {
    const reportUrl = `${input.origin}/tools/ai-readiness/report/${input.sessionId}`;
    const rendered = buildLeadNotificationEmail({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      jobTitle: input.jobTitle,
      organisation: input.organisation,
      phone: input.phone,
      tier: input.tier,
      tierLabel: input.tierLabel,
      totalScore: input.totalScore,
      isPriority: input.isPriority,
      priorityReasons: input.priorityReasons,
      reportUrl,
    });

    const { resend, from } = await getResend();
    await resend.emails.send({
      from,
      to: recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  } catch (err) {
    console.error("[lead-notification] send failed:", err);
    // Swallow — caller continues, user's report flow unaffected.
  }
}
