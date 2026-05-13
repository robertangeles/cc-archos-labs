---
title: Share tokens for the AI Readiness report
category: concept
created: 2026-05-13
updated: 2026-05-13
related: [[lead-session-and-owner-only-reports]], [[magic-link-sign-in]]
---

How a lead generates a public URL to forward their AI Readiness report to a CFO / board / collaborator without that recipient registering. Shipped as C-2 (PR #18).

## Why

Without share tokens the only way for a non-lead to read a report is to register and run the assessment themselves. Useless for the "forward to your CFO" path the practitioner narrative is designed for. Share tokens give the owner a time-limited, revocable URL they can paste anywhere.

## Properties (locked 2026-05-13)

| Property | Value |
|---|---|
| TTL | 7 days from mint |
| Use semantics | One consume, re-views OK within TTL |
| Tokens per report | Many active; each independently revocable |
| Audit | First view stamps `consumed_at`; re-views don't re-stamp |
| Search-engine indexing | `noindex,nofollow` set via metadata on the share page |
| Auth | The raw token in the URL is the entire authorisation — no cookie needed |
| Revocation | Owner-only, immediate; revoked tokens 404 silently |

"One consume, re-views OK" rather than truly single-view because the CFO might close the tab and come back tomorrow. The first-view stamp is for the owner's audit ("did they open it"), not for blocking re-reads.

## Token model

One DB table, three security properties enforced at the SQL level:

| Column | Property |
|---|---|
| `token_hash` (sha256, unique) | Raw token never persisted. The URL is the only place it exists; the DB only sees the digest. |
| `expires_at` (now + 7 days) | Past-expiry tokens cannot be consumed regardless of `consumed_at` / `revoked_at`. |
| `consumed_at` (nullable, stamped on first verify) | Audit-only; the verify query uses `COALESCE` to preserve the original timestamp on subsequent reads. |
| `revoked_at` (nullable, set by owner action) | Revoked tokens are treated as not-found by the verify path. |

`mintShareToken(assessmentSessionId)`:
1. `randomBytes(32).toString("hex")` → 64-char raw token (~256 bits entropy).
2. `sha256(raw)` → hash.
3. Insert with `tokenHash = hash`, `expiresAt = now + 7 days`.
4. Return the raw token to the caller (only place outside the URL).

`verifyShareToken(rawToken)`:
1. Reject tokens that don't match `^[0-9a-f]{64}$/i` without touching the DB.
2. Hash the raw token.
3. Single conditional UPDATE: `SET consumed_at = COALESCE(consumed_at, now()) WHERE token_hash = ? AND expires_at > now() AND revoked_at IS NULL RETURNING assessment_session_id`.
4. If 0 rows affected, return `null`. Otherwise return the session id.

Step 3 is atomic: the WHERE clause rejects expired/revoked tokens; `COALESCE` preserves the first-view timestamp under concurrent races; the RETURNING gives the caller what they need to render the report. No application-level locking required.

## Surface area

| Route | Method | Behaviour |
|---|---|---|
| `POST /api/diagnostic/share` | POST | Owner-only mint. Rate-limited 20/IP/hour. Returns the raw share URL + expiry. Owner check: cookie's `leadId` must own the session. 404 silently on owner mismatch. |
| `POST /api/diagnostic/share/[id]/revoke` | POST | Owner-only revoke. Same ownership check. |
| `GET /tools/ai-readiness/share/[token]` | GET | Public report view. Verifies token, renders `<ReportView viewMode="shared">`. `noindex,nofollow` set via metadata. |

Plus the owner UI on the report page (`ShareControls` client component): "Create shareable link" button + list of active tokens with Copy / Revoke per row.

## Owner UI vs shared view

`ReportView` takes a `viewMode` prop:
- **`owner`** (default) — renders `ShareControls` after the action plan; full owner toolbar.
- **`shared`** — renders a "Shared report" banner at the top explaining the link context; hides `ShareControls`; print-hidden so a saved PDF stays clean.

Both modes use the same component tree. Future polish (typography, page-break rules) applies to both views automatically.

## Recipient analytics deliberately NOT included

The current implementation logs only `consumed_at` (first-view timestamp). No IP, no user-agent, no referrer. Adding those is easy (one column on `share_token`) but adds a tracking surface that's not justified by the current product need ("did they open it" is enough; "where from / which device" is post-launch territory).

## Cascade semantics

`share_token.assessment_session_id` has `ON DELETE CASCADE`. Removing a session purges its tokens. Removing a lead removes their sessions (assessment_session is FK CASCADE on lead) which removes their share tokens — all in one DELETE.

## What's deliberately NOT included

- **Server-side PDF for recipients.** The PDF endpoint at `/api/diagnostic/report/[sessionId]/pdf` is owner-only (checks lead cookie). Recipients use `window.print()` via the browser print dialog — the CSS print stylesheet produces the same layout.
- **Token quotas per lead.** No upper bound on how many active tokens a single lead can mint. Rate-limited 20/IP/hour so abuse is bounded; per-lead quotas can come later if it ever matters.
- **Email-on-revoke.** No notification to the recipient when a token is revoked. They just start seeing 404. Add later if anyone complains.
- **Token-bound IP fingerprinting.** A token works from any IP that has the URL. The owner controls who has the URL.
