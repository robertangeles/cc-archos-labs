---
title: Auth + Role Management Port — Status
category: synthesis
created: 2026-05-26
updated: 2026-05-26
related: [[for-our-next-tasks-twinkly-diffie]], [[deployment-architecture]]
---

Status of the auth + role management port from cc-spresso-data-studio. Reach for this when picking up the work mid-stream; it tells you what shipped, what's pending, and where the irreversible bits sit.

## Plan reference

Full plan lives at `~/.claude/plans/for-our-next-tasks-twinkly-diffie.md` (local). It captures:
- CEO review decisions (D1–D4) — Approach B, SELECTIVE EXPANSION, newsletter split out, hardening pack included
- Eng review decisions (E1–E4) — hybrid JWT+DB session, legacy lead-session shim, CSRF via Origin/Referer, three regression tests
- Five-phase migration strategy (Phases 1, 2 already shipped; 3, 4, 5 pending)

## Shipped (PRs merged to main)

| Task | PR | What it shipped |
|------|----|-----------------|
| T1 | #112 | Phase 1 additive schema. Extended `users` table (+5 columns); created `oauth_account`, `user_session`, `auth_event`, `auth_setting`. Live in prod DB. |
| T2 | #113 | Backfill 3 leads → 3 member users. Idempotent script at `scripts/backfill-users-from-leads.mjs`. Applied to prod. |
| T3 | #114 | `lib/auth/{password,session-jwt,session,csrf,audit}.ts` foundation services + 39 unit tests. |
| T4a | #115 | Auth routes: `register`, `login`, `logout`, `verify-email`. Argon2id passwords. Enumeration-defense on login. 20 tests. |
| T4b | #116 | Recovery routes: `password-reset/{request,confirm}`, `email-change/{request,confirm}`. Single-use via `users.token_version`. 23 tests. |
| T5 | #117 | Google OAuth: `lib/auth/oauth-google.ts` + `start/callback/unlink` routes. State-cookie CSRF on the dance. `email_verified=false` refused. 33 tests. |
| T6 | #118 | Cloudflare Turnstile feature-flag plumbing. Wired into `register`, `login`, `password-reset/request`. Default OFF. 19 tests. |
| T7 | #119 | **First clickable surface.** Admin Users & Roles at `/admin/users` — list, filter, search, role change, deactivate, drill-in. Guards: ERR_LAST_ADMIN, ERR_SELF_DEACTIVATE. 31 tests. |
| T8 | #120 | Admin Auth Settings at `/admin/auth` — Turnstile toggle + secret (encrypted), public sign-up toggle. DB-first read with env fallback. 24 tests. |
| T8b | #121 | Google OAuth UI in `/admin/auth`. Closes the admin-side auth port. 14 tests. |

**Status as of 2026-05-26**: 840 / 840 tests passing. tsc clean. lint clean. All 9 PRs above are live in prod.

## Pending (not yet shipped)

### T9 — Phase 3 dual-write FK columns (~1d human / ~1h CC)

Goal: prepare the FK rename without breaking the existing `lead_id` flow.

