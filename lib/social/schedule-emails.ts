import "server-only";

// Email template for social post publish confirmations. Returns the
// same {subject, text, html} shape used by lib/booking-emails.ts and
// lib/email-templates.ts. Hand-rolled HTML with single-accent link
// styling — never the Resend default template.
//
// Brand voice: concrete + specific. No emoji. No "!". No "Hooray".
// Sign-off: "-- Archos Labs".

const ACCENT = "#5e6ad2";
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

// Platform slug → human-readable display name
const PLATFORM_DISPLAY: Record<string, string> = {
  twitter: "Twitter / X",
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
};

// ----------------------------------------------------------------------------
// Shared HTML helpers — duplicated locally on purpose (same as
// lib/booking-emails.ts). If a fourth email module shows up, lift
// these to lib/email-utils.ts.
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

function sanitiseForPlainText(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 2000);
}

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
// Publish confirmation email — sent when a scheduled social post goes
// live successfully.
// ----------------------------------------------------------------------------

export function buildPublishConfirmEmail(input: {
  platform: string;
  contentPreview: string;
  publishedUrl: string | null;
  scheduledFor: string;
  displayTimezone: string;
}): RenderedEmail {
  const displayPlatform =
    PLATFORM_DISPLAY[input.platform] ?? input.platform;
  const preview = sanitiseForPlainText(input.contentPreview).slice(0, 200);
  const subject = `Your scheduled ${displayPlatform} post is live`;

  // Plain text version
  const textLines: string[] = [
    `Your scheduled ${displayPlatform} post has been published.`,
    ``,
    `Platform: ${displayPlatform}`,
    `Scheduled for: ${input.scheduledFor} (${input.displayTimezone})`,
    ``,
    `Content:`,
    preview,
    ``,
  ];

  if (input.publishedUrl) {
    textLines.push(`View post: ${input.publishedUrl}`);
    textLines.push(``);
  }

  textLines.push(`-- Archos Labs`);

  const text = textLines.join("\n");

  // HTML version
  const urlRow = input.publishedUrl
    ? `<tr>
        <td style="padding:24px 0 8px 0;">
          <a href="${escapeAttr(input.publishedUrl)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:6px;font-size:15px;font-weight:500;">
            View post
          </a>
        </td>
      </tr>`
    : "";

  const cardHtml = `
    <tr>
      <td style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${ACCENT};font-weight:600;">
        Published
      </td>
    </tr>
    <tr>
      <td style="padding-top:16px;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;">
        ${escapeHtml(displayPlatform)}
      </td>
    </tr>
    <tr>
      <td style="padding-top:8px;font-size:14px;color:${MUTED};">
        Scheduled for ${escapeHtml(input.scheduledFor)} (${escapeHtml(input.displayTimezone)})
      </td>
    </tr>
    <tr>
      <td style="padding-top:20px;font-size:15px;line-height:1.6;color:${FG};border-left:3px solid ${RULE};padding-left:16px;">
        ${escapeHtml(preview)}
      </td>
    </tr>
    ${urlRow}
    <tr>
      <td style="padding-top:24px;font-size:15px;color:${FG};">
        — Archos Labs
      </td>
    </tr>
  `;

  return { subject, text, html: wrapHtml(cardHtml) };
}
