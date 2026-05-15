import "server-only";

// Email templates for outbound mail. Plain-text bodies are the source
// of truth; HTML versions exist only so well-behaved mail clients render
// the CTA as a button. We never interpolate user-provided content into
// HTML to keep this side of the wire free of escaping concerns.

export interface MagicLinkEmailInput {
  firstName: string;
  magicLinkUrl: string;
  /** TTL minutes for the link. Used in the body copy. */
  expiresInMinutes: number;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function buildMagicLinkEmail(input: MagicLinkEmailInput): RenderedEmail {
  const firstNameSafe = sanitiseForPlainText(input.firstName);
  const expires = input.expiresInMinutes;
  const url = input.magicLinkUrl;

  const subject = "Your Archos Labs sign-in link";

  const text =
    `Hi ${firstNameSafe},\n\n` +
    `Here's the link to your AI Readiness Assessment. ` +
    `The link expires in ${expires} minutes and can only be used once.\n\n` +
    `${url}\n\n` +
    `If you didn't request this email, you can safely ignore it — ` +
    `no one can access your account without this link.\n\n` +
    `— Rob Angeles\n` +
    `Archos Labs\n\n` +
    `Built by practitioners. For programs that can't afford to get it wrong.\n` +
    `archoslabs.xyz`;

  // HTML is the polished render; text above stays the source of truth.
  //
  // Why this is the way it is (v2 — exec-grade rendering):
  //
  // - Bulletproof button. Outlook desktop strips display:inline-block +
  //   background on `<a>`, and Outlook.com web strips background on
  //   styled anchors entirely. v1 rendered as a plain text link in both.
  //   v2 uses the standard table+VML pattern: a `<td bgcolor>` wraps the
  //   `<a>` so the colour survives even when the anchor is reduced to
  //   text, and `<v:roundrect>` inside an `<!--[if mso]>` block draws a
  //   real button for Outlook desktop's Word rendering engine.
  // - Table-row spacing, not div padding. Stacked `<div>`s with
  //   padding-top collapse in some clients (the v1 screenshot showed
  //   "Hi Rob, Use the link below" running together). Putting each
  //   block in its own `<tr><td>` preserves the gaps reliably.
  // - 4px brand stripe at the top of the card. A small "this was
  //   crafted on purpose" device — costs nothing and an exec scanning
  //   their inbox registers it without registering why.
  // - Signature from Rob inside the card. The practitioner brand says
  //   the work is done by a person, not an agency. A faceless
  //   "— Archos Labs" signature contradicts that. Goes inside the card
  //   so it reads as part of the letter, not a footer.
  // - Tagline footer outside the card. Brand reinforcement, separated
  //   from the personal sign-off so the two don't fight.
  // - `mso-line-height-rule:exactly` on the brand stripe so the 4px row
  //   doesn't expand to font-size + leading on Outlook desktop.
  // - Logo + wordmark masthead outside the card. The wordmark stands
  //   alone if the client blocks images.
  // - color-scheme:light hints at preferred rendering. Outlook web /
  //   Gmail dark mode still override, but Apple Mail + Apple Mail dark
  //   mode respect it.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Your Archos Labs sign-in link</title>
<style>
  /* Outlook.com web dark mode: the engine rewrites #ffffff text to a
     dark colour after inline styles resolve, so a plain
     style="color:#fff !important" on the button loses. [data-ogsc]
     and [data-ogsb] are Outlook-web-specific attribute hooks applied
     AFTER dark-mode transformation, so anything keyed on them wins. */
  [data-ogsc] .cta-button,
  [data-ogsc] .cta-button-text {
    color: #ffffff !important;
  }
  [data-ogsb] .cta-button-cell {
    background-color: #5e6ad2 !important;
  }
</style>
<!--[if mso]>
<style>
* { font-family: 'Segoe UI', Helvetica, Arial, sans-serif !important; }
</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background:#f8f8f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f0f0f;-webkit-font-smoothing:antialiased;">
  <div style="display:none;visibility:hidden;mso-hide:all;font-size:1px;color:#f8f8f6;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    Your sign-in link to open your AI Readiness Assessment report.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8f8f6;">
    <tr>
      <td align="center" style="padding:40px 16px 32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
          <tr>
            <td style="padding-bottom:24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" style="padding-right:14px;">
                    <img src="https://archoslabs.xyz/images/logo.png" alt="" width="56" height="56" style="display:block;width:56px;height:56px;border:0;outline:none;text-decoration:none;">
                  </td>
                  <td valign="middle" style="font-size:30px;font-weight:600;letter-spacing:-0.015em;color:#0f0f0f;line-height:1;">
                    Archos Labs
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e5e5e3;border-radius:10px;">
          <tr>
            <td bgcolor="#5e6ad2" height="4" style="background:#5e6ad2;height:4px;line-height:4px;font-size:0;mso-line-height-rule:exactly;border-top-left-radius:10px;border-top-right-radius:10px;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:36px 44px 0 44px;font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:#0f0f0f;">
              Open your report
            </td>
          </tr>
          <tr>
            <td style="padding:20px 44px 0 44px;font-size:15px;line-height:1.6;color:#1f1f1f;">
              Hi ${escapeHtml(firstNameSafe)},
            </td>
          </tr>
          <tr>
            <td style="padding:12px 44px 0 44px;font-size:15px;line-height:1.6;color:#1f1f1f;">
              Here's the link to your AI Readiness Assessment. The link expires in ${expires} minutes and can only be used once.
            </td>
          </tr>
          <tr>
            <td style="padding:28px 44px 0 44px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="cta-button-cell" bgcolor="#5e6ad2" style="background-color:#5e6ad2;border-radius:8px;mso-padding-alt:0;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeAttr(url)}" style="height:46px;v-text-anchor:middle;width:200px;" arcsize="18%" stroke="f" fillcolor="#5e6ad2">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;">Open my report</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <a class="cta-button" href="${escapeAttr(url)}" style="display:inline-block;background:#5e6ad2;color:#ffffff !important;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:500;letter-spacing:-0.005em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1;">
                      <span class="cta-button-text" style="color:#ffffff !important;mso-color-alt:#ffffff;">Open my report</span>
                    </a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 44px 0 44px;">
              <div style="border-top:1px solid #ececea;font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 44px 0 44px;font-size:13px;line-height:1.6;color:#6b6b6b;">
              If you didn't request this email, you can safely ignore it — no one can access your account without this link.
            </td>
          </tr>
          <tr>
            <td style="padding:24px 44px 36px 44px;font-size:14px;line-height:1.5;color:#0f0f0f;">
              <div style="font-weight:500;">— Rob Angeles</div>
              <div style="color:#6b6b6b;font-size:13px;padding-top:2px;">Archos Labs</div>
            </td>
          </tr>
        </table>
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;padding-top:24px;">
          <tr>
            <td align="center" style="font-size:12px;line-height:1.7;color:#8a8a88;text-align:center;">
              <div>
                Built by practitioners. For programs that can't afford to get it wrong.
              </div>
              <div style="padding-top:6px;">
                <a href="https://archoslabs.xyz" style="color:#8a8a88;text-decoration:underline;">archoslabs.xyz</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

// ----------------------------------------------------------------------------
// Lead notification email — internal-only. Sent to Rob when a new lead
// registers, so he can act on it without polling the DB.
// ----------------------------------------------------------------------------

export interface LeadNotificationEmailInput {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  organisation: string;
  phone?: string;
  tier: string;
  tierLabel: string;
  totalScore: number;
  isPriority: boolean;
  priorityReasons: string[];
  reportUrl: string;
}

export function buildLeadNotificationEmail(
  input: LeadNotificationEmailInput,
): RenderedEmail {
  // Subject line is the entire "did this lead just land?" signal —
  // optimised for inbox scanning. Priority leads get a [PRIORITY]
  // prefix so Rob can filter or pin them.
  const priorityPrefix = input.isPriority ? "[PRIORITY] " : "";
  const subject = `${priorityPrefix}New lead — ${input.firstName} ${input.lastName} (${input.organisation}) — ${input.tier} ${input.totalScore}/100`;

  // Plain text is the source of truth; an internal-only recipient
  // doesn't need styled HTML. Resend wants at least one body — text is
  // it.
  const lines: string[] = [];
  lines.push(`A new lead just completed the AI Readiness Assessment.`);
  lines.push("");
  lines.push(`Name:         ${input.firstName} ${input.lastName}`);
  lines.push(`Email:        ${input.email}`);
  lines.push(`Job title:    ${input.jobTitle}`);
  lines.push(`Organisation: ${input.organisation}`);
  if (input.phone) {
    lines.push(`Phone:        ${input.phone}`);
  }
  lines.push("");
  lines.push(`Tier:         ${input.tier} (${input.tierLabel})`);
  lines.push(`Total score:  ${input.totalScore}/100`);
  lines.push(`Priority:     ${input.isPriority ? "yes" : "no"}`);
  if (input.priorityReasons.length > 0) {
    lines.push(`Reasons:`);
    for (const reason of input.priorityReasons) {
      lines.push(`  - ${reason}`);
    }
  }
  lines.push("");
  lines.push(`Report:       ${input.reportUrl}`);
  lines.push("");
  lines.push(`(You'll need to be signed in as this lead, or use the magic-link flow at /sign-in, to view their report directly.)`);

  const text = lines.join("\n");

  // Minimal HTML fallback — pre-formatted block so the same plain text
  // renders as-is in clients that prefer HTML. No CTA button needed for
  // internal notifications.
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#0f0f0f;"><pre style="font-family:inherit;white-space:pre-wrap;margin:0;">${escapeHtml(text)}</pre></body></html>`;

  return { subject, text, html };
}

// Strip control characters that would break a plain-text body. Names
// come from a Zod-validated form so this is belt-and-braces.
function sanitiseForPlainText(value: string): string {
  return value.replace(/[ -]/g, "").slice(0, 120);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Same as escapeHtml but only the characters that matter inside a
// double-quoted attribute value. We control the URL but defend in
// depth — a malformed link with a stray quote shouldn't break the
// surrounding markup.
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
