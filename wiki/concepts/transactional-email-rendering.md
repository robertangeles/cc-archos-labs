---
title: Transactional email rendering — patterns and brand decisions
category: concept
created: 2026-05-13
updated: 2026-05-13
related: [[magic-link-sign-in]], [[2026-05-13-email-buttons-need-the-bulletproof-pattern]]
---

How transactional emails (magic-link sign-in, lead notifications, future booking confirmations) are rendered so they survive real-world clients — Outlook desktop, Outlook web dark mode, Apple Mail, Gmail — and read as senior-consulting practice, not generic SaaS.

The template module is `lib/email-templates.ts`. `buildMagicLinkEmail()` is the canonical implementation of every pattern below; reuse it as the starting point for any new template.

## Why this is its own concept

Email is not a web page. CSS-in-`<style>`-blocks works in some clients and not others. `display:inline-block` is stripped by Outlook desktop. `<div>` margins collapse unpredictably. Dark-mode engines rewrite colours after inline styles resolve. We solved this once for the magic-link email; future templates should not re-derive the answers.

## Rendering patterns

### Plain text body is the source of truth

Every template returns `{ subject, text, html }`. The plain-text body is composed first, then the HTML is built around the same copy. Resend sends both; well-behaved clients prefer HTML, but some corporate Outlook configurations strip HTML and render text — both must read the same way.

### Bulletproof button (the big one)

Documented in detail in [the buttons lesson](../lessons-learned/2026-05-13-email-buttons-need-the-bulletproof-pattern.md). Three layers, all required:

1. `<td bgcolor>` wraps the anchor so the colour survives Outlook web stripping `background` on `<a>`.
2. `<v:roundrect>` inside `<!--[if mso]>` draws a real button for Outlook desktop's Word renderer.
3. `<style>[data-ogsc] .cta-button-text { color:#ffffff !important }</style>` in `<head>` overrides Outlook web's dark-mode rewrite of `<a>` text colour.

Copy the block from `buildMagicLinkEmail()`. Do not reinvent.

### Table-row spacing, not div padding

`<div>` blocks with `padding-top` collapse together in some clients — observed in Outlook web. Put each paragraph in its own `<tr><td style="padding:Xpx Ypx 0 Ypx;">`. The padding is on the `<td>`, not a wrapping `<div>`. This costs three extra lines per block and is the only way to preserve visible gaps cross-client.

### Hidden preheader

A `<div style="display:none; visibility:hidden; mso-hide:all; font-size:1px; ...">` at the top of `<body>` controls the inbox-preview text. Without it, the preview shows whatever the first visible line of body content happens to be — which is usually the heading, repeated awkwardly next to the subject. The preheader is one sentence summarising what the email is for.

### Brand stripe across the top of the card

```html
<tr>
  <td bgcolor="#1e40af" height="4" style="background:#1e40af;height:4px;
              line-height:4px;font-size:0;mso-line-height-rule:exactly;
              border-top-left-radius:10px;border-top-right-radius:10px;">&nbsp;</td>
</tr>
```

`mso-line-height-rule:exactly` is required — without it, Outlook desktop expands the 4px row to `font-size + leading` (~20px). The `&nbsp;` is there because some clients collapse empty cells.

### MSO-conditional font stack

Outlook desktop's Word renderer doesn't honour `-apple-system` or `BlinkMacSystemFont` in the font stack and falls through to Times New Roman by default. An `<!--[if mso]><style>* { font-family: 'Segoe UI', ... }</style><![endif]-->` block in `<head>` overrides this for Outlook desktop only.

### color-scheme meta

```html
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
```

Hints at preferred rendering. Apple Mail dark mode respects this and leaves the email's own light palette intact. Outlook web and Gmail dark mode ignore it — they apply their own dark-mode engine regardless. Set the meta anyway; it's cheap and Apple is a meaningful share of the exec audience.

### Escape user content for both contexts

