---
title: Posts Admin (Phase D) — UI slice
category: decision
created: 2026-05-20
updated: 2026-05-20
related: [[2026-05-20-posts-admin-phase-d-backend]], [[translation-layer]], [[2026-05-20-translation-layer-public-render]], [[2026-05-18-pages-cms-expansion]]
---

Slice B of Phase D — the UI surface that sits on top of the backend shipped in [[2026-05-20-posts-admin-phase-d-backend]]. Reshape of `/admin/blog` into a tabbed parent (Settings | Posts) + the full editor for the 120-post needs_review queue + net-new authoring.

## Locked-in decisions

- **`/admin/blog` becomes a tabbed shell** via a new `layout.tsx` + `BlogSubNav` client component. Two tabs today (Settings | Posts); new tabs slot in by adding to the `tabs` array + dropping a `page.tsx`. The existing toggle page at `/admin/blog/page.tsx` keeps working as-is — the layout just wraps it.
- **List view at `/admin/blog/posts`** is URL-driven for filter + search + page state. `searchParams` drive `listPostsForAdmin(query)` server-side so deep links + refresh keep state. Filter pills (All | Draft | Scheduled | Published | Needs review | Archived) update the URL via `router.push` inside `startTransition`. Archive / restore actions hit the admin API and call `router.refresh()`.
- **Single `PostForm` for both create + edit** (mode = `initial !== undefined`), mirroring the Pages CMS pattern. Author + category dropdowns are pre-loaded server-side so the form opens with everything it needs.
- **Live preview = client-side `react-markdown`** in a sibling `PreviewPane` component that mirrors `PostBody`'s component overrides minus `rehype-slug` + `HeadingCopyLinkButton`. `useDeferredValue` debounces the markdown state so typing stays fast. Same XSS posture as the public renderer (no `rehype-raw`).
- **Schedule validation: client renders messages based on field-presence only; server (Zod + `enforceScheduleInvariant`) is the truth.** A first draft tried to compute "is the picked time in the past?" during render — ESLint flagged it as impure (`Date.now()`), and rightly so. The fix: `<input type="datetime-local" min={nowAtMount}>` nudges the picker; the server rejects late submissions with `InvalidScheduleError` → 400. The cron-flip race window is the same one the server defends with `WHERE status='scheduled'`.
- **Datetime stored as local in the form, sent as UTC ISO to the API.** The browser's local timezone is what humans want to type; the API's `scheduledPublishAt` column is `timestamp with time zone` and the cron compares to `now()` (UTC).
- **AI-assist buttons unlock after first save.** Regenerate OG, suggest internal links, mark reviewed — all require a `postId`, which doesn't exist on a brand-new post until the create POST returns. UI greys + tooltips them on the create page; the post-create redirect to `/admin/blog/posts/[id]` makes them live within one save round-trip.
- **Side-effect warnings surface inline on save.** The API returns `{ post, sideEffects: { ogRegenerated, embeddingRegenerated, ogError?, embeddingError? } }`. If either failed, the save banner switches to amber and lists the failure: "✓ Saved · new revision created · OG regen failed (…)". The save itself committed — these are non-blocking.
- **Link suggestions drawer mounts as a fixed overlay** (right-side slide-in). Backdrop click + close button + Esc dismiss. Fresh fetch each open (no client-side cache) so the suggestions reflect the latest draft text. Insert action wraps selected text or drops a markdown link at the cursor, then closes.
- **Optimistic locking via `expectedUpdatedAt`** mirrors the Pages CMS exactly. 409 + `reason: "stale_updated_at"` → amber banner with "Someone else saved this post. Reload / Dismiss." User can choose to reload (loses local changes) or dismiss (next save still overwrites because `expectedUpdatedAt` is what was loaded — this is the documented Pages-CMS behaviour).
- **Mark reviewed = PUT with `needsReview: false`**. Reusing the standard update path means it writes a revision row tagged with the admin's session, gives a clean audit trail, and respects optimistic locking. Avoided a separate `/api/admin/posts/[id]/mark-reviewed` endpoint that would have duplicated the optimistic-lock + revision logic.
- **Auto-published revision rows surface in the timeline.** When the cron flips a scheduled post to published, it writes a `post_revision` row with `savedBy='scheduler-cron'`. The revisions page tags those with an indigo "auto-published" badge so the audit story is legible.

## Architectural decisions

### Skipping Playwright + authenticated visual QA in this PR

