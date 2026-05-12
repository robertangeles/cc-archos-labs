import "server-only";

// Email templates for the Book-a-Call pipeline. Six functions, each
// returning the same {subject, text, html} shape used elsewhere in the
// project (see lib/email-templates.ts for the same pattern). Plain
// text is the source of truth; the HTML version is a thin, hand-rolled
// wrapper with single-accent link styling — never the Resend default
// template (plan §17.12 / §17.15 AI-slop avoidance).
//
// Brand voice rules (plan §17.12):
//   - Subject lines: concrete + specific. No emoji. No "!". No "Hooray".
//   - Sender display name: "Rob at Archos Labs" (set at the Resend
//     callsite, not in these functions).
//   - Single accent: #3b82f6 — only for inline link colours.
//   - Sign-off: "— Rob".
//   - max-width 480px (matches the §17.12 spec; existing W4 Pass 2 email
//     uses 520 — both are fine for any modern client).

const ACCENT = "#3b82f6";
const FG = "#0f0f0f";
const MUTED = "#6b6b6b";
const PAGE_BG = "#f7f7f5";
const CARD_BG = "#ffffff";
const RULE = "#e5e5e3";
const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

// ----------------------------------------------------------------------------
// Shared HTML helpers — duplicated locally on purpose. If a third email
// module shows up, lift these to lib/email-utils.ts.
// ----------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

// Strip control characters that would break a plain-text body. The
// upstream input is Zod-validated; this is belt-and-braces.
function sanitiseForPlainText(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 2000);
}

