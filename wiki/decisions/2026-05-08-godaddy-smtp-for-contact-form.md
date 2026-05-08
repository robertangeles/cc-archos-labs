---
title: GoDaddy SMTP for the contact form (Resend stays for Phase 2)
category: decision
created: 2026-05-08
updated: 2026-05-08
related: [[2026-05-08-render-postgres-over-neon]], [[backlog]], [[index]]
---

Replaced Resend with GoDaddy's outbound SMTP for `POST /api/contact`. Resend stays installed for Phase 2 (magic-link auth, assessment report emails to external prospects).

## What broke

GoDaddy's mail server silently drops Resend mail directed at GoDaddy-hosted mailboxes on archoslabs.xyz. Confirmed empirically over ~10 test sends:

- Resend reports `last_event: delivered` (GoDaddy's SMTP returns 250 OK)
- Mail never appears in Inbox, Junk, Trash, or any custom folder
- External Gmail mail to the same mailbox arrives normally
- Held with both DMARC `p=quarantine` and `p=none` — same silent drop
- Held with both root-domain From (`noreply@archoslabs.xyz`) and subdomain From (`hello@mail.archoslabs.xyz`) — same silent drop

The drop happens after SMTP accept and before folder placement, in GoDaddy's spam pipeline, independent of DMARC policy or DKIM alignment. GoDaddy enforces blanket protection against external-relay senders claiming to be a domain GoDaddy hosts — the goal being to protect the millions of cheap email plans they sell from self-domain phishing.

This protection runs separate from DMARC and is not configurable on basic GoDaddy email plans.

## What we did

Send via the GoDaddy cPanel mail server, authenticated with the mailbox's own credentials. Mail from GoDaddy's own infrastructure to a GoDaddy-hosted mailbox is intra-network and bypasses every external-relay filter.

**Connection config:**
- `SMTP_HOST=mail.archoslabs.xyz` — the customer-friendly hostname. Tried two alternatives first that didn't work:
  - `sg2plzcpnl493903.prod.sin2.secureserver.net` (the per-account cPanel hostname): connects from laptop, but blocked by GoDaddy's IP firewall when called from Render's Singapore data center → `ETIMEDOUT`
  - `smtpout.secureserver.net` (the general transactional relay): no firewall, but rejects credentials with `535 Authentication Failed` because the relay is for GoDaddy Workspace Email / Microsoft 365 plans, not cPanel mailboxes
- `SMTP_PORT=587` (STARTTLS). Port 465 (SSL) hit a TLS protocol mismatch on this server (`tls_validate_record_header: wrong version number` during the DATA phase) — known nodemailer-vs-cPanel-port-465 quirk. 587 with explicit STARTTLS works cleanly.
- `SMTP_TLS_SERVERNAME=sg2plzcpnl493903.prod.sin2.secureserver.net` — the cPanel server's TLS cert is a wildcard for `*.prod.sin2.secureserver.net`, not for `mail.archoslabs.xyz`. Setting `tls.servername` makes nodemailer validate the cert against the name it actually covers, so we keep TLS hostname verification on while connecting via the customer alias.

Implementation: `lib/smtp.ts` with `nodemailer` + lazy env-var validation + cached transporter; route `app/api/contact/route.ts` calls `getMailer()` instead of the Resend client.

## Why Resend stays installed

Phase 2 (AI Readiness Assessment) sends transactional mail outbound to external prospects — assessment reports and magic-link sign-in emails. Receivers there are mostly Gmail/Outlook, not GoDaddy. For that path, Resend's deliverability and reputation management beats raw GoDaddy SMTP. So the project keeps two senders:

- `lib/smtp.ts` — GoDaddy SMTP, recipient is the rob.angeles@archoslabs.xyz mailbox (contact form notifications)
- `lib/resend.ts` — Resend API, recipients are external (Phase 2 reports, magic-link mail)

Each sender is picked for the recipient pattern.

## Trade-offs accepted

- **Mailbox password in env** — `SMTP_PASS` carries the actual mailbox credential, larger blast radius than a Resend API key. Mitigations: scope `.env.local` and Render env vars carefully; rotate on suspected exposure.
- **GoDaddy SMTP rate limits** — typically 300 messages/day on basic plans. Fine for contact-form volume; would constrain if Phase 2 sent through GoDaddy too (it won't — Phase 2 uses Resend).
- **GoDaddy outbound deliverability to external receivers** — variable reputation on shared GoDaddy IPs. Not relevant here (recipient is the same domain). Was the deciding factor for keeping Phase 2 mail on Resend.

## Trigger to revisit

If we migrate inbound mail off GoDaddy entirely (Google Workspace or Microsoft 365 for archoslabs.xyz), Resend's external-relay path stops being silently dropped — those receivers handle DMARC/DKIM properly. At that point the contact form can move back to Resend so the project has one outbound sender. Until then, two senders is the right call.
