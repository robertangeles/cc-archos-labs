---
title: Email CTA buttons need the bulletproof pattern from the first attempt
category: lesson
created: 2026-05-13
updated: 2026-05-13
related: [[transactional-email-rendering]], [[magic-link-sign-in]]
---

A plain `<a>` styled with `background` + `color:#ffffff` is not a button in Outlook. v1 of the magic-link email shipped with this pattern and broke twice on the same recipient: invisible in Outlook desktop, near-illegible in Outlook web dark mode.

## Problem

The v1 magic-link email (PR #25) had a clean styled anchor as the CTA:

```html
<a href="..." style="display:inline-block;background:#1e40af;color:#ffffff;
                     text-decoration:none;padding:14px 28px;border-radius:8px;">
  Open my report
</a>
```

This renders correctly in Gmail, Apple Mail, and the Playwright preview, so it passes local visual verification. It fails on the actual recipient surface for Archos Labs' target audience:

- **Outlook desktop (Word renderer)**: strips `display:inline-block`. The button collapses to inline text with no visual weight.
- **Outlook web dark mode**: keeps `display:inline-block` but the dark-mode engine rewrites `color:#ffffff` to a dark colour AFTER inline styles resolve. It also doesn't honour `!important` on `<a>` `color`. Result: dark, near-black text on the blue background — barely readable.

Live test in user's Outlook web inbox showed both states across v1 and v2 attempts before we converged on the working fix.

## Fix

Three layers, all required. None alone is enough.

**1. Background colour on the parent `<td>`, not just the anchor.** Outlook web and several legacy clients strip `background` on styled `<a>`. Putting `bgcolor="#1e40af"` on a wrapping table cell preserves the colour even when the anchor flattens.

```html
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td class="cta-button-cell" bgcolor="#1e40af"
        style="background-color:#1e40af;border-radius:8px;mso-padding-alt:0;">
      <!-- anchor + VML go here -->
    </td>
  </tr>
</table>
```

**2. VML `<v:roundrect>` inside an `<!--[if mso]>` block for Outlook desktop.** Word's rendering engine ignores most CSS but does honour VML, so we draw a real button using shape primitives:

```html
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
             xmlns:w="urn:schemas-microsoft-com:office:word"
             href="..." style="height:46px;v-text-anchor:middle;width:200px;"
             arcsize="18%" stroke="f" fillcolor="#1e40af">
  <w:anchorlock/>
  <center style="color:#ffffff;font-family:'Segoe UI',Helvetica,Arial,sans-serif;
                 font-size:15px;font-weight:600;">Open my report</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a class="cta-button" href="..." style="...">
  <span class="cta-button-text" style="color:#ffffff !important;
                                       mso-color-alt:#ffffff;">Open my report</span>
</a>
<!--<![endif]-->
```

**3. `[data-ogsc]` / `[data-ogsb]` overrides in `<head>` for Outlook web dark mode.** These attribute selectors apply AFTER the dark-mode transformation. `!important` on inline `<a>` color doesn't win against the dark-mode rewrite, but a CSS rule keyed on `[data-ogsc]` does:

```html
<style>
  [data-ogsc] .cta-button,
  [data-ogsc] .cta-button-text {
    color: #ffffff !important;
  }
  [data-ogsb] .cta-button-cell {
    background-color: #1e40af !important;
  }
</style>
```

Wrap the button text in a `<span class="cta-button-text">` so the `[data-ogsc]` selector has something to bind to (Outlook web also resets some properties when applied directly to `<a>` even with the attribute hook).

## Rule

**Default to the bulletproof button pattern for every transactional email from the first commit, even when the v0 design looks fine in Gmail and Apple Mail.**

The pattern is in [transactional-email-rendering](../concepts/transactional-email-rendering.md). Copy from there; don't reinvent. The cost of typing 20 extra lines of HTML is zero. The cost of shipping a broken button to a CFO is more.

Two corollaries:

- **Playwright screenshots of the rendered HTML are not sufficient verification.** They show how the HTML resolves in Chromium with neither client-specific CSS overrides nor dark-mode engines active. They confirm "the structure is right"; they do not confirm "the email lands". For transactional email, deploy to a staging or live endpoint and verify in the actual target clients: Outlook web (dark + light), Outlook desktop, Gmail web + mobile, Apple Mail. Today the verification chain ran v0 → screenshot ✓ → ship → Outlook web ✗ → patch → re-screenshot ✓ → ship → Outlook web button dark on dark → patch again.

- **Match the audience's email client, not the developer's.** Archos Labs' target audience — execs in financial services, healthcare, government — uses Outlook (desktop corporate or web). If we'd assumed Gmail dominance like a typical SaaS product, we'd have called v1 done and shipped a broken button to every recipient.
