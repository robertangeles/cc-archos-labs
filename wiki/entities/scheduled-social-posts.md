---
title: Scheduled Social Posts — CRUD lifecycle
category: entity
created: 2026-06-17
updated: 2026-06-17
related: [[state]], [[deployment-architecture]]
---

The full create/read/update/delete lifecycle for a user's scheduled social posts at `/account/scheduled-posts`, backed by the `scheduled_social_post` table and the `/api/social/scheduled` routes.

## Surface

- **UI:** [components/social/scheduled-posts-list.tsx](../../components/social/scheduled-posts-list.tsx) — two tabs (Scheduled / Posted). Composition happens in [components/social/publish-modal.tsx](../../components/social/publish-modal.tsx).
- **List + create:** [app/api/social/scheduled/route.ts](../../app/api/social/scheduled/route.ts) — `GET` (list) and `POST` (create).
- **Update + delete:** [app/api/social/scheduled/[id]/route.ts](../../app/api/social/scheduled/[id]/route.ts) — `PATCH` (edit) and `DELETE` (remove).
- **Publish:** the `process-scheduled-social` cron picks up `pending` rows whose `scheduledFor` has passed.

## The four operations

| Op | Trigger | Behaviour |
| --- | --- | --- |
| **Create** | "New Post" → publish modal, schedule toggle | `POST` inserts a `pending` row per selected platform |
| **Read** | the list | `GET` returns each post + a 200-char `contentPreview` **and** the full `content` (needed for inline editing) |
| **Update** | "Edit" on a pending card | `PATCH` accepts `scheduledFor` + `displayTimezone` + optional `content`; inline editor edits text **and** schedule together |
| **Delete** | "Delete" → confirm → "Delete" | `DELETE` **hard-removes** the row |

## Non-obvious rules (read before changing)

- **Delete is a hard delete, not a soft-cancel.** Before 2026-06-17 `DELETE` set `status = 'cancelled'` and the row lingered in the list forever with no way to remove it. It now actually deletes the row. The only block is `status === 'processing'` (mid-publish) → `409`, so we never race the cron publisher. Legacy `cancelled` rows are still listed and now carry a Delete button so they can be cleared.
- **Deletion is confirmed in the UI.** Clicking Delete swaps the action buttons for a "Delete permanently? This can't be undone." prompt with Delete / Keep. Nothing is removed until the second tap. State: `confirmingDeleteId`.
- **Edit only applies to `pending` posts.** `PATCH` returns `409` for any other status. Content is re-validated server-side against `PLATFORM_MAX_CHAR_LIMITS` (twitter 25 000, linkedin 3 000, bluesky 300) — the same ceiling `POST` enforces — using the row's stored `platform`.
- **Ownership.** Both `PATCH` and `DELETE` fetch the row scoped to `user.user.id` (IDOR check) and the `DELETE` query is itself scoped by `userId` as defence in depth.

## Deliberately not built

- No edit/delete from the **Posted** tab — published records are history.
- No per-platform char-limit toggle (X Premium) in the inline editor; it uses the max ceiling, which the server accepts. The X-Premium toggle lives only in the publish modal.