// HTML scaffold that wraps a single content block. Caller composes the
// content; this just supplies the page chrome + card. Light theme on
// purpose — most email clients render dark mode awkwardly.
function wrapHtml(innerCardHtml: string): string {
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:${PAGE_BG};font-family:${FONT_STACK};color:${FG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:${CARD_BG};border:1px solid ${RULE};border-radius:8px;padding:32px;">
          ${innerCardHtml}
        </table>
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;padding-top:16px;">
          <tr>
            <td style="font-size:12px;color:#9a9a98;text-align:center;">
              archoslabs.xyz
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ----------------------------------------------------------------------------
// 1. Confirmation email — fires immediately after /api/booking/create.
//    Lands within ~5 min via the scheduled_job queue (D18).
// ----------------------------------------------------------------------------

export interface BookingConfirmationInput {
  prospectFirstName: string;
  // Pre-formatted slot strings in the prospect's timezone (e.g.
  // "Tuesday, 14 May 2026 at 2:00 PM Manila time"). The route handler
  // does the Intl.DateTimeFormat conversion — keeps this file string-
  // formatting-free.
  slotStartLocal: string;
  prospectTimezone: string;
  durationMinutes: number;
  meetUrl: string;
  manageUrl: string; // single URL that lands on the manage page (cancel + reschedule)
  // Auto-matched blog posts from Claude (Lane B). Empty array on v1.
  recommendedReading: { title: string; url: string }[];
}

export function buildBookingConfirmationEmail(
  input: BookingConfirmationInput,
): RenderedEmail {
  const firstName = sanitiseForPlainText(input.prospectFirstName);
  const subject = `You're booked for ${sanitiseForPlainText(input.slotStartLocal)}`;

  const readingLines = input.recommendedReading
    .map((r) => `  - ${sanitiseForPlainText(r.title)}: ${r.url}`)
    .join("\n");

  const text = [
    `Hi ${firstName},`,
    ``,
    `You're on the calendar for ${input.slotStartLocal}.`,
    `${input.durationMinutes} min on Google Meet.`,
    ``,
    `Meet link: ${input.meetUrl}`,
    ``,
    `Need to reschedule or cancel? One click here:`,
    input.manageUrl,
    ``,
    ...(input.recommendedReading.length > 0
      ? [`While you wait, these might be useful:`, readingLines, ``]
      : []),
    `Rob will get a quick brief about you an hour before the call so we can start at depth.`,
    ``,
    `— Rob`,
  ].join("\n");

  const readingHtml =
    input.recommendedReading.length > 0
      ? `<tr><td style="padding-top:24px;font-size:15px;line-height:1.6;color:${FG};">
           While you wait, these might be useful:
           <ul style="padding-left:20px;margin:8px 0;">
             ${input.recommendedReading
               .map(
                 (r) =>
                   `<li style="padding:4px 0;"><a href="${escapeAttr(r.url)}" style="color:${ACCENT};text-decoration:none;">${escapeHtml(r.title)}</a></li>`,
               )
               .join("")}
           </ul>
         </td></tr>`
      : "";

  const cardHtml = `
    <tr>
      <td style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${ACCENT};font-weight:600;">
        You're booked
      </td>
    </tr>
    <tr>
      <td style="padding-top:16px;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;">
        ${escapeHtml(input.slotStartLocal)}
      </td>
    </tr>
    <tr>
      <td style="padding-top:8px;font-size:14px;color:${MUTED};">
        ${input.durationMinutes} min on Google Meet · ${escapeHtml(input.prospectTimezone)}
      </td>
    </tr>
    <tr>
      <td style="padding:24px 0 8px 0;">
        <a href="${escapeAttr(input.meetUrl)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:6px;font-size:15px;font-weight:500;">
          Open Meet link
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding-top:16px;font-size:14px;line-height:1.6;color:${MUTED};">
        Need to reschedule or cancel?
        <a href="${escapeAttr(input.manageUrl)}" style="color:${ACCENT};text-decoration:none;">One click here.</a>
      </td>
    </tr>
    ${readingHtml}
    <tr>
      <td style="padding-top:24px;font-size:15px;line-height:1.6;color:${FG};">
        Rob will get a quick brief about you an hour before the call so we can start at depth.
      </td>
    </tr>
    <tr>
      <td style="padding-top:16px;font-size:15px;color:${FG};">
        — Rob
      </td>
    </tr>
  `;

  return { subject, text, html: wrapHtml(cardHtml) };
}

// ----------------------------------------------------------------------------
// 2. 24h reminder — fires the day before the slot.
// ----------------------------------------------------------------------------

export interface BookingReminder24hInput {
  prospectFirstName: string;
  slotTimeLocal: string; // e.g. "2:00 PM Manila"
  meetUrl: string;
  manageUrl: string;
}

export function buildBookingReminder24hEmail(
  input: BookingReminder24hInput,
): RenderedEmail {
  const firstName = sanitiseForPlainText(input.prospectFirstName);
  const subject = `Tomorrow at ${sanitiseForPlainText(input.slotTimeLocal)}`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Quick heads up — we're on for tomorrow at ${input.slotTimeLocal}.`,
    ``,
    `Meet link: ${input.meetUrl}`,
    ``,
    `Need to move it? ${input.manageUrl}`,
    ``,
    `— Rob`,
  ].join("\n");

  const cardHtml = `
    <tr>
      <td style="font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;">
        Tomorrow at ${escapeHtml(input.slotTimeLocal)}
      </td>
    </tr>
    <tr>
      <td style="padding-top:12px;font-size:15px;line-height:1.6;color:${FG};">
        Quick heads up — we're on for tomorrow.
      </td>
    </tr>
    <tr>
      <td style="padding:24px 0 8px 0;">
        <a href="${escapeAttr(input.meetUrl)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:6px;font-size:15px;font-weight:500;">
          Open Meet link
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding-top:16px;font-size:14px;line-height:1.6;color:${MUTED};">
        Need to move it?
        <a href="${escapeAttr(input.manageUrl)}" style="color:${ACCENT};text-decoration:none;">Reschedule or cancel here.</a>
      </td>
    </tr>
    <tr>
      <td style="padding-top:24px;font-size:15px;color:${FG};">
        — Rob
      </td>
    </tr>
  `;

  return { subject, text, html: wrapHtml(cardHtml) };
}

// ----------------------------------------------------------------------------
// 3. 1h reminder — fires an hour before the slot. Stripped down.
// ----------------------------------------------------------------------------

export interface BookingReminder1hInput {
  prospectFirstName: string;
  meetUrl: string;
}

export function buildBookingReminder1hEmail(
  input: BookingReminder1hInput,
): RenderedEmail {
  const firstName = sanitiseForPlainText(input.prospectFirstName);
  const subject = `In an hour`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Meet link if you need it: ${input.meetUrl}`,
    ``,
    `See you in an hour.`,
    ``,
    `— Rob`,
  ].join("\n");

  const cardHtml = `
    <tr>
      <td style="font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;">
        See you in an hour
      </td>
    </tr>
    <tr>
      <td style="padding:24px 0 8px 0;">
        <a href="${escapeAttr(input.meetUrl)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:6px;font-size:15px;font-weight:500;">
          Open Meet link
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding-top:24px;font-size:15px;color:${FG};">
        — Rob
      </td>
    </tr>
  `;

  return { subject, text, html: wrapHtml(cardHtml) };
}

// ----------------------------------------------------------------------------
// 4. Pre-call brief — internal email to Rob, 1h before the call. Plain-
//    text-feeling layout matching the existing leadNotification style.
// ----------------------------------------------------------------------------

export interface BookingPrecallBriefInput {
  prospectName: string;
  prospectRole: string;
  prospectOrganisation: string;
  slotTimeLocal: string; // e.g. "2:00 PM Manila"
  // Claude output (Lane B): "P1" | "P2" | "P3"
  priorityScore: "P1" | "P2" | "P3";
  priorityReason: string;
  summaryParagraph: string;
  talkingPoints: string[];
  intakeTranscript: { question: string; answer: string }[];
}

export function buildBookingPrecallBriefEmail(
  input: BookingPrecallBriefInput,
): RenderedEmail {
  const name = sanitiseForPlainText(input.prospectName);
  const role = sanitiseForPlainText(input.prospectRole);
  const org = sanitiseForPlainText(input.prospectOrganisation);
  // [ARCHOS BRIEF] prefix matches plan §17.12 — lets Rob filter / pin.
  const subject = `[ARCHOS BRIEF] ${name} / ${org} / ${input.slotTimeLocal}`;

  const lines: string[] = [];
  lines.push(`PROSPECT: ${name}, ${role} at ${org}`);
  lines.push(`SLOT:     ${input.slotTimeLocal}`);
  lines.push("");
  lines.push(`SCORE:    ${input.priorityScore} — ${input.priorityReason}`);
  lines.push("");
  lines.push(`THE ASK:`);
  lines.push(sanitiseForPlainText(input.summaryParagraph));
  lines.push("");
  lines.push(`SUGGESTED TALKING POINTS:`);
  for (const point of input.talkingPoints) {
    lines.push(`  - ${sanitiseForPlainText(point)}`);
  }
  lines.push("");
  lines.push(`INTAKE TRANSCRIPT:`);
  for (const turn of input.intakeTranscript) {
    lines.push(`  Q: ${sanitiseForPlainText(turn.question)}`);
    lines.push(`  A: ${sanitiseForPlainText(turn.answer)}`);
    lines.push("");
  }

  const text = lines.join("\n");

  // Minimal HTML fallback — pre-formatted block so plain text renders
  // as-is in clients that prefer HTML. Internal email; no chrome.
  const html = `<!doctype html><html><body style="font-family:${FONT_STACK};font-size:14px;color:${FG};"><pre style="font-family:inherit;white-space:pre-wrap;margin:0;">${escapeHtml(text)}</pre></body></html>`;

  return { subject, text, html };
}

// ----------------------------------------------------------------------------
// 5. Post-call follow-up — fires 30 min after the slot end. Static
//    template with Rob-fillable summary section (D4b — manual fill at
//    v1; auto-summary in v2 if we add call recording).
// ----------------------------------------------------------------------------

export interface BookingPostcallFollowupInput {
  prospectFirstName: string;
  // The prospect's stated reason at intake — opens the email with the
  // key talking point so it doesn't feel generic.
  intakeTopic: string;
  // Rob may edit before send. Default placeholder if not customised.
  nextStepsBullets: string[];
  // Optional: link to book another call (for paid follow-up funnel).
  rebookUrl?: string;
}

export function buildBookingPostcallFollowupEmail(
  input: BookingPostcallFollowupInput,
): RenderedEmail {
  const firstName = sanitiseForPlainText(input.prospectFirstName);
  const subject = `Today's call — quick recap`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `Thanks for the time today. You came in wanting to talk about ${sanitiseForPlainText(input.intakeTopic)} — here's where we landed and what's next.`,
    ``,
    `NEXT STEPS:`,
    ...input.nextStepsBullets.map(
      (b) => `  - ${sanitiseForPlainText(b)}`,
    ),
    ``,
    ...(input.rebookUrl
      ? [`If a deeper follow-up is useful, grab another time: ${input.rebookUrl}`, ``]
      : []),
    `— Rob`,
  ].join("\n");

  const cardHtml = `
    <tr>
      <td style="font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;">
        Today's call — quick recap
      </td>
    </tr>
    <tr>
      <td style="padding-top:16px;font-size:15px;line-height:1.6;color:${FG};">
        Thanks for the time today. You came in wanting to talk about ${escapeHtml(input.intakeTopic)} — here's where we landed and what's next.
      </td>
    </tr>
    <tr>
      <td style="padding-top:16px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};font-weight:600;">
        Next steps
      </td>
    </tr>
    <tr>
      <td style="padding-top:8px;font-size:15px;line-height:1.6;color:${FG};">
        <ul style="padding-left:20px;margin:0;">
          ${input.nextStepsBullets
            .map(
              (b) => `<li style="padding:4px 0;">${escapeHtml(b)}</li>`,
            )
            .join("")}
        </ul>
      </td>
    </tr>
    ${
      input.rebookUrl
        ? `<tr>
            <td style="padding-top:24px;font-size:14px;line-height:1.6;color:${MUTED};">
              If a deeper follow-up is useful,
              <a href="${escapeAttr(input.rebookUrl)}" style="color:${ACCENT};text-decoration:none;">grab another time here.</a>
            </td>
          </tr>`
        : ""
    }
    <tr>
      <td style="padding-top:24px;font-size:15px;color:${FG};">
        — Rob
      </td>
    </tr>
  `;

  return { subject, text, html: wrapHtml(cardHtml) };
}

