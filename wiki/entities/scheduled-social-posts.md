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

- **Delete is a hard delete, not a soft-cancel.** Before 2026-06-17 `DELETE` set `status = 'cancelled'` and the row lingered in the list forever with no way to remove it. It now actually deletes the row. Deletable states are `pending` / `failed` / `cancelled` (`DELETABLE_STATUSES`) — mirroring the Delete buttons the UI shows. `processing` (mid-publish) and `published` (history) are each rejected with a `409`. Legacy `cancelled` rows now carry a Delete button so they can be cleared.
- **The delete is atomic.** It runs as a single conditional statement — `DELETE … WHERE id = ? AND user_id = ? AND status IN (DELETABLE_STATUSES)` with `.returning()`. The status predicate closes the TOCTOU window: if the cron flips the row to `processing` between the existence check and the delete, the row no longer matches and the route returns `409` instead of yanking it out from under a running publish.
- **Deletion is confirmed in the UI.** Clicking Delete swaps the action buttons for a "Delete permanently? This can't be undone." prompt with Delete / Keep. Nothing is removed until the second tap. State: `confirmingDeleteId`.
- **Edit only applies to `pending` posts.** `PATCH` returns `409` for any other status. Server-side, content is re-validated against `PLATFORM_MAX_CHAR_LIMITS` (the hard ceiling: twitter 25 000, linkedin 3 000, bluesky 300) using the row's stored `platform` — the same ceiling `POST` enforces. Client-side, the editor caps at the **effective** limit via `effectiveLimit()`, which honours the X-Premium flag in `localStorage` (`archos_x_premium`) exactly like the publish modal: non-premium Twitter = 280, premium = 25 000. Without this the editor would let a non-premium user save an oversized tweet that fails at publish.
- **Ownership.** Both `PATCH` and `DELETE` fetch the row scoped to `user.user.id` (IDOR check) and the `DELETE` statement is itself scoped by `userId` as defence in depth.

## Deliberately not built

- No edit/delete from the **Posted** tab — published records are history (the API rejects deleting them too).
- No X-Premium **toggle** in the editor — it only *reads* the flag the publish modal set. To change premium state a user flips it in the compose modal.
