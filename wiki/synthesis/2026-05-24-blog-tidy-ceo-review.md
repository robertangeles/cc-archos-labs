---
title: Blog tidy-up — CEO review
category: synthesis
created: 2026-05-24
updated: 2026-05-24
related: [[2026-05-20-posts-admin-phase-d-ui]], [[2026-05-20-posts-admin-phase-d-backend]], [[blog-featured-image-upload]], [[translation-layer]], [[backlog]]
---

CEO review of four blog pain points raised 2026-05-24. Three of four are not what they appear; one is a strategic reversal of a documented decision. Mode + framing pending user input before the review proceeds to Sections 1–11.

## The four reported pain points

1. **Suggested Links → "Insert link" does nothing on click.**
2. **No preview of a blog post.**
3. **Image upload requires saving the post first.**
4. **No world-class comment system.**

## PRE-REVIEW SYSTEM AUDIT — reality vs perception

Per CLAUDE.md "Before claiming a feature is unbuilt" rule — verified against [[state]] and the actual source.

### Item 1 — Insert Link button

**Verdict: REAL BUG, narrow surface.**

The drawer at [link-suggestions-drawer.tsx:167-176](../../app/admin/(authed)/blog/posts/link-suggestions-drawer.tsx#L167-L176) is wired correctly:

```tsx
onClick={() => {
  onInsertLink(`[${s.title}](/blog/${s.slug})`);
  onClose();
}}
```

The drawer fires the callback. The bug must be in the parent `post-form.tsx`'s `onInsertLink` prop — either:
- The handler isn't bound to the textarea ref
- The textarea ref is stale after a `useDeferredValue` cycle
- Cursor position isn't being captured before the drawer steals focus (likely culprit — opening a modal moves `document.activeElement`)

**Fix surface:** 1 file, ≤20 LOC, +1 unit test for cursor restoration. P1.

### Item 2 — Preview

**Verdict: FALSE PREMISE. Preview ships. The full-chrome experience does not.**

Live split-pane markdown preview ships at [preview-pane.tsx](../../app/admin/(authed)/blog/posts/preview-pane.tsx). Documented in [[2026-05-20-posts-admin-phase-d-ui]] line 16: *"Live preview = client-side `react-markdown` in a sibling `PreviewPane` component that mirrors `PostBody`'s component overrides."* `useDeferredValue` debounces. Renders side-by-side with the editor.

**What the preview pane does NOT show:**
- Site header + nav + footer
- Post header (author byline, date, category chips, hero image, reading time)
- Table of contents ([components/blog/toc.tsx](../../components/blog/toc.tsx))
- Social share row ([components/blog/social-share.tsx](../../components/blog/social-share.tsx))
- Read-next recommendations ([components/blog/read-next.tsx](../../components/blog/read-next.tsx))
- Author bio ([components/blog/author-bio.tsx](../../components/blog/author-bio.tsx))

So the real ask is: *"I want to see the post the way a reader will see it."* That's a different feature — a full-chrome SSR preview route, not a missing live-render.

**Two real options to scope:**

| Option | Shape | Effort (human / CC) |
|---|---|---|
| **A. "View as published" link** | `/blog/[slug]?preview=1` works for drafts when admin cookie present; renders the full `/blog/[slug]` page tree against draft data | ~3h / ~25min |
| **B. Dedicated preview route** | `/admin/blog/posts/[id]/preview` SSR composes `<PostHeader>` + `<PostBody>` + `<ReadNext>` + `<AuthorBio>` from draft state | ~4h / ~30min |

A is leaner (one route + one client-side feature flag check + one auth gate). B is more isolated (no public route understands "draft" — safer XSS posture).

### Item 3 — Image upload requires save

**Verdict: REAL ARCHITECTURAL CONSTRAINT. Three escape hatches.**

The route is `PUT /api/admin/posts/[id]/image` ([state.md line 73](../state.md)). Image goes to R2 keyed by post ID. No `postId` → nowhere to put the image. By design from [[blog-featured-image-upload]] + [[2026-05-20-posts-admin-phase-d-ui]] line 19.

**The "why the hell" is fair.** Notion, Substack, Ghost all let you drag in an image before the first save — they auto-create a draft on first keystroke. Three escape hatches, ordered by surgical-ness:

| Option | Approach | Tradeoffs |
|---|---|---|
| **A. Auto-create draft on first input** | First non-empty keystroke fires `POST /api/admin/posts` with empty body → returns `id` → URL replaces to `/admin/blog/posts/[id]` → image upload now valid | Solves the actual user pain. Creates empty drafts if user navigates away. Mitigation: 90-day auto-archive (already on the deferred list, [backlog.md line 192](../backlog/backlog.md#L192)) |
| **B. Temp-prefix R2 uploads + claim on save** | New `POST /api/admin/uploads/temp` returns `{tempId, url}`; save call accepts `tempImageId` and moves the object | Architecturally cleaner. More moving parts (orphaned-temp cleanup cron, claim transaction). Higher surface area |
| **C. Accept the constraint, fix the UX** | Show the image dropzone greyed-out on create with copy: "Save once to attach an image — takes a second." Make the "Save draft" button extremely prominent. Auto-focus image after redirect | Cheapest. Doesn't actually solve the friction — just labels it |

A is the right answer. The "user navigates away" failure mode is already solved by the deferred 90-day auto-archive item.

### Item 4 — Comment system

**Verdict: STRATEGIC REVERSAL. Recommend NOT building.**

[backlog.md line 198](../backlog/backlog.md#L198) explicitly says: *"Comments / discussion — not a planned surface for this brand."* That was a deliberate prior decision, not an oversight.

**Why it was rejected then:**
- Moderation burden on a one-person practice
- Spam pressure (the prior WP install was hit hard, per the migration inventory)
- Low-signal discourse degrades the practitioner positioning
- Comments visually compete with the CTA stack (book a call / take the assessment)

**Reference set — who has comments on a practitioner-led B2B consulting blog?** Stratechery: no. Patrick McKenzie's bits: no. A16Z: no. FirstRound Review: no. Stripe Press: no. Ben Evans: no. Every comparable surface routes engagement through email + LinkedIn + Twitter, not on-site comments.

**What "world-class engagement" actually looks like for this brand:**

| Mechanism | Why it beats comments | Where it lives in the backlog |
|---|---|---|
| **Newsletter capture (D1)** | Owned audience, repeat exposure, lead source for sales | Backlog item 35 (deferred from Phase D) |
| **"Reply by email" CTA** | High-signal feedback, low infra, ends in Rob's inbox where it becomes consulting conversation | Not yet on backlog |
| **Quoted-share highlights** | Stratechery pattern — readers select text → tweet card. Discoverability + status game | Not yet on backlog |
| **LinkedIn comment funnel** | Modelling Room newsletter is already LinkedIn-native ([[translation-layer]]); cross-post brings the discussion to where the audience already is | Existing channel |
| **End-of-post CTA → call** | Already shipped on `/blog/[slug]` | Live |

A comment system would cost ~2 weeks (auth + moderation + spam + UI + email notifications + admin queue) and likely make the brand *worse*, not better. **Recommend: kill this scope. Replace with Newsletter D1 + "Reply by email" CTA.**

## Step 0A — Premise Challenge

> Is this the right problem to solve? Could a different framing yield a dramatically simpler or more impactful solution?

The user framed this session as "tidy up the blog." The real shape of the four asks:

| Pain point | Real problem | Real category |
|---|---|---|
| Insert Link broken | One bug in `post-form.tsx` cursor handling | Bug fix |
| No preview | Markdown preview exists; full-chrome preview doesn't | Missing feature, scoped |
| Save before image | Authoring friction in the create-draft flow | UX gap with 3 known patterns |
| World-class comments | Strategic reversal of a brand decision | **Wrong problem** — engagement, not comments |

Three of four are tactical and right-sized. The fourth is the most important question of the session and the answer is "don't build it; build the better thing instead."

## Step 0B — Existing Code Leverage

| Sub-problem | What already exists | Reuse plan |
|---|---|---|
| Markdown render | `<PreviewPane>` + `<PostBody>` (shared overrides) | A full-chrome preview composes existing block components — zero net-new render logic |
| Image upload pipeline | `PUT /api/admin/posts/[id]/image` + Sharp normalisation + R2 + 11 og_image_* cols | Auto-create-draft only needs a `POST /api/admin/posts` with empty body — that route exists today (used by `/admin/blog/posts/new`) |
| Internal-link suggestions | `POST /api/admin/posts/[id]/suggest-links` + 1024-dim HNSW embeddings | Insert-Link bug is parent-side only; backend stays as-is |
| Newsletter | `newsletter_signup` schema already shipped in PR #61 | D1 (item 35) is mostly UI + Resend wiring — schema is done |
| Reader-side engagement | `<SocialShare>`, `<ReadNext>`, end-of-post CTAs | A "Reply by email" CTA is one component + one mailto: pattern — sits beside `<SocialShare>` |

The plan rebuilds **nothing**. Every fix reuses an existing path.

## Step 0C — Dream State Mapping

```
  CURRENT (2026-05-24)         THIS TIDY-UP            12-MONTH IDEAL
  ───────────────────          ─────────────           ────────────────
  Live markdown preview        + full-chrome           Author writes a post end-
  Insert-Link broken           "View as published"     to-end on mobile in 20min
  Image needs save             + Insert-Link fix       Drag image in → publish →
  No newsletter                + auto-create-draft     auto-cross-post LinkedIn +
  No comments (intentional)    + Newsletter D1         appears in subscriber inbox
  120 posts in review queue    + "Reply by email"      Reply emails route to
                               + decline comments      Slack/CRM. Zero on-site
                                                       comments. Newsletter
                                                       converts to book/[slug].
```

**This tidy-up moves the system TOWARD the 12-month ideal** — it doesn't burn time on a comment system that would have to be ripped out later.

## Step 0C-bis — Implementation Alternatives (MANDATORY)

Three approaches for the bundle of work this session represents.

### APPROACH A — Surgical fixes only (HOLD SCOPE)

- **Summary:** Fix Insert-Link bug. Ship "View as published" preview route. Auto-create-draft on first input. Decline comments — write a one-line decision doc explaining why.
- **Effort:** S (human ~1 day / CC ~1.5h)
- **Risk:** Low
- **Pros:** Smallest diff. Ships in one PR. Three real pains gone. Brand discipline kept.
- **Cons:** Doesn't replace the engagement loop the user is actually asking for (item 4 was a proxy for "I want readers to talk back").
- **Reuses:** `<PreviewPane>`, `POST /api/admin/posts`, existing block components.

### APPROACH B — Surgical fixes + Newsletter D1 + Reply-by-email (SELECTIVE EXPANSION) ← RECOMMENDED

- **Summary:** Everything in A, plus ship Newsletter D1 (already-designed item 35 from the Phase D deferral list) and add a "Reply by email" CTA component to `/blog/[slug]`. These together replace the comments ask with the right primitive for this brand.
- **Effort:** M (human ~3–4 days / CC ~3–4h)
- **Risk:** Low–Medium (Newsletter D1 requires Resend list management; well-trodden path)
- **Pros:** Answers the *underlying* ask in item 4 with the right brand primitive. Newsletter is a documented Phase D commitment that's been waiting — bundling it makes sense. "Reply by email" is genuinely 1 component + a mailto. Sets up Newsletter → Book conversion funnel.
- **Cons:** PR gets larger. Newsletter D1 should arguably be its own PR for rollout safety.
- **Reuses:** Everything in A + `newsletter_signup` schema (shipped) + Resend client (shipped) + double-opt-in pattern from magic-link (shipped).

### APPROACH C — Build the comments system (REJECTED — listed for completeness)

- **Summary:** Auth-gated comments, moderation queue, spam filtering, email notifications, admin UI.
- **Effort:** XL (human ~2 weeks / CC ~1.5 days)
- **Risk:** High (ongoing moderation cost forever; spam is a moving target)
- **Pros:** Literally answers the asked question.
- **Cons:** Reverses a deliberate brand decision. Adds a permanent operational burden to a one-person practice. Visually competes with the CTA stack on every post. No comparable practitioner-led B2B blog does this. Costs more than items 1–3 combined.
- **Reuses:** Nothing — entirely net-new surface.

**RECOMMENDATION: APPROACH B.** It fixes the three real bugs/gaps cleanly AND addresses the underlying engagement need with the right primitives — without paying the comment-system tax that would later need to be ripped out.

## Step 0F — Mode Selection (pending user)

Default recommendation: **SELECTIVE EXPANSION** mode, executing APPROACH B.

The framing is: hold scope as "tidy up the blog" (items 1, 2, 3 surgical) + cherry-pick Newsletter D1 and Reply-by-email as the right answer to item 4. Decline comments as a deliberate brand decision and document the why.

Alternative modes if user disagrees:

- **HOLD SCOPE** → APPROACH A. Ship the three real fixes. Comments and engagement get their own future session.
- **SCOPE EXPANSION** → A + B + a third bet (e.g. quoted-share highlights, audio versions, /search Cmd-K from D2). For a tidy-up session this is probably overshooting.
- **SCOPE REDUCTION** → Just Insert-Link bug + image auto-draft. Defer preview-chrome. Defer everything else. Right if the user is in a "ship one PR before lunch" mood.

## Locked decisions

| # | Decision | Locked answer | Why |
|---|---|---|---|
| **D1** | Mode + approach | **B — SELECTIVE EXPANSION** | Confirmed by user 2026-05-24 |
| **D2** | Preview route shape | **`/admin/blog/posts/[id]/preview` dedicated route** | Cleaner auth boundary — public route never has to understand "draft" semantics. Safer XSS posture. Cost is one extra route file vs threading a `?preview=1` flag through the public render path |
| **D3** | Auto-create-draft trigger | **First non-empty keystroke in the title field** (debounced 300ms) | Title is the lowest-cost "I'm committing to this draft" signal. Body-first triggers more accidental drafts. Notion uses this exact pattern |
| **D4** | Newsletter D1 — bundle vs split | **Split — Newsletter D1 ships as its own PR after the tidy-up PR** | Newsletter D1 has its own deploy risk (Resend list mgmt, double-opt-in flow, admin list UI). Bundling expands the review surface and slows the Insert-Link bug fix. Tidy-up PR ships first |
| **D5** | Reply-by-email placement | **Single CTA at the end of `<PostBody>`, before `<SocialShare>`** | One location, high-intent moment (just finished reading). No sidebar competition with the existing CTAs |

Sections 1–11 below assume these answers.

## Section 1 — Architecture Review

### Preview route — auth + data flow

```
  Author clicks "Preview"          Admin cookie present?
        │                                  │
        ▼                                  │
  /admin/blog/posts/[id]/preview ──── auth gate ──── 401 redirect to /admin/login
        │ (server component)
        ▼
  Load draft from DB (any status: draft|scheduled|needs_review|published)
        │
        ▼
  Compose: <Header> + <PostHeader draft={...}> + <PostBody contentMd={draft.contentMd}>
           + <ReadNext slug={draft.slug || "preview"}> + <AuthorBio> + <Footer>
        │
        ▼
  Render — identical to /blog/[slug] except: noindex meta + "PREVIEW" badge
```

**Decision recorded:** preview route reads from the same `posts` table the public renderer uses; no "draft staging" duplication. The renderer is purely a function of `(post, author, category, related)` — so the preview route loads draft data and passes it through the same component tree. No divergence risk.

### Auto-create-draft — race window

```
  Author types "H" in title field (first non-empty char)
        │
        ▼ (debounced 300ms)
  POST /api/admin/posts {title: "H", contentMd: "", status: "draft"}
        │
        ▼
  Returns {id: "uuid-1"}
        │
        ▼
  Client: router.replace(`/admin/blog/posts/uuid-1`)
        │  (image dropzone now unlocks)
        ▼
  Author keeps typing → subsequent saves PATCH /api/admin/posts/uuid-1
```

**Race window:** Author types two characters within 300ms of each other → only one POST fires (debounce). Author types one char then immediately tabs to the image field within 300ms → image dropzone is still locked at click time. Mitigation: image dropzone shows "Creating draft…" spinner that resolves when `router.replace` completes; click queues the upload until then.

### Single point of failure — Resend list-management for Newsletter D1

Existing `lib/email.ts` covers transactional sends. Newsletter D1 needs Resend Audiences API (subscriber list management) — a separate code path with its own error modes. **Architectural decision deferred to Newsletter D1's own PR** (per D4 split). For this PR, no change.

### What this plan does NOT touch

- `lib/posts-admin/*` service layer — unchanged
- `lib/embeddings.ts` — unchanged
- `lib/og.ts` — unchanged
- `lib/image-pipeline.ts` — unchanged
- Drizzle schema — unchanged (no migration in this PR)

**Verdict:** Clean. No issues.

## Section 2 — Error & Rescue Map

| Method / codepath | What can go wrong | Exception | Rescued? | Rescue action | User sees |
|---|---|---|---|---|---|
| `POST /api/admin/posts` (auto-create) | DB connection pool exhausted | `ConnectionPoolError` | Y | Return 503; client shows "Couldn't create draft — retry?" | Inline error under title field with retry button |
| `POST /api/admin/posts` (auto-create) | Title fails Zod min-length after trim | `ZodError` | Y | 400; client doesn't trigger auto-create on whitespace-only input | Nothing visible — client-side guard |
| `router.replace(...)` after auto-create | Navigation interrupted by Next.js abort | `AbortError` | Y | Keep local state; next save uses freshly-returned id | Nothing visible |
| `<PostForm>` → `onInsertLink(markdown)` | Textarea ref null (was unmounted) | `null deref` | **CURRENT BUG** | None | **CURRENT BUG: nothing happens** |
| `/admin/blog/posts/[id]/preview` | Draft soft-deleted between author click + load | `RecordNotFound` | Y | Show "This draft has been archived. [Back to list]" | Friendly error page, no 500 |
| `/admin/blog/posts/[id]/preview` | `contentMd` contains malformed markdown | None thrown — `react-markdown` is fault-tolerant | N/A | N/A | Renders partial — same as public renderer |
| `<ReadNext>` inside preview | No similar posts (new draft, no embedding yet) | None | Y | `<ReadNext>` already handles empty array | Section silently omitted |

**Insert-Link bug — root cause hypothesis (Debugging Protocol Step 3 — labelled [Inference]):**
[Inference] When the drawer opens, `document.activeElement` moves from the textarea to the drawer's backdrop button. On click of "Insert link", the drawer's `onClose()` fires, unmounting the drawer; React commits the unmount before the parent's `onInsertLink` handler runs. The parent reads `textareaRef.current.selectionStart` — by which point either the ref is stale or `selectionStart` is 0 (because the textarea lost focus). The link is inserted at position 0 silently, or the handler short-circuits on a `null` selection.

**Confirmation needed before fix:** read `app/admin/(authed)/blog/posts/post-form.tsx` and identify the actual `onInsertLink` body and ref usage. Fix is bounded to that file.

**Verdict:** One critical gap (Insert-Link). One graceful-degradation path that needs explicit handling (auto-create-draft pool exhaustion). The rest are clean.

## Section 3 — Security & Threat Model

### New attack surfaces

| Surface | Risk | Mitigation |
|---|---|---|
| `/admin/blog/posts/[id]/preview` | If misrouted, could leak draft content (often pre-publication: NDAs, embargoed names, unpublished pricing strategy) | Same admin auth middleware that protects `/admin/(authed)/*` — wraps via the layout. Add `noindex` meta + `Cache-Control: private, no-store` |
| `POST /api/admin/posts` (auto-create with empty body) | Abuse vector — flood the `posts` table with empty drafts | Already rate-limited per admin session (admin auth scope); add per-session debounce on client AND 1-second server-side rate limit (low ceiling: 60 auto-creates/hour/admin) |
| Reply-by-email mailto: link | Email harvesting if the address is exposed in HTML | `mailto:rob@archoslabs.xyz?subject=...` is intentional — Rob's address is already public on `/contact` and `/about`. Same address. No new exposure |

### Prompt injection — unchanged

`POST /api/admin/posts/[id]/suggest-links` is unchanged. Existing input validation + admin auth scope holds.

### XSS posture for preview

Preview uses the same `<PostBody>` component as public render. `no rehype-raw` already strips raw HTML from markdown. **Same XSS posture as public** — verified in [preview-pane.tsx:11](../../app/admin/(authed)/blog/posts/preview-pane.tsx#L11) comment.

**Verdict:** No new high-severity threats. One medium-severity item (auto-create abuse) mitigated with rate limit.

## Section 4 — Data Flow & Interaction Edge Cases

### Auto-create-draft — interaction edge cases

| Interaction | Edge case | Handled? | How |
|---|---|---|---|
| Author types in title | Slow network — POST takes 4s | Y | Title input remains active; "Creating draft…" indicator next to image dropzone; image dropzone clickable but click queues until `router.replace` resolves |
| Author types in title | Network fails | Y | Show inline error under title: "Couldn't create draft — [Retry]". Title preserved client-side |
| Author types in title | Auth cookie expired | Y | 401 → redirect to `/admin/login?next=/admin/blog/posts/new` |
| Author tabs to image before draft created | Click on dropzone | Y | Dropzone shows "Creating draft…" overlay; click queues |
| Author hits Cmd+S before debounce fires | Manual save with empty draft state | Y | Cmd+S triggers immediate flush of the debounce → POST fires → redirect → save proceeds normally |
| Author navigates away during create | Browser closes tab mid-POST | N → orphan empty draft | Mitigated by 90-day auto-archive (backlog item — defer) |
| Author opens two tabs of `/admin/blog/posts/new` | Both create separate drafts on first type | Y | Two distinct uuids, two distinct drafts — same as if author clicked "New post" twice |

### Preview — interaction edge cases

| Interaction | Edge case | Handled? |
|---|---|---|
| Author clicks Preview with unsaved changes | Preview shows last-saved version, not draft state | Y | Resolution: button copy reads "Preview saved version" + secondary "Save then preview" affordance. Saving + preview happens in one click via the secondary button (save → wait → open preview in new tab) |
| Preview opened, then admin logs out in another tab | Preview tab still loaded; refresh shows 401 | Y | Standard admin auth flow — redirect to login |
| Preview of a `published` post | Shows the same content as public route | Y | Intentional — preview mirrors public exactly |

### Insert-Link — once fixed

| Interaction | Edge case | Required behaviour |
|---|---|---|
| Textarea has no text yet | Insert at position 0 | Insert link as-is — no surrounding text to wrap |
| Textarea has selection | Wrap selection with `[selected text](/blog/slug)` | Use `selectionStart` + `selectionEnd` from the saved snapshot taken BEFORE drawer opens |
| Cursor at end of text | Insert at end with no trailing space | Standard insertion |
| Multiple suggestions inserted in one drawer session | Each insertion closes drawer (current behaviour) | Acceptable — user reopens for next link |

**Fix imperative for Insert-Link:** snapshot `selectionStart`/`selectionEnd`/`scrollTop` BEFORE the drawer opens (in the "Open suggestions" button's onClick), pass that snapshot down as a prop, restore on insert. Cursor restoration is the standard pattern for modal-driven text edits.

**Verdict:** One unhandled edge case (tab-close orphan drafts) deferred to 90-day auto-archive backlog item.

## Section 5 — Code Quality Review

| Area | Finding |
|---|---|
| DRY | Preview route composes existing block components (`<PostHeader>`, `<PostBody>`, `<ReadNext>`, `<AuthorBio>`). Zero duplication |
| Naming | New route file: `preview/page.tsx` — matches existing `[id]/revisions/page.tsx` pattern |
| Error handling | Cursor snapshot is the only new abstraction needed; one helper in `post-form.tsx` or a tiny `lib/text-cursor.ts` if reused elsewhere later. Don't pre-abstract |
| Edge cases | Auto-create-draft must guard against whitespace-only titles (Zod `min(1).trim().min(1)`) |
| Over-engineering | Resist creating a `usePreviewState` hook — preview is server-rendered. No client state |
| Under-engineering | Don't ship Insert-Link fix without a unit test for cursor restoration. The bug recurs trivially under React 19's auto-batching |
| Cyclomatic complexity | `<PostForm>` is already large; this PR shouldn't grow it by more than ~30 LOC (auto-create-draft handler + cursor snapshot + image-dropzone "Creating draft…" state) |

**Verdict:** Hold the line on `post-form.tsx` size. If the auto-create-draft state machine pushes the file past ~600 LOC, extract a `useAutoCreateDraft` hook in a follow-up PR — not in this one.

## Section 6 — Test Review

| New surface | Test type | Coverage required |
|---|---|---|
| Insert-Link cursor restoration | Unit (vitest + jsdom) | Cursor at 0 / cursor at end / selection range / textarea unmounted (returns no-op) |
| `POST /api/admin/posts` empty-body auto-create | Integration | Happy path, whitespace-only title rejected, rate-limit at 60/hour, 401 without admin cookie |
| Auto-create-draft client flow | Unit | Debounce fires on first non-empty char; cancels if char deleted within debounce window; doesn't fire twice |
| Image dropzone "Creating draft…" state | Unit | Disabled before postId; click queues; auto-uploads after `router.replace` resolves |
| `/admin/blog/posts/[id]/preview` route | Integration | Renders with admin cookie; 401 without; 404 for soft-deleted; `noindex` meta present; `Cache-Control: private, no-store` set |
| Preview composition | Snapshot test | Header + PostHeader + PostBody + ReadNext + AuthorBio + Footer order matches `/blog/[slug]` |

### LLM/prompt changes
None in this PR. Existing eval suites not affected.

### Test ambition check
- **Friday-night-at-2am test:** "Can I auto-create a draft, upload a hero image, hit preview, see it as a reader would, and the Insert-Link works on the first try? Yes." Lock that as the manual smoke test in the PR description.
- **Hostile-QA test:** type 1 char in title, immediately Ctrl-W the tab. Confirm no orphan-creation panic in logs. Type whitespace only — confirm no draft created. Open preview for a soft-deleted draft — confirm friendly error, not 500.

**Verdict:** ~6 new tests required. All within the existing vitest+jsdom toolchain. Playwright E2E remains deferred per the standing Phase D decision.

## Section 7 — Performance Review

| Concern | Status |
|---|---|
| Auto-create-draft DB write amplification | Mitigated by client-side debounce (300ms) + Zod-rejected whitespace. Worst case: one INSERT per actually-started draft. Acceptable |
| Preview route SSR cost | Same as `/blog/[slug]` render — typically <100ms. No new bottleneck |
| Preview cache strategy | **None.** Preview is `private, no-store`. Author needs fresh state every render. Correct choice |
| N+1 queries on preview | Preview loads `(post, author, category, ReadNext candidates)` — `<ReadNext>` already uses the HNSW embedding lookup (single query). No N+1 |
| Insert-Link cursor snapshot perf | Reading `selectionStart` is a synchronous DOM access, ~microseconds. Not a concern |

**Verdict:** No performance concerns introduced.

## Section 8 — Observability & Debuggability Review

| Surface | Logging | Metric |
|---|---|---|
| Auto-create-draft POST | Structured log: `{event: "post.auto_create", postId, adminId}` | Counter — daily auto-creates per admin |
| Insert-Link click → insertion | Structured log: `{event: "post.insert_link", postId, targetSlug, success: bool}` | Counter — Insert-Link success rate (must rise from current ~0% to >95% post-fix) |
| Preview route render | Structured log: `{event: "post.preview_render", postId, status: "draft"|"published"|...}` | Counter — preview opens per draft (light usage signal) |
| Auto-create-draft failures | Error log: `{event: "post.auto_create_failed", reason, adminId}` | Alert if >5/hour for one admin (suggests broken client) |

**Runbook for Insert-Link regression:** if the success-rate counter drops below 90% week-over-week, regression has been introduced. Reproduce locally by opening drawer + closing within 50ms (mid-React-batch window).

**Verdict:** Telemetry to confirm the fix works is mandatory. Don't ship blind.

## Section 9 — Deployment & Rollout Review

| Concern | Plan |
|---|---|
| DB migration | **None** in this PR. All schema unchanged |
| Feature flag | **None.** Insert-Link fix + preview route + auto-create-draft are admin-only surfaces; trunk-based ship is safe |
| Rollback plan | `git revert <commit>` + push. Each of the three changes is independently revertible |
| Deploy-time risk window | Zero. No public-facing changes. Public `/blog/[slug]` untouched |
| Post-deploy verification | 1) Open `/admin/blog/posts/new`, type "Hello" — confirm redirect to `[id]`. 2) Click Insert-Link in drawer — confirm markdown link appears at cursor. 3) Click Preview — confirm full-chrome render |
| Smoke test | The three steps above, manually. Documented in PR description |

**Newsletter D1 PR** (separate, per D4 split) will have its own deployment plan including the `newsletter_enabled` site_setting flag.

**Verdict:** Lowest-risk deploy class. Single PR, all admin-scope, revertible.

## Section 10 — Long-Term Trajectory Review

| Concern | Assessment |
|---|---|
| Tech debt introduced | Minimal. Cursor snapshot is the only new pattern; will likely be reused if/when a rich-text editor lands |
| Path dependency | None. Preview route is additive; auto-create-draft replaces friction with a standard pattern |
| Knowledge concentration | Document the cursor-snapshot pattern in a one-paragraph comment at the call site. That's enough |
| Reversibility | **5/5.** All three changes are isolated and revertible |
| Ecosystem fit | Auto-create-draft matches Notion/Substack/Ghost. Preview route matches Pages CMS pattern at `/admin/pages/[id]/revisions`. No drift |
| 1-year question | A new engineer reading `post-form.tsx` in 12 months will see: a debounced auto-create on title input, a cursor-snapshot helper for modal text inserts, a preview button that opens a dedicated route. Obvious |

**Trajectory check — does this set up the next thing?**
- Auto-create-draft generalises to inline image upload (the deferred backlog item) — same `postId`-required problem
- Cursor-snapshot generalises to any future modal-driven text edit (autocomplete, AI-rewrite-paragraph)
- Preview route composes the existing block components — the moment those move to Server Components, preview moves with them for free

**Verdict:** Strong forward trajectory. No debt traps.

## Section 11 — Design & UX Review

### DESIGN_SCOPE detected
Auto-create-draft state visible in the editor. Preview is a new full-chrome route. Reply-by-email is a new public surface.

### Interaction state coverage

| Feature | Loading | Empty | Error | Success |
|---|---|---|---|---|
| Auto-create-draft | "Creating draft…" inline next to image dropzone | N/A (only fires on non-empty input) | Inline error under title with Retry | Silent — URL updates, dropzone unlocks |
| Preview route | Standard Next.js loading.tsx (already exists for `/admin/(authed)`) | "This draft has been archived" friendly card | 401 → redirect to login | Full-chrome render with "PREVIEW" badge top-right |
| Reply-by-email CTA | N/A — `mailto:` is synchronous | N/A | N/A — browser handles | N/A |

### AI slop risk
"PREVIEW" badge must NOT be a generic pill component lifted from a Vercel template. Match the existing `<Pill>` component ([components/ui/pill.tsx](../../components/ui/pill.tsx)) so the brand voice carries. Copy: just the word "PREVIEW" in monospace. No emoji.

### DESIGN.md alignment
Preview route uses the same `markdown-body` class chain that `<PostBody>` uses. Token alignment is automatic.

### Responsive intention
Preview route must render on mobile — Rob writes on phone occasionally per the brand voice rule "Mobile first." Snapshot test should include 390px width.

### Accessibility basics
- Insert-Link button (post-fix): `aria-label="Insert link to <post title>"`
- "Reply by email" CTA: clear text, not just an envelope icon
- Preview badge: `role="status"` for screen readers

### Recommendation
After this PR ships, consider running `/plan-design-review` on the Newsletter D1 PR before implementing — newsletter capture is the highest-stakes design surface in the Phase D follow-up tier.

**Verdict:** Design intentionality is high. No slop risks.

## What's NOT in scope (regardless of mode)

- Inline image upload in editor body (separate R2 endpoint; deferred per [[2026-05-20-posts-admin-phase-d-ui]] "Out of scope")
- A/B title testing (premature for current readership scale)
- Comment system (declined by this review — see Item 4 above. Documented as a brand decision in [[backlog]] line 198)
- Post-performance analytics dashboard (depends on Plausible — backlog item 41)
- Multi-author UX (single-admin today)
- Rich-text editor (TipTap/Lexical) — markdown is correct for this brand; revisit only if the friction shows up in real authoring sessions
- Bundling Newsletter D1 into this PR (per D4 split)

## What already exists (reused, not rebuilt)

- `<PreviewPane>` — kept as-is for the inline split-pane markdown render during editing
- `<PostHeader>`, `<PostBody>`, `<ReadNext>`, `<AuthorBio>` — composed into the new preview route
- `POST /api/admin/posts` — already supports empty-body create (used by `/admin/blog/posts/new`); auto-create wraps the existing endpoint
- `PUT /api/admin/posts/[id]/image` — unchanged; the change is the client-side gating, not the route
- `<SocialShare>` — Reply-by-email CTA sits as a sibling, same row
- `newsletter_signup` schema — shipped in PR #61; D1 PR consumes it without migration

## Dream state delta

This tidy-up moves the system **forward** on the 12-month trajectory:
- Authoring friction drops (auto-create-draft + working Insert-Link)
- Preview parity with reader experience
- Comment-system decision documented as deliberate, not absent
- Newsletter D1 set up as the next clean PR — no plumbing left to build

## Error & Rescue Registry

| Method/codepath | Failure | Exception | Rescued? | Rescue action | User sees |
|---|---|---|---|---|---|
| `POST /api/admin/posts` (auto-create) | DB pool exhausted | ConnectionPoolError | Y | 503 + retry UI | "Couldn't create draft — Retry" |
| `POST /api/admin/posts` (auto-create) | Whitespace-only title | ZodError | Y | Client guard; never fires | Nothing |
| `<PostForm>` Insert-Link | Textarea ref stale | null deref | **Y (post-fix)** | Cursor snapshot pattern | Markdown link appears at saved cursor |
| `/admin/blog/posts/[id]/preview` | Draft soft-deleted | RecordNotFound | Y | Friendly card | "This draft has been archived" |
| `/admin/blog/posts/[id]/preview` | Auth cookie expired | AuthError | Y | Redirect | `/admin/login?next=...` |

## Failure Modes Registry

| Codepath | Failure mode | Rescued? | Test? | User sees? | Logged? |
|---|---|---|---|---|---|
| Insert-Link (current) | Cursor lost on drawer open | N | N | **Silent — nothing happens** | N |
| Insert-Link (post-fix) | Cursor lost on drawer open | Y | Y (unit) | Link appears at saved cursor | Y |
| Auto-create-draft | Network failure mid-POST | Y | Y (integration) | Inline retry | Y |
| Auto-create-draft | Tab closed mid-POST | N → orphan draft | N | None | Y (server-side) |
| Preview route | Soft-deleted draft | Y | Y (integration) | Friendly card | Y |
| Auto-create abuse | Whitespace flood | Y | Y (rate limit) | 429 | Y |

**Critical gaps: 1.** Insert-Link silent failure — fixed by this PR. **Tab-close orphan drafts** mitigated by the deferred 90-day auto-archive (backlog item).

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — post-form — **Fix Insert-Link cursor restoration**
  - Surfaced by: Section 2 (Error & Rescue Map) — current bug verified, root cause [Inference] in Section 2
  - Files: `app/admin/(authed)/blog/posts/post-form.tsx`, `app/admin/(authed)/blog/posts/link-suggestions-drawer.tsx` (pass snapshot prop)
  - Verify: Unit test for cursor restoration (4 cases per Section 6) + manual smoke (open drawer with cursor at position 47, click Insert link, confirm markdown lands at position 47)

- [ ] **T2 (P1, human: ~2h / CC: ~20min)** — admin/blog — **Auto-create draft on first title keystroke**
  - Surfaced by: Section 1 (auto-create-draft data flow) — solves Item 3 friction
  - Files: `app/admin/(authed)/blog/posts/new/page.tsx`, `app/admin/(authed)/blog/posts/post-form.tsx`, `app/api/admin/posts/route.ts` (add 1-second per-session rate limit)
  - Verify: Unit (debounce + whitespace guard) + integration (rate limit + 401 + happy path) + manual smoke (type "H" → URL updates within ~500ms → image dropzone unlocks)

- [ ] **T3 (P1, human: ~3h / CC: ~25min)** — admin/blog — **Add `/admin/blog/posts/[id]/preview` full-chrome route**
  - Surfaced by: Item 2 reality check — markdown preview ships, full-chrome does not
  - Files: `app/admin/(authed)/blog/posts/[id]/preview/page.tsx` (new), `app/admin/(authed)/blog/posts/[id]/preview/preview-frame.tsx` (new — composes existing block components + "PREVIEW" badge)
  - Verify: Integration (admin cookie / no cookie / soft-deleted / noindex header / Cache-Control header) + snapshot test (composition matches `/blog/[slug]` at 390px and 1280px)

- [ ] **T4 (P2, human: ~30min / CC: ~5min)** — admin/blog — **"Preview" button in PostForm header (next to Save)**
  - Surfaced by: T3 needs a launch point
  - Files: `app/admin/(authed)/blog/posts/post-form.tsx` — add button, opens preview route in new tab
  - Verify: Click opens preview in new tab; button disabled if `mode === "create"` and no postId yet

- [ ] **T5 (P2, human: ~30min / CC: ~5min)** — components/blog — **"Reply by email" CTA component**
  - Surfaced by: Section 11 (Design & UX) — replaces the comments ask with the right primitive for this brand
  - Files: `components/blog/reply-by-email.tsx` (new), `app/blog/[slug]/page.tsx` (composition — slot before `<SocialShare>`)
  - Verify: Renders mailto: link with sensible subject ("Re: <post title>"); click opens default mail client; mobile tap target ≥44px

- [ ] **T6 (P2, human: ~15min / CC: ~3min)** — observability — **Add Insert-Link success counter**
  - Surfaced by: Section 8 — confirms the fix in production
  - Files: `app/admin/(authed)/blog/posts/post-form.tsx` — fire structured log on insert
  - Verify: Local dev — open drawer, insert link, see log line in console

- [ ] **T7 (P2, human: ~30min / CC: ~5min)** — wiki — **Document the comments decision + Reply-by-email pattern**
  - Surfaced by: Item 4 reality check — strategic reversal needs a written record
  - Files: `wiki/decisions/2026-05-24-no-comments-reply-by-email.md` (new), `wiki/index.md` (add entry)
  - Verify: `pnpm wiki:lint` clean; entry appears in index under decisions

- [ ] **T8 (P3, human: ~5min / CC: ~2min)** — backlog — **Promote Newsletter D1 to next-up**
  - Surfaced by: D4 — separate PR confirmed
  - Files: `wiki/backlog/backlog.md` — bump item 35 priority + note it's the next blog-tidy follow-up
  - Verify: Backlog reflects new priority order

- [ ] **T9 (P3, human: 0 / CC: 0)** — _deferred to Newsletter D1 PR_ — Newsletter capture UI + double-opt-in
  - Surfaced by: D4 split — out of scope for this PR
  - Files: N/A this PR
  - Verify: N/A this PR

**Effort summary:** P1 = ~6h human / ~55min CC. P2 = ~1h45min human / ~18min CC. Single-PR scope is T1+T2+T3+T4+T5+T6+T7 ≈ 7h45min human / ~73min CC. Realistic ship window: one focused day.

## Engineering Review (added 2026-05-24)

Ran `/plan-eng-review` against the CEO plan. Verified inferences against source. Three load-bearing findings revised the implementation shape; T1–T7 stay valid, but T1 + T2 + T3 + T4 need design changes.

### Step 0 — Scope check

Plan touches ~10 files (post-form.tsx, link-suggestions-drawer.tsx, posts/route.ts + schema.ts, new preview/page.tsx, new preview-frame.tsx, blog/[slug]/page.tsx, reply-by-email.tsx, tests, wiki). Right at the 8-file complexity threshold. Each change is small and serves a single user pain. **HOLD SCOPE** — no reduction. The plan is right-sized.

### E1 — `POST /api/admin/posts` rejects empty/minimal body (T2 redesign required) — confidence 10/10

[post/route.ts:72-84](../../app/api/admin/posts/route.ts#L72-L84) hard-validates against `PostCreateSchema` (from [lib/posts-admin/schema.ts](../../lib/posts-admin/schema.ts)). The form's POST body at [post-form.tsx:181-199](../../app/admin/(authed)/blog/posts/post-form.tsx#L181-L199) supplies 14 fields including `slug`, `title`, `contentMd`, `status`, `visibility`, `tags`, `scheduledPublishAt`, `authorId`, `categoryId`. The CEO plan's "POST with empty body" is impossible against this schema.

Two unique constraints in play:
1. **Slug is required AND unique** — duplicate-slug error: `DuplicateSlugError` → HTTP 409 at [route.ts:90-92](../../app/api/admin/posts/route.ts#L90-L92). Auto-generating from title creates collision risk on common titles.
2. **Title is also required** (likely `min(1)` in schema).

Three real options for T2:

| Option | Shape | Tradeoffs |
|---|---|---|
| **E1.a — Extend `PostCreateSchema` to make slug + contentMd + tags optional, server-generates defaults** | `slug` defaults to `slugify(title) + '-' + nanoid(4)` if absent (avoids collision). `contentMd` defaults to `''`. `tags` defaults to `[]`. Other fields stay required | Smallest diff. Reuses the existing endpoint. Server-generated slug is editable on first save. ~10 LOC schema change + 5 LOC defaults |
| **E1.b — Add a dedicated `POST /api/admin/posts/draft` endpoint** | Accepts only `{ title }`. Server fills everything else. Returns the new postId | Cleanest separation. Doesn't pollute the full-post create path with optionality. ~30 LOC new route + handler. More moving parts |
| **E1.c — Keep manual save, drop T2 from this PR** | Accept the friction. Ship T1+T3+T4+T5+T6+T7 only | Cheapest. Means "Save before image upload" stays a known papercut. User explicitly asked for this fix |

**Recommendation: E1.a.** Smallest diff, reuses the endpoint, keeps the API surface flat. Slug collision is the only real risk, mitigated by `+nanoid(4)` suffix on auto-generated slugs (4 chars of url-safe entropy = ~6M possibilities, collision on a single admin is functionally zero).

**Decision pending — surfaced as E1 question below.**

### E2 — Insert-Link root cause is "no cursor was ever set", not "cursor lost on focus steal" — confidence 9/10

Verified by reading [post-form.tsx:437-464](../../app/admin/(authed)/blog/posts/post-form.tsx#L437-L464):

```tsx
function insertLinkAtCursor(markdown: string) {
  const ta = contentRef.current;
  if (!ta) { /* fallback append */ return; }
  const start = ta.selectionStart ?? contentMd.length;
  const end = ta.selectionEnd ?? contentMd.length;
  // ... insert ...
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(cursor, cursor);
  });
}
```

The code IS well-formed. The cursor restoration via `requestAnimationFrame` is correct. So why "Insert link does nothing"?

[Inference, confidence 9/10] **The user opens the drawer from the "Suggest internal links" button (line 900-912) WITHOUT first clicking into the textarea.** `selectionStart` for a never-focused `<textarea>` is `0`. The link inserts at position 0 — the very top of a long article. The user's viewport is scrolled to where they were reading. They see nothing change in the visible region. They conclude "Insert link does nothing."

Verify hypothesis: in dev, open a post with >2000 chars, scroll to the bottom, open drawer (don't touch the textarea first), click Insert link. The link will appear at the top — confirm by scrolling up.

**Correct fix shape (replaces T1 as written):**

1. Add a `lastFocusedCursor` ref: `useRef<{start: number, end: number} | null>(null)`
2. Add `onBlur` and `onSelect` handlers to the textarea that snapshot `{selectionStart, selectionEnd}` to the ref on every cursor change
3. In `insertLinkAtCursor`: if `document.activeElement !== contentRef.current`, use the snapshot ref instead of reading from the textarea (which may report 0 if never focused)
4. **Fallback if the ref is null** (user never touched the textarea at all): default to inserting at END of content with a leading newline — not at position 0. Position 0 is the worst possible default because it's off-screen for any scrolled-down view

This is ~20 LOC of changes (one new ref, two new event handlers, one branch in `insertLinkAtCursor`). Same effort as the CEO plan estimated, different shape.

### E3 — Preview route is NOT a thin composition of existing components — confidence 10/10

Verified by reading [app/blog/[slug]/page.tsx](../../app/blog/[slug]/page.tsx). Three concrete gaps the CEO plan glossed over:

| Gap | Why it matters | Fix |
|---|---|---|
| **JSON-LD emission (lines 87-99)** — Article/Person/Breadcrumb schemas | Drafts have null `publishedAt`. `articleSchema(post, ...)` will either throw on null OR emit invalid JSON-LD with `null` datePublished. Either way, breaks the preview render | Skip JSON-LD entirely in the preview composition. Preview has `noindex` so no SEO loss |
| **`post.publishedAt` access (line 110)** | `<PostHeader>` receives `publishedAt={post.publishedAt}` — null for drafts | Either pass `publishedAt={post.publishedAt ?? new Date()}` with a "DRAFT PREVIEW" badge in the header, OR conditional render of the date line. The first is simpler |
| **`getReadNext(post.id, 3)` (line 70)** | Draft posts may have no embedding yet (embedding generated on save, per the side-effect surface). `getReadNext` queries the HNSW index — empty result is fine, but if the post is brand new the embedding lookup against a non-indexed row is a no-op anyway | Tolerable — `<ReadNext>` already handles empty array. Add a try/catch around `getReadNext` and pass `[]` on failure |

**Also missing from CEO plan:** preview route needs a "PREVIEW" badge (mentioned in CEO Section 11), but Section 11 also said "match the existing `<Pill>` component" — that pill is at [components/ui/pill.tsx](../../components/ui/pill.tsx) and is `default` styled, not "fixed-position banner over the page." A pill in the corner gets lost in the chrome. The preview indicator should be a **persistent top banner** (like Vercel's preview bar) so the author cannot mistake a draft preview for a published page. ~15 LOC of CSS + one component.

**Decision: T3 effort revised from ~3h human / ~25min CC → ~4h human / ~35min CC.** Same task, more careful composition required. Not a scope change — just a corrected estimate.

### E4 — Auto-create-draft slug collision handling — confidence 8/10

If E1.a is chosen, the auto-create endpoint generates slug from title. Two admins (or one admin in two tabs) typing similar titles within seconds creates a collision window. The `DuplicateSlugError` path at [route.ts:90](../../app/api/admin/posts/route.ts#L90) returns 409.

**Fix:** server retries with a fresh `+nanoid(4)` suffix up to 3 times before propagating the 409. ~5 LOC in the service layer at `lib/posts-admin/index.ts::createPost`. Already a known service-layer responsibility, not new.

### E5 — Mobile preview path — confidence 7/10

The published `/blog/[slug]` route uses a grid `lg:grid-cols-[760px_minmax(0,1fr)]` at [page.tsx:102](../../app/blog/[slug]/page.tsx#L102). On mobile, this collapses to single column. **Preview route must inherit this responsive behavior**, otherwise the author sees a desktop-only preview and ships unread mobile drift. Same Tailwind classes; if T3 reuses `<PostHeader>`/`<PostBody>`/`<Toc>` as-is, the responsive layout comes for free. Add a snapshot test at 390px to verify.

### E6 — Force-dynamic preview perf — confidence 9/10

Published route is `export const dynamic = "force-dynamic"` ([page.tsx:34](../../app/blog/[slug]/page.tsx#L34)). Preview route MUST also be force-dynamic (drafts never cache). Acceptable cost: ~100ms per render on warm origin, ~2-3s on cold. Author iterating "preview → edit → preview" pays this every cycle.

**Mitigation:** standard Next.js `loading.tsx` fallback gives perceived-fast loading. No code change needed if we accept the cold-start cost on Render hobby tier. Tradeoff is fine for an admin-only surface.

### Coverage diagram (synthesizing T1–T7 against existing test suite)

```
CODE PATHS                                                  USER FLOWS
[T1] insertLinkAtCursor() in post-form.tsx                  [T1] Drawer → Insert link
  ├── happy: cursor at position N                             ├── [GAP] No-prior-focus case → defaults to END
  │   └── [GAP] Unit (vitest+jsdom)                           ├── [GAP] After typing in textarea then opening drawer
  ├── no focus + null ref → fallback END                      ├── [GAP] With text selected (wrap mode)
  │   └── [GAP] Unit                                          └── [GAP] On very long content (>10kb)
  ├── no focus + ref present → snapshot or END
  │   └── [GAP] Unit
  └── with selection wrap
      └── [GAP] Unit

[T2] auto-create-draft trigger                              [T2] Type "H" in title field
  ├── First non-empty title keystroke (debounced)             ├── [GAP] [→E2E] Type → URL updates → image unlocks
  │   └── [GAP] Unit (debounce + whitespace guard)            ├── [GAP] Network error → retry inline
  ├── POST /api/admin/posts with E1.a schema                  ├── [GAP] Slow network → "Creating draft…" state
  │   ├── [GAP] Integration (happy path)                      └── [GAP] Tab Cmd+S during debounce window
  │   ├── [GAP] Integration (slug collision retry)
  │   ├── [GAP] Integration (rate limit at 60/hr/admin)
  │   └── [GAP] Integration (401 without admin cookie)
  └── router.replace + image-dropzone unlock
      └── [GAP] Unit

[T3] /admin/blog/posts/[id]/preview route                   [T3] Click Preview button
  ├── Admin cookie present → render                           ├── [GAP] [→E2E] Open preview for draft post
  │   ├── [GAP] Integration (renders for draft)               ├── [GAP] Open preview at 390px (mobile)
  │   ├── [GAP] Integration (renders for scheduled)           ├── [GAP] Preview for soft-deleted draft
  │   └── [GAP] Integration (renders for published)           └── [GAP] Preview after auth expiry
  ├── No cookie → 401 redirect
  │   └── [GAP] Integration
  ├── Soft-deleted draft → friendly card
  │   └── [GAP] Integration
  ├── noindex meta + Cache-Control: private, no-store
  │   └── [GAP] Integration (header assertions)
  ├── null publishedAt (draft) → no JSON-LD emission
  │   └── [GAP] Integration (assert <script type=application/ld+json> absent)
  └── getReadNext failure tolerant
      └── [GAP] Unit (mock getReadNext throw, assert [])

[T4] Preview button in PostForm                             [T4] Button visible + functional
  ├── Disabled when !isEdit                                   ├── [GAP] Unit (disabled state)
  └── Opens preview route in new tab                          └── [GAP] Unit (window.open call)

[T5] ReplyByEmail component                                 [T5] Reader clicks "Reply by email"
  ├── mailto: with sensible subject                           ├── [GAP] [→E2E] Click on /blog/[slug]
  └── Mobile tap target ≥44px                                 └── [GAP] Visual at 390px

[T6] Insert-Link success counter                            [T6] Telemetry confirms fix
  └── Structured log on insert                                └── [GAP] Manual smoke (check console)

[T7] Wiki decision doc — no code path, no test               (documentation only)

COVERAGE: 0/24 tests written (0%)  |  Code paths: 0/18 (0%)  |  User flows: 0/13 (0%)
GAPS: 24 (3 [→E2E], 0 [→EVAL])
```

**Regression test (mandatory per skill rule):** Insert-Link insertion-at-position-0 IS a regression — the current code produces it silently. T1's unit test for "no prior focus → default to END" is the regression test. Cannot be deferred.

### Test plan additions (CEO plan missed)

- **Preview route + null publishedAt:** snapshot test that `<PostHeader>` renders gracefully and no JSON-LD `<script>` tag appears
- **Auto-create slug collision retry:** integration test that posts two simultaneous creates with the same title-derived slug, asserts both succeed with different suffixes
- **Preview route at 390px:** snapshot test using vitest + jsdom matchMedia mock
- **getReadNext on draft with no embedding:** unit test that asserts empty array return, not a throw

### NOT in scope additions

- **TipTap/Lexical rich-text editor migration** — markdown stays. If authoring friction shows up, revisit
- **Server-side preview rendering for unauthenticated viewers** (e.g., share-a-draft links to clients) — different use case, different security posture, not raised
- **Inline image upload via paste/drag in the markdown textarea** — separate R2 endpoint scope, deferred per [[2026-05-20-posts-admin-phase-d-ui]]
- **Slug-rename redirect mechanism** — when auto-generated slugs get renamed, the original auto-slug 404s if it was crawled. Acceptable: drafts aren't indexed; published posts can already be renamed and 404 the old URL. Backlog item 47 covers this if it becomes a problem

### Eng review revisions to T1–T7

| Task | Revision |
|---|---|
| **T1** | Shape changes per E2 — add `lastFocusedCursor` ref + onBlur/onSelect handlers + null-snapshot fallback to END. Same ~1h human / ~10min CC |
| **T2** | Depends on E1 decision. If E1.a (recommended): also add `slugify(title) + nanoid(4)` server default + collision retry in service layer. Effort revised: ~3h human / ~25min CC |
| **T3** | Composition strategy revised per E3 — skip JSON-LD, handle null publishedAt with "DRAFT PREVIEW" badge, try/catch around getReadNext, persistent top banner instead of corner pill. Effort revised: ~4h human / ~35min CC |
| **T4** | Unchanged. ~30min human / ~5min CC |
| **T5** | Unchanged. ~30min human / ~5min CC |
| **T6** | Unchanged. ~15min human / ~3min CC |
| **T7** | Unchanged. ~30min human / ~5min CC |
| **Revised total** | ~10h human / ~88min CC (was ~7h45min / ~73min) |

### Failure modes — critical gaps after eng review

| Codepath | Failure | Rescued? | Test? | User sees? | Logged? |
|---|---|---|---|---|---|
| Insert-Link (current) | Insertion at position 0 silently | N | N | **Silent — invisible insertion at top of long article** | N |
| Insert-Link (post-T1-revised) | All cases | Y | Y (4 unit tests) | Link at last focused cursor or END | Y |
| Auto-create (E1.a) | Slug collision | Y (retry up to 3x) | Y (integration) | Slug uses suffix, save proceeds | Y |
| Auto-create (E1.a) | Title contains only emoji | Y | Y (whitespace guard catches by `String.prototype.trim()` behavior — emoji-only is non-empty) | Slug = `<empty>-nanoid` which is unusable. Need slug min-length guard | N |
| Preview route | Null publishedAt | **Y (after T3 revision)** | Y (snapshot) | "DRAFT PREVIEW" badge | N |
| Preview route | JSON-LD emission on draft | **Y (after T3 revision)** | Y (integration) | No JSON-LD in head | N |
| Preview route | getReadNext throws on missing embedding | **Y (after T3 revision)** | Y (unit) | ReadNext section absent | Y |

**Critical gaps remaining:** 1 — auto-create with emoji-only title producing unusable slug. **Add to T2 scope:** title slug-derivation must enforce a minimum length of 3 ASCII chars; if title doesn't yield enough, fall back to `draft-${nanoid(8)}` and let the author rename on first save.

### Performance review

| Concern | Status |
|---|---|
| Auto-create DB writes | One INSERT per non-empty title keystroke (debounced). Acceptable |
| Preview route force-dynamic | ~100ms warm, ~2-3s cold. Acceptable for admin-only surface |
| Insert-Link cursor snapshot | Synchronous DOM access via ref. Microseconds |
| Reply-by-email | Synchronous mailto. Zero perf cost |

No performance concerns introduced. No N+1, no missing indexes, no caching opportunities skipped.

### What this eng review found that the CEO review missed

1. The Insert-Link "bug" code is actually well-formed — the issue is upstream UX flow (no cursor ever set). Different fix shape
2. `POST /api/admin/posts` schema rejects empty body — T2 needs explicit schema work
3. Published route emits JSON-LD that breaks on drafts — T3 composition is more complex than "compose existing block components"
4. Slug uniqueness collision on auto-create is a real concurrency case
5. Emoji-only title → unusable slug edge case
6. Preview "PREVIEW" indicator needs to be a persistent banner, not a corner pill (a corner pill on a 760px-column draft gets lost in chrome)

## Locked engineering decisions

| # | Decision | Locked answer | Why |
|---|---|---|---|
| **E1** | T2 implementation strategy | **E1.a — Extend `PostCreateSchema`** | Confirmed by user 2026-05-24. Smallest diff, single endpoint, server-generated slug with nanoid(4) suffix avoids collision. Author renames auto-slug on first real save |

E2–E6 either confirm or refine implementation details — folded into the revised T1–T7 table above. The emoji-only-title critical gap is folded into T2 as a 3-char ASCII minimum + `draft-${nanoid(8)}` fallback.

### Final task delta from E1.a lock-in

| Task | Final shape |
|---|---|
| **T2** | (1) Extend `PostCreateSchema` in [lib/posts-admin/schema.ts](../../lib/posts-admin/schema.ts) — make `slug`, `contentMd`, `tags` optional. (2) In [lib/posts-admin/index.ts::createPost](../../lib/posts-admin/index.ts), generate defaults: `slug = slugifyTitle(title) + '-' + nanoid(4)`, `contentMd = ''`, `tags = []`. (3) If `slugifyTitle(title).length < 3`, fall back to `draft-${nanoid(8)}`. (4) Retry on `DuplicateSlugError` up to 3x with fresh suffix. (5) Client: debounced 300ms POST on first non-empty title keystroke. ~3h human / ~25min CC |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | Mode B locked; 4 expansions proposed, 2 accepted (Newsletter D1 deferred to separate PR, Reply-by-email accepted). Comments declined |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | Not run |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 6 findings (E1–E6) all resolved or folded into T1–T7; 1 critical gap (emoji-only slug) folded into T2 |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | Recommended next: T3 preview route + T5 Reply-by-email CTA + DRAFT PREVIEW persistent banner |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | Not applicable — no developer-facing API in this scope |

- **UNRESOLVED:** 0
- **VERDICT:** **CEO + ENG CLEARED** — ready to implement T1–T7. Recommended sequence: run `/plan-design-review` against T3 preview composition + T5 Reply-by-email + DRAFT PREVIEW banner before opening the PR (purely advisory — not required to ship)

