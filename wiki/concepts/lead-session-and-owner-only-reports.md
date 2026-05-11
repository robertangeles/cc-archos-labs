---
title: Lead session model and owner-only report access
category: concept
created: 2026-05-11
updated: 2026-05-11
related: [[diagnostic-scoring-logic]], [[2026-05-08-phase2-ceo-review]], [[2026-05-08-minimal-admin-for-seo]]
---

How a diagnostic respondent is identified after the registration gate, how their report is gated to them only, and why this is a separate auth surface from the admin login.

## Two auth surfaces, one secret

The site has two cookie-backed sessions, both signed with the same `AUTH_SECRET` but distinct in cookie name, audience, payload shape, and TTL:

| Surface | Cookie | TTL | Payload | Purpose |
|---|---|---|---|---|
| Admin | `archos_admin_session` | 24h | `{ kind: "admin" }` | Gates `/admin/**` + `/api/admin/**` via `middleware.ts` |
| Lead | `archos_lead_session` | 30d | `{ leadId: uuid }` | Gates `/tools/ai-readiness/report/[sessionId]` to the lead who owns it |

They never overlap. The admin cookie unlocks no report; the lead cookie unlocks no admin route. Code lives in `lib/auth.ts` (admin, Edge-safe) and `lib/auth-lead.ts` (lead, Edge-safe). Server-only cookie helpers (`set*`, `clear*`, `get*FromCookies`) are colocated in `lib/auth-server.ts` so route handlers and server components touch one import.

## Where the lead cookie gets set

The cookie is issued exactly once per registration POST. In `app/api/diagnostic/generate/route.ts`:

1. Validate `{ answers, lead }` with Zod, rate-limit by IP (5/hr).
2. Call `generateReport()` — scores the answers, calls Claude via OpenRouter, upserts the lead by email, inserts the session, inserts the report. Returns `{ sessionId, reportId, leadId }`.
3. `signLeadSession(leadId)` → mint JWT.
4. `setLeadSessionCookie(token)` → write `archos_lead_session` cookie.
5. Respond `{ ok: true, sessionId }`. SPA redirects to `/tools/ai-readiness/report/<sessionId>`.

The cookie is `httpOnly`, `secure` (prod), `sameSite=lax`, `path=/`. JS cannot read it.

## Owner-only access on the report page

`app/tools/ai-readiness/report/[sessionId]/page.tsx` enforces ownership server-side:

```ts
const report = await loadReport(sessionId);
if (!report) notFound();

const session = await getLeadFromCookies();
if (!session || !report.leadId || session.leadId !== report.leadId) {
  notFound();
}
```

Three things must all be true to render:

1. The session id resolves to a stored report.
2. The browser has a valid `archos_lead_session` cookie.
3. The cookie's `leadId` matches the `lead_id` on the assessment_session row.

Any mismatch returns **404, not 401**. The status code is deliberately silent — it doesn't reveal whether the URL exists for someone else, so guessing other session ids gains nothing. Verified end-to-end 2026-05-11 (Test 3): a logged-in user with one report cannot view another user's report URL, and an incognito visitor with no cookie cannot view either.

## Lead upsert by email

The lead row is the user account, keyed on email. `generateReport()` calls `db.insert(lead).values({...}).onConflictDoUpdate({ target: lead.email, set: {...} })`:

- New email → new row, returns its id.
- Returning email → updates `first_name`, `last_name`, `job_title`, `organisation`, `phone`, `updated_at`. Same `id` returned. Verified 2026-05-11 (Test 4): two assessment runs with the same email produced one lead row with `updated_at > created_at` and two `assessment_session` rows linked to it.

The lead row carries `is_priority: boolean`. This is **sticky** by design — once a lead is flagged priority (via `PRIORITY_TRIGGERS` evaluated on the session's answers; see `diagnostic-scoring-logic.md`), subsequent registrations cannot downgrade it. The upsert encodes this:

```ts
.onConflictDoUpdate({
  target: lead.email,
  set: {
    // ...other fields always overwrite...
    ...(result.isPriority ? { isPriority: true } : {}),
    updatedAt: new Date(),
  },
})
```

A non-priority follow-up session omits `isPriority` from the SET clause, leaving the prior `true` in place. A priority follow-up overwrites a prior `false`. There is no path from `true → false` short of direct SQL.

## Why a separate cookie at all

Two reasons:

- **Trust boundaries.** The admin cookie unlocks admin write surfaces (site_setting upserts, future leads/sessions admin pages). The lead cookie unlocks one read surface only. Mixing them would mean a leaked lead JWT could be replayed to attempt admin access — separation kills that class of mistake structurally.
- **TTL mismatch.** Admin sessions are short (24h) because the credential is a shared password; lead sessions are long (30d) because losing access for a returning user is friction with no security upside. Different cookies let each have its own lifetime without one constraining the other.

## What W4 Pass 1 does not include

- **Sign-in for return visitors.** There is no `/sign-in` page yet. If a user clears cookies or switches device, they cannot recover their existing report through the UI today. W4 Pass 2 adds magic-link sign-in (`magic_link_token` table, `/api/auth/lead/request` + `/api/auth/lead/verify`, sign-in page, existing-account hint on the registration gate).
- **Cookie rotation.** The cookie is issued once at registration and lives for 30 days. There is no refresh-on-read. Re-registering with the same email mints a fresh cookie (same `leadId`).
- **Logout for leads.** No UI surface to clear the lead cookie. Not a Pass 1 requirement.

## Test coverage

Manual end-to-end verification on 2026-05-11 against local dev + Render Postgres:

- Test 1 — happy path: assessment → registration → report. Pass.
- Test 2 — form validation: empty fields blocked by HTML `required`; malformed email returns 400 from the Zod-validated route; form values persist across the error. Pass.
- Test 3 — owner-only: a logged-in user cannot view another user's report URL; an incognito visitor cannot view any report URL. Both return 404. Pass.
- Test 4 — returning lead upsert: same email twice → one `lead` row, `updated_at > created_at`, two `assessment_session` rows. Pass.

Automated coverage lives in `scripts/test-diagnostic.ts` (scoring + flow) for now. An end-to-end Playwright suite over the four manual tests is a follow-up in W5.