`escapeHtml()` and `escapeAttr()` exist for any interpolation of dynamic content (names from the form, URLs). Even when the data passes through a Zod-validated form, escape at the boundary as defence-in-depth — a malformed link with a stray quote shouldn't break the surrounding markup.

## Brand and copy decisions

### Personal sign-off

Magic-link, future booking confirmations, future onboarding emails sign off:

```
— Rob Angeles
Archos Labs
```

…inside the body card, not in the footer. The practitioner brand says the work is done by a person, not an agency. A faceless "— Archos Labs" signature contradicts the positioning. When Rob is no longer the only practitioner, this scales to "— [Name] / Archos Labs" — the brand line still anchors the relationship.

Internal notifications (lead-notification email that goes to Rob himself) do not need this — they're functional alerts.

### Masthead outside the card

Logo + wordmark sit ABOVE the card, not inside it. Two reasons:

1. Image-blocker resilience: if the email client blocks the `<img>` (Gmail desktop's "load images" prompt, Outlook corporate policies), the wordmark text still establishes the brand. If the logo were inside a card already established by the surrounding chrome, blocking the image would leave a visual gap.
2. Document feel: the masthead reads as letterhead. The card reads as the letter. Two distinct objects, like a real document.

Masthead size: **56px logo + 30px wordmark**. v1 shipped with 28px/15px which read as a footnote at exec-scanning distance — doubled in v2 to anchor the brand.

### Tagline footer

```
Built by practitioners. For programs that can't afford to get it wrong.
archoslabs.xyz
```

Below the card, in muted text (`#8a8a88`, 12px). Reinforces the positioning without competing with the personal sign-off. Linked `archoslabs.xyz` is the only outbound brand link in the email beyond the CTA.

### Confident copy

The body delivers the thing; it doesn't ask the recipient to do work. v1 said "Use the link below to open your AI Readiness Assessment report" — passive, instructional. v2 says "Here's the link to your AI Readiness Assessment" — direct, present-tense, the speaker hands the thing over.

### Subject lines

`Your Archos Labs sign-in link` — the entire "what is this and is it safe" decision happens in the inbox before the email is opened. Subject must answer that directly. Avoid: "✨ Welcome back", "Your magic link is here", "Hi Rob — your link". All read as marketing.

## Colour palette

| Token | Hex | Use |
|---|---|---|
| Background canvas | `#f8f8f6` | Outer body background — warm off-white, not pure white |
| Card | `#ffffff` | Inside the card |
| Card border | `#e5e5e3` | 1px subtle border |
| Card rule | `#ececea` | Internal separators (between body and security note) |
| Heading / strong text | `#0f0f0f` | Near-black |
| Body text | `#1f1f1f` | Slightly softer than heading |
| Muted text (security note, footer) | `#6b6b6b` / `#8a8a88` | Two muted weights |
| Accent (button, brand stripe) | `#1e40af` | The "serious" Archos blue — same as the PDF light-mode accent. `#3b82f6` reads as developer-SaaS; `#1e40af` reads as senior advisor. |

These match `globals.css` `.pdf-mode` overrides so emails, PDFs, and the on-screen report share one palette.

## Verification

Local Playwright screenshots (`scripts/screenshot.mjs` against a file:// preview) confirm structure but **not** client-specific rendering. Required additional checks on every email change:

1. Deploy to prod.
2. Request a real send via the live endpoint.
3. Verify rendering in: Outlook web dark mode, Outlook desktop, Gmail web (light + dark), Gmail mobile, Apple Mail (Mac + iOS).

If the audience were SaaS engineers, Gmail-only would suffice. The exec audience makes Outlook the binding constraint.

## Related templates

- `buildMagicLinkEmail()` — canonical pattern. Goes to leads.
- `buildLeadNotificationEmail()` — plain text wrapped in `<pre>`. Internal-only (Rob's inbox), no need for bulletproof rendering. Subject line is the entire signal; format is inbox-scanning-optimised.

Future templates (booking confirmation, assessment-completed notification to lead, etc.) start from `buildMagicLinkEmail()` and adjust copy.
