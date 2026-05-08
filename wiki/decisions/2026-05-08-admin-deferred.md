---
title: Admin space — deferred (PARTIALLY SUPERSEDED)
category: decision
created: 2026-05-08
updated: 2026-05-08
related: [[backlog]], [[index]], [[2026-05-08-phase2-ceo-review]], [[2026-05-08-minimal-admin-for-seo]]
---

> **Update 2026-05-08 (later same day):** A minimal admin scope was built for Phase 1.C SEO config — single admin user, password-gated, one settings table. See [[2026-05-08-minimal-admin-for-seo]]. The "cathedral" critique below still holds; what shipped is intentionally the opposite (one user, one form, one DB row). The full multi-user / role-management / integrations admin remains deferred to Phase 2 or beyond.

Rob proposed building an admin space with login/register, a "User Manager" ("the cathedral of user management"), and an Integrations panel for Google OAuth, Cloudinary, and DB connection strings. CEO-mode review surfaced three structural problems with the request and Rob accepted the recommendation to defer entirely.

## Problems with the original request

1. **No users to manage.** Archos Labs has one admin user today: Rob. The end-user accounts (executives running the diagnostic) don't exist because the diagnostic itself isn't built yet (Phase 2 of the backlog). A "cathedral" of user management for one person is over-engineering by ~100×.

2. **Integrations panel for secrets is the wrong shape.** The DB connection string can't live in the database it connects to — it has to be an env var, full stop. OAuth client secrets and Cloudinary credentials are also typically env vars; storing them in DB introduces encryption-at-rest, audit logging, and key-rotation requirements without offsetting benefit (you redeploy on key change anyway). The "Integrations panel" idea conflated env-var bootstrap config with runtime DB-stored config.

3. **Revenue deadline.** With ~10 days to a sendable URL and the diagnostic itself a 4–6 week build, admin work doesn't help the revenue path. Every day spent on admin is a day off Phase 0 / Phase 1 / Phase 2.

## What to use instead, until admin is justified

- **Secrets:** `.env.local` for development, Render's environment-variable management for production.
- **DB inspection (when DB exists):** Drizzle Studio (`drizzle-kit studio`).
- **Email:** Resend dashboard.
- **Image hosting (when used):** Cloudinary dashboard.
- **Site monitoring:** Render dashboard, browser dev tools.

Each platform has its own admin. No code required.

## Trigger to revisit

Build admin when **all three** are true:

1. The diagnostic tool (Phase 2) is shipped and producing leads.
2. There is content (LLM system prompt, questions, scoring rubric) that Rob wants to edit without a code deploy.
3. There are submissions/leads in a database that Rob wants to view in a UI rather than via SQL.

At that point, the right admin to build is **not** the one originally proposed. It's a content/lead management panel:

```
/admin                    single-user (Rob), magic-link via Resend
  /admin/diagnostic       CMS for diagnostic content
    – system prompt       (editable)
    – questions           (CRUD on cluster + question rows)
    – scoring rubric      (tier boundaries, weights)
  /admin/leads            view contact + diagnostic submissions
                          (read-only, sortable, exportable to CSV)
```

Explicitly **out of scope**, even at that future point:

- User registration (Rob is the only admin user; magic-link to a hardcoded email)
- User roles / permissions (single role: admin)
- Integrations panel (secrets stay in env vars)
- DB connection string in UI (impossible by definition)

## Verification

This decision is verified by the absence of admin code. No screenshots, no tests, no migrations. The deferral itself is the deliverable.

When admin is eventually built (post-Phase 2), verify by:

1. `pnpm dev:fresh` boots cleanly with no admin route 404s
2. `/admin/login` accepts a magic-link request, sends email via Resend
3. Authenticated session can edit one diagnostic content row and re-view it
4. A diagnostic submission lands in the leads table and appears in `/admin/leads`

Until then: nothing to verify. Build the home page (Phase 0), the contact form (Phase 1), and the diagnostic (Phase 2) first.
