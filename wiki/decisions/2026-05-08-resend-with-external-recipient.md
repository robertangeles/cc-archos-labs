---
title: Resend with an external recipient mailbox for the contact form
category: decision
created: 2026-05-08
updated: 2026-05-08
related: [[2026-05-08-godaddy-smtp-for-contact-form]], [[2026-05-08-render-postgres-over-neon]], [[backlog]], [[index]]
---

Contact form sends via Resend (verified `mail.archoslabs.xyz` subdomain) to an external recipient mailbox the operator actually reads (Outlook / Gmail / Workspace) — never to a GoDaddy-cPanel-hosted address. Supersedes [[2026-05-08-godaddy-smtp-for-contact-form]].

## What we tried before this

1. **Resend → `rob.angeles@archoslabs.xyz` (root domain From).** Resend reports `delivered`, GoDaddy returns 250 OK at SMTP, mail silently dropped before any folder. GoDaddy's anti-spoofing protects its hosted domains from external SMTP relays.
2. **Resend → `mail.archoslabs.xyz` subdomain From.** Same silent-drop behavior — GoDaddy treats subdomain mail to root as still self-domain.
3. **DMARC `p=none` on archoslabs.xyz.** No effect — silent drop happens at a layer above DMARC.
4. **GoDaddy SMTP via `nodemailer` from the Render web service.** Locally worked (developer's IP allowed). From Render: `ETIMEDOUT` on `CONN`. GoDaddy's cPanel infra blocks Render's outbound IPs at the firewall level. Customer-friendly hostnames don't help — they resolve to the same IP. See [[2026-05-08-godaddy-smtp-for-contact-form]] for the failure detail and lesson.

## Decision

- **Sender:** Resend with `RESEND_FROM_EMAIL=Archos Labs <hello@mail.archoslabs.xyz>` (verified subdomain).
- **Recipient:** External mailbox the operator reads — currently `trebor.selegna@outlook.com`. Never a GoDaddy-cPanel-hosted address.
- **Implementation:** `lib/resend.ts` (lazy env validation), `app/api/contact/route.ts` calls `getResend()`. No `nodemailer`, no `lib/smtp.ts` — both removed in the revert.

## Why this works

External mailbox providers (Outlook, Gmail, Microsoft 365, Google Workspace) accept Resend mail correctly:

- **DKIM** signed with `mail.archoslabs.xyz` keys — receiver validates against published DNS, passes.
- **DMARC** alignment via DKIM — `mail.archoslabs.xyz` aligns with the visible From-domain, passes.
- **No self-domain anti-spoofing trip** — receiver is `outlook.com` / `gmail.com`, not `archoslabs.xyz`.
- **Spam filtering is normal** — first-time sender to a new recipient may land in Junk/Other. Marking Not Junk once trains the filter; subsequent sends hit Inbox.

This is the same pattern used by spresso.xyz and culinaire.kitchen (the operator's other Render-deployed projects).

## Trade-offs

- **Operator reads enquiries in Outlook, not at `@archoslabs.xyz`.** Acceptable because (a) prospects fill in their own email; the contact form doesn't expose `rob.angeles@archoslabs.xyz` publicly, (b) the `replyTo` header points back at the prospect, so the operator hits Reply in Outlook and the response goes to the prospect's address normally.
- **Brand-aligned `@archoslabs.xyz` mailbox isn't part of the working flow.** If desired later, set up GoDaddy email forwarding `rob.angeles@archoslabs.xyz` → operator's Outlook so prospects can also email the @archoslabs.xyz address directly and have it land in the same inbox. Not needed for the form path.

## Trigger to revisit

If email infrastructure for archoslabs.xyz migrates off cPanel (Google Workspace or Microsoft 365 with proper MX), Resend's external delivery to `@archoslabs.xyz` mailboxes will start working — those receivers handle DMARC/DKIM properly. At that point `CONTACT_RECIPIENT_EMAIL` can flip back to a `@archoslabs.xyz` address.