1. Add `user_id` column (nullable) to `assessment_session` and `magic_link_token`, alongside the existing `lead_id`.
2. Backfill these columns from the `lead_id → user_id` mapping (via shared `lower(email)` join through `users`).
3. Update writes in:
   - [app/api/diagnostic/generate/route.ts:104](../../app/api/diagnostic/generate/route.ts#L104) — mints lead session after diagnostic
   - [app/api/auth/lead/verify/route.ts:72](../../app/api/auth/lead/verify/route.ts#L72) — magic-link verify mints session
   - to **dual-write** both `lead_id` and `user_id` on new rows.
4. Update reads to prefer `user_id` when set, fall back to `lead_id`.
5. Ship and bake for at least one day. This phase is fully reversible.

**Risk**: Low. Each step is additive + reversible. Run regression test R1 (admin login post-Phase-1) before merging.

### T10 — Phase 4 + 5: Cutover (~0.5d human / ~30min CC, **irreversible**)

This is the irreversible point the plan flagged for explicit user confirmation before merge.

1. **Phase 4** — Idempotent script populates any remaining `user_id` NULLs in `assessment_session` and `magic_link_token`.
2. **Phase 5** — In one atomic PR:
   - Drop `lead_id` FK columns.
   - Rename `lead` table → `user_profile`. Drop `lead.email`. Add `user_id` FK.
   - Rename `lib/auth-lead.ts` → `lib/auth/magic-link.ts`. Switch the 4 callsites (listed in plan §5 Phase 5) in lockstep.
   - Ship the **backward-compat shim** at `lib/auth/legacy-lead-session.ts`: exchanges legacy `{ leadId }` JWTs for new `{ userId, sessionId }` cookies on first request after cutover. Auto-clears the legacy cookie. Logs `auth_event{type:'login_session_upgraded'}`. **Carries a `// DELETE AFTER: <date>` comment** so cleanup is scheduled (~30 days post-cutover).
   - Run **three regression tests** (R1–R3 per plan §11): admin login still works (R1), lead-session shim round-trip (R2), returning-lead E2E (R3).

**Risk**: This drops columns + renames a table. The shim covers in-flight legacy cookies for 30 days. After cutover, the auth model is unified.

### T12 — Public `/account` page (~1h CC, second user-clickable surface)

Signed-in users land here for self-service:
- Edit display name, organisation (writes to `user_profile`)
- Change email (calls `/api/auth/email-change/request` from T4b)
- Change password (calls `/api/auth/password-reset/request` to start the flow, OR a direct change-password endpoint)
- Unlink Google (calls `POST /api/auth/google/unlink` from T5)
- See active sessions
- "Sign out everywhere" button (calls `revokeAllSessionsForUser`)

All the API plumbing already exists. T12 is pure UI work.

### Follow-up cleanups (lower priority)

- **T7b** — Admin invite flow: email + single-use invite token + password-set route + landing page. Diagnostic-flow already creates users, so this is convenience-only.
- **Audit log admin UI** — `/admin/audit` page surfacing `auth_event` rows. The `event_type_idx` index already serves the queries.
- **Rename `/api/admin/google-oauth/*` → `/api/admin/google-calendar/*`** — disambiguate from the new sign-in Google OAuth. Booking system rename; touches the existing Calendar flow.
- **Microsoft / GitHub OAuth providers** — `oauth_account` schema supports them; UI + service wiring deferred until demand exists.

## How to pick this up on another machine

1. `git pull origin main` — get the current state of the repo.
2. Open this page and the plan file.
3. Pick a task from "Pending" above and create a feature branch.
4. Test discipline: every PR has run `pnpm tsc + lint + test + build` green. Default password timing-floor is 10ms (lowered from 15ms in T4b to avoid flakes under sequential load).
5. Tests using CSRF-checked routes mock `lib/site-config.getSiteUrl` to return `https://archoslabs.xyz` — Vitest 4 auto-loads `.env.local` which has `NEXT_PUBLIC_SITE_URL=http://localhost:3007`, so without the mock CSRF fails in tests.

## Operational notes

- The migration target is **prod DB** — Archos Labs runs single-environment single-DB (see [[deployment-architecture]]). Any `pnpm db:migrate` writes to live data; the user has been explicitly confirming each migration.
- `BOOKING_ENCRYPTION_KEY` env var is reused for auth_setting secret encryption (Turnstile secret, Google client secret). Both go through `lib/booking-crypto.ts` AES-256-GCM.
- Admin login still uses the OLD JWT model (`archos_admin_session` cookie, `{ admin: true }` payload). The Users & Roles admin actions look up the actor as `users.email='admin'`. T10 unifies this and lets `getCurrentUser()` resolve the actor properly.