The project has no existing Playwright config or `tests/e2e/` directory. Setting up Playwright with admin-auth fixtures + test-data lifecycle is a multi-hour effort that deserves its own PR — separating it from the UI slice keeps both PRs reviewable. Visual QA via the existing `scripts/screenshot.mjs` needs an admin session cookie that I can't acquire from chat (per stored memory). Both are deferred to follow-up PRs; ship-readiness is verified via the existing CI gates (tsc + test + lint + wiki:lint + build).

### Preview parity instead of a separate preview server

Tried: render-via-server with a `/api/admin/posts/preview` endpoint that returns server-rendered HTML. Rejected: adds a server round-trip per keystroke (even debounced), creates a divergence risk between editor preview and public rendering, and the security boundary (no `rehype-raw`) is already enforced at the renderer level. Client-side render with the same component overrides is identical visually + structurally to what `/blog/[slug]` produces, at zero round-trip cost.

### Inline schedule message instead of toast

Inline beats toast for a form-level constraint — the user is looking at the field, the message belongs near the field. Saves a toast component dependency too.

## What ships in Slice B

| Surface | Path | Purpose |
|---|---|---|
| Layout | `app/admin/(authed)/blog/layout.tsx` | Tabbed shell wrapping every `/admin/blog/*` page |
| Sub-nav | `app/admin/(authed)/blog/blog-sub-nav.tsx` | Two-tab horizontal nav (Settings + Posts) |
| Posts list (server) | `app/admin/(authed)/blog/posts/page.tsx` | searchParams → listPostsForAdmin → PostsList |
| Posts list (client) | `app/admin/(authed)/blog/posts/posts-list.tsx` | Filter pills + search box + table + pagination + archive/restore |
| Create page | `app/admin/(authed)/blog/posts/new/page.tsx` | Preloads authors + categories, wraps empty PostForm |
| Edit page | `app/admin/(authed)/blog/posts/[id]/page.tsx` | Preloads post + lookups, wraps PostForm with `initial` |
| PostForm | `app/admin/(authed)/blog/posts/post-form.tsx` | All form state, save handler, optimistic locking, side-effect surfacing, AI-assist buttons |
| Preview pane | `app/admin/(authed)/blog/posts/preview-pane.tsx` | Client-side react-markdown render mirroring PostBody |
| Link drawer | `app/admin/(authed)/blog/posts/link-suggestions-drawer.tsx` | Slide-in overlay calling suggest-links + inserting at cursor |
| Revisions page (server) | `app/admin/(authed)/blog/posts/[id]/revisions/page.tsx` | Loads post + revision list |
| Revisions page (client) | `app/admin/(authed)/blog/posts/[id]/revisions/revisions-client.tsx` | Expand/restore actions; tags current / material change / auto-published |
| Service helpers | `lib/posts-admin/types.ts`, `lib/posts-admin/index.ts` | Adds `AuthorLookup` + `CategoryLookup` types + `listAuthorsForAdmin` / `listCategoriesForAdmin` functions |

Verification: `pnpm tsc` + `pnpm test` (40 files / 526 tests / all green) + `pnpm lint` (clean, one pre-existing `tmp/walkthrough.mjs` warning unrelated) + `pnpm wiki:lint` (0 hard errors, 0 warnings) + `pnpm build` (all 5 new admin/blog routes compiled).

## Out of scope (deferred to future PRs)

- **Playwright E2E setup** — config, auth fixtures, test-data lifecycle, CRUD/schedule/needs-review/live-preview specs. Own PR because the infra setup is itself substantial.
- **Authenticated visual QA via `scripts/screenshot.mjs`** — requires admin session cookie; not on the AI to acquire.
- All deferred Slice A items remain deferred (see [[2026-05-20-posts-admin-phase-d-backend]] "Out of scope" section): featured-image upload UI, AI-generate-excerpt, draft auto-archive, RSS regen on publish, multi-author UX, inline image upload, internal-link auto-insertion, post-performance analytics, comments, A/B title testing, LinkedIn cross-post.

## How this completes Phase D

With Slice A (backend, PR #72) + Slice B (UI, this PR) merged, the per-post admin is fully usable:
- Rob can author drafts in the editor with live preview
- Schedule any post for future auto-publish via the datetime picker
- Filter the 120-post needs_review queue and clear it post-by-post
- Restore prior revisions when an edit goes wrong
- Use suggest-links to discover internal-link opportunities from the existing 253-post embedding corpus

Backlog items [[backlog]] 37 + 38 transition from 🟡 partial → ✅ fully shipped.