// ----------------------------------------------------------------------------
// 6. No-show recovery — fires 1h after slot end if the booking wasn't
//    marked completed in admin (D4d).
// ----------------------------------------------------------------------------

export interface BookingNoshowRecoveryInput {
  prospectFirstName: string;
  rebookUrl: string;
}

export function buildBookingNoshowRecoveryEmail(
  input: BookingNoshowRecoveryInput,
): RenderedEmail {
  const firstName = sanitiseForPlainText(input.prospectFirstName);
  const subject = `Looks like we missed each other`;

  const text = [
    `Hi ${firstName},`,
    ``,
    `No worries — pick a new time when it works:`,
    input.rebookUrl,
    ``,
    `— Rob`,
  ].join("\n");

  const cardHtml = `
    <tr>
      <td style="font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;">
        Looks like we missed each other
      </td>
    </tr>
    <tr>
      <td style="padding-top:16px;font-size:15px;line-height:1.6;color:${FG};">
        No worries — pick a new time when it works:
      </td>
    </tr>
    <tr>
      <td style="padding:24px 0 8px 0;">
        <a href="${escapeAttr(input.rebookUrl)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:6px;font-size:15px;font-weight:500;">
          Pick a new time
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding-top:24px;font-size:15px;color:${FG};">
        — Rob
      </td>
    </tr>
  `;

  return { subject, text, html: wrapHtml(cardHtml) };
}
