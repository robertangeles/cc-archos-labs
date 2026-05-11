---
title: Magic-link sign-in for return visitors
category: concept
created: 2026-05-12
updated: 2026-05-12
related: [[lead-session-and-owner-only-reports]], [[diagnostic-scoring-logic]]
---

How a returning lead recovers access to their AI Readiness Assessment report without re-running the assessment. Shipped as Phase 2 W4 Pass 2.

## Why this exists

W4 Pass 1 shipped owner-only reports gated by an `archos_lead_session` cookie. If the cookie disappears — cleared browser, new device, came back after 30 days — there was no recovery path. Pass 2 closes that gap. No password is involved: ownership of the email account is the credential.

## Token model

One DB table, three security properties enforced at the SQL level:

| Column | Property |
|---|---|
| `token_hash` (sha256, unique) | Raw token never persisted. The email link is the only place the raw token exists; the DB only sees the digest. |
| `expires_at` (now + 15 min) | Tokens older than 15 min cannot be consumed, even if the row still exists. |
| `consumed_at` (nullable, set on first verify) | One-time use. Replay returns `expired_link`. |

`mintMagicLinkToken(leadId)`:
1. `randomBytes(32).toString("hex")` → 64-char raw token. ~256 bits of entropy.
2. `sha256(raw)` → digest.
3. Insert row with `tokenHash = digest`, `expiresAt = now + 15min`.
4. Return raw token to the caller (the route handler) so it can build the email link.

`consumeMagicLinkToken(rawToken)`:
1. Reject tokens that don't match `^[0-9a-f]{64}$/i` without touching the DB.
2. Hash the raw token.
3. Single conditional UPDATE: `SET consumed_at = now WHERE token_hash = ? AND expires_at > now AND consumed_at IS NULL RETURNING lead_id`.
4. If 0 rows affected, return `null`. Otherwise return the `leadId`.

Step 3 is the whole correctness story. The UPDATE is atomic — two concurrent requests with the same token race in the database, only one wins. No application-level locking required. No window between "check if valid" and "mark consumed" because both happen in the same statement.

## Surface area

| Route | Method | Behaviour |
|---|---|---|
| `/sign-in` | GET | Email field, calm copy, back-link to `/tools/ai-readiness` for first-timers. Reads `?error=` to render recoverable messages. |
| `/sign-in/check-email` | GET | Confirmation page. Says the same thing regardless of whether the email matched a lead. Surfaces the typed email so typos are visible. |
| `/api/auth/lead/request` | POST | Looks up the lead, mints a token, sends the email via Resend. **Always returns the same `{ ok: true, message: "If we have an account for that email…" }`** — no enumeration. |
| `/api/auth/lead/verify` | GET | Consumes the token via `consumeMagicLinkToken`, signs a fresh `archos_lead_session` JWT, redirects to the lead's most-recent completed report. All failure modes redirect to `/sign-in?error=<code>`. |

Plus a passive nudge above the registration-gate form: *"Already done this? Sign in instead."* Deliberately not an inline "does this email exist" check — that's an enumeration surface; the static nudge gets the same UX with zero leak.

## No enumeration

Three places that could leak whether an email is registered, three defences:

1. **Request response**. Always 200 with the same JSON body — whether the lead exists, doesn't exist, or hit the per-email rate limit. The user-visible difference is "did an email actually arrive" — a 30-second wait — not a status code.
2. **No inline email-check on the registration gate**. The "Sign in instead" link is unconditional.
3. **Verify error codes are stable strings** (`expired_link`, `missing_token`, `no_report`, `rate_limited`). None of them are "lead-not-found" — that's deliberately impossible because the request route never lets you observe it.

Cost: a user who typos their email gets the same screen as success and won't receive an email. Trade-off accepted in exchange for closing the enumeration surface.

## Rate limits

| Endpoint | Cap | Reason |
|---|---|---|
| `/api/auth/lead/request` | 10/IP/hour | Generic abuse cap matching other auth endpoints. |
| `/api/auth/lead/request` | 3/email/15min (over-protected to 1hr by current in-memory limiter window) | Keeps the endpoint from being a free outbound-email channel. Forgetful user can still recover after a wait. |
| `/api/auth/lead/verify` | 20/IP/hour | Verify is cheap (DB UPDATE) and tokens are unguessable; the cap exists for DoS shape rather than security. |

The in-memory rate limiter uses a fixed 1-hour window for all buckets. The per-email cap is set to `3` against that 1hr window, which is tighter than the documented 3/15min — acceptable for now. Tighter sliding windows arrive when we move limits to Redis (W5 or later).

## Cookie semantics

Verify success calls `signLeadSession(leadId)` + `setLeadSessionCookie(jwt)` — the same path as the registration handler. So the cookie a lead gets via magic-link sign-in is indistinguishable from the cookie they got at registration: same name (`archos_lead_session`), same 30-day TTL, same payload shape. The owner-only report check (`session.leadId === report.leadId`) doesn't care how the cookie was minted.

## Which report shows on verify?

The lead's **most-recent completed** assessment_session:

```sql
SELECT id FROM assessment_session
WHERE lead_id = ? AND status = 'completed'
ORDER BY completed_at DESC
LIMIT 1
```

If a lead has run the assessment twice (Test 4 of Pass 1 produces this state), they land on the latest. A "your reports" listing page for leads with multiple sessions is W5 work. Until then, latest wins.

## What Pass 2 deliberately does NOT do

- **Lead-side logout.** No UI surface to clear `archos_lead_session`. Easy to add; not required for the revenue path.
- **Cookie rotation on read.** The cookie remains a 30-day issue-and-forget. Verify mints a fresh one (overwriting any existing) but a successful report fetch doesn't extend the existing cookie.
- **"Your reports" page.** Latest report wins on sign-in.
- **Admin view of leads / magic-link audit log.** All this data is in the DB; W5 adds the admin surfaces.
- **Automated tests for the DB-touching consume path.** Would need either a test DB or significant mock plumbing. Manual test plan in the W4 Pass 2 PR covers the surface end-to-end.

## Manual test coverage (verified 2026-05-12)

Six tests run against local dev + Render Postgres:

1. **Nudge visible** — registration gate shows "Already done this? Sign in instead" above the form.
2. **Happy path** — submit email → email lands → click "Open my report" → land on report.
3. **One-time use** — click the same magic-link URL twice → second click 302s to `/sign-in?error=expired_link`.
4. **No enumeration** — submit a non-registered email → same `check-email` confirmation page → no email actually sent.
5. **Per-email rate limit** — request 4 sign-in links in succession for the same real email → all 4 show the confirmation page, only 3 emails arrive (4th hits the per-email cap silently).
6. **Tampered URLs** — `/api/auth/lead/verify` without a token → `missing_token` redirect. `/api/auth/lead/verify?token=garbage` → `expired_link` redirect.

Skipped: explicit 15-min expiry test (same WHERE clause as the consume condition; Test 3 already proves the path).
