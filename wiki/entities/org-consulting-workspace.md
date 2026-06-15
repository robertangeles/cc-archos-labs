---
title: Org / Clients / Projects / Kanban (consulting workspace)
category: entity
created: 2026-06-15
updated: 2026-06-15
related: [[deployment-architecture]], [[integration-config]], [[state]]
---

The multi-tenant **organisation** layer plus consulting-delivery tracking (clients, projects, Kanban) ported from the prior Spresso app onto the existing Metis workspace. Built on branch `feature/org-projects-clients-kanban`.

## What it is

Every workspace user now belongs to an **organisation** (auto-created at signup). On top of that sit three delivery surfaces under `/account`:

- **Clients** — client records with contacts and contracts; each contract carries Cloudinary-backed **document attachments**.
- **Projects** — units of work, optionally tied to a client, with members and a per-project activity feed.
- **Kanban** — a board per project: columns + cards, drag-to-move and drag-to-reorder columns, a tabbed card modal (Details / Comments / History / Files), labels, org-member assignees, a completion meter + timeline, and a team-members manager.

## Data model (migrations 0025 + 0026)

15 additive tables, all UUID PK, snake_case, FK-indexed:

`organisation`, `organisation_member`, `client`, `client_contact`, `client_contract`, `contract_attachment`, `project`, `project_member`, `project_activity`, `kanban_column`, `kanban_card`, `kanban_card_comment`, `kanban_card_attachment`, `card_label`, `card_label_assignment`.

`0025_natural_war_machine.sql` creates the first 14 + adds nullable `organisation_id` to 9 existing tables and backfills a default org per user (idempotent, with a row-count invariant assert). `0026_light_mysterio.sql` adds `contract_attachment`. Both are hand-hardened to be **idempotent and re-runnable** (`CREATE TABLE IF NOT EXISTS`, `DO $$ … duplicate_object` FK guards, `CREATE INDEX IF NOT EXISTS`) because `scripts/db-apply.mjs` runs each statement non-transactionally.

## Access control

- `lib/auth/org-context.ts` — `resolveOrgContext` (per-`(user, org)` role, nil-cookie → backfill default org), `requireOrgContext(request, {mutation})` (wraps CSRF same-origin), `requireRole`, `orgAuthErrorResponse`. Every org/client/project/kanban service is org-scoped: a resource is only reachable when its `organisation_id` matches the caller's org (IDOR guard via the parent join). Proven by pglite cross-org isolation tests.
- Role matrix (D6): owner = all; admin = CRUD clients/projects/members + regen join key; member = work in projects, no destructive client/org ops. Contract + project-member writes require owner|admin.
- **Layer 3 (org-scoping the EXISTING features — chat/skills/workflows/social/brain) behind `ORG_SCOPING_ENABLED` is NOT built.** The flag is read per-request; until cutover, existing features keep today's `where(userId)` behaviour byte-for-byte.

## Attachments (Cloudinary)

DB-driven via the admin **Integrations → Media Storage** panel ([[integration-config]]); env fallback `CLOUDINARY_*`. `lib/cloudinary.ts` does a server-only signed upload (`node:crypto` sha1, no SDK dep). Two parallel services — `lib/kanban-attachments/` (card → project → org) and `lib/contract-attachments/` (contract → client → org) — share the same IDOR pattern. 50 MB cap; 503 when storage is unconfigured. `components/ui/attachments-panel.tsx` is the reusable files UI (used by contracts; the Kanban card Files tab is inline for its tab-count badge).

## Dates

`components/ui/date-field.tsx` — an Australian **DD/MM/YYYY** calendar control replacing every native `<input type="date">` (Chromium ignores the page locale for native date inputs). `formatAuDate` formats date-only values by string parts (no timezone). Card due-dates render UTC-pinned so the day never drifts across timezones.

## Verification

949 → 964 vitest tests (service + pglite cross-org isolation + migration idempotency), tsc + lint clean. Cloudinary upload verified end-to-end against a real `res.cloudinary.com` row. UI flows (drag, column reorder, card modal tabs, contract modal, social publish, dates, project client + team members) click-tested by Rob.

## Migration / deploy status

Migrations `0025` + `0026` are applied to **both DEV and the live Render PROD database** (2026-06-15; `pg_dump` backup taken first). `0025` is **schema-only** — it does NOT backfill orgs. `createDefaultOrgForUser` runs only at registration, so the 9 pre-existing PROD users were backfilled separately (a one-time run of the same idempotent function's logic): each now owns a default org with an owner membership. PROD verified: 9 users → 9 orgs → 9 memberships, 0 users without an org, schema in sync with DEV. **Remaining:** merge PR #155 so the Render web service deploys the code (and verify the deploy actually completes — auto-deploy has silently failed before). DEV test data is NOT and should NOT be copied to PROD.

## Not built / deferred

- Layer 3 org-scoping of existing features (behind `ORG_SCOPING_ENABLED`).
- Board filters + Focus mode (search / priority filter / focus toggle).
- Per-project role editing in the team-members manager (only add/remove exist).
- `/account/clients/[id]` deep-link route (clients live on one page; the project header links to the list).
