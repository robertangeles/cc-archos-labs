---
title: Chat Attach Files
category: entity
created: 2026-07-07
updated: 2026-07-07
related: [[deployment-architecture]], [[integration-config]], [[org-consulting-workspace]], [[blog-featured-image-upload]], [[2026-07-07-attach-fresh-conversation-races]]
---

Attach a text document to a Metis chat conversation; its extracted text becomes part of that conversation's context for every following turn.

## What it does

Users click the paperclip in the chat input, pick a PDF / TXT / MD / DOCX, and the document's text is injected into the conversation so the model answers grounded in it (e.g. "summarize this", "what does clause 4 say"). Shipped as v1 core in **PR #183** (2026-07-07); live in PROD.

## Architecture

- **Storage (private, admin-controllable):** confidential documents live in a **private** Cloudflare R2 bucket (`archos-labs-chat-docs`), configured via the DB-backed admin Integrations panel ("Chat Documents (Cloudflare R2)", AES-GCM encrypted at rest — NOT env vars; see [[integration-config]]). Served ONLY through the authz'd proxy `GET /api/chat/documents/:id/file` (Content-Type + Range passthrough; never a public URL). `lib/r2-chat-documents.ts`.
- **Extraction:** `pdf-parse` (PDF) + `mammoth` (.docx) + native (.txt/.md), with a 15s timeout (DoS guard) and scanned-PDF detection ("image support coming"). `lib/extract-text.ts` + `lib/chat/attachments/extract.ts`.
- **Context budget:** reads the *configured* model's `context_length` from OpenRouter (cached) and fits system + attachments + history inside the window — trims oldest history, omits low-priority docs. `lib/chat/attachments/budget.ts`.
- **Injection:** `lib/chat/stream.ts` folds an `<attached_documents>` block into the system message (prompt-injection wrapper; filenames sanitized against structural escape) and uses trimmed history. Covers the standard / web-search / perplexity paths, excludes image-gen. Graceful-degrade so a missing table can't abort chat.
- **Data model:** user-owned `document` + `conversation_document` join (migration `0031`). Owner-scoped throughout — chat is **userId-only** (no `orgId`). Reuse-across-conversations picker is deferred (schema is ready).
- **Routes:** `POST/GET /api/chat/conversations/:id/attachments`, `DELETE .../attachments/:documentId`, `GET /api/chat/documents/:documentId/file`.
- **UI:** paperclip → hidden file input → chips above the input (Linear DESIGN.md tokens: surface-2 + hairline + rounded-md; spinner / ready / error states, `×` to remove). `components/chat/chat-input.tsx` + `app/account/workspace/chat-workspace.tsx`. **PR2** added drag-and-drop + paste-to-attach with a "Drop to attach" overlay (E1), a char-count + text-snippet trust preview on ready chips (E2), click-the-filename to open the doc in a new tab via the authz'd proxy (E3), and a11y polish — `aria-live="polite"` chip list + focus-visible rings (F4).
- **Cleanup:** conversation-delete + account-delete delete the R2 objects (Postgres can't); detach is ref-counted.

## PROD status

Live 2026-07-07. Migration `0031` applied to PROD (see [[deployment-architecture]]); the R2 "Chat Documents" integration was configured separately in PROD (secrets are per-env, not migrated). Attachments return a clean 503 if storage isn't configured; chat is unaffected.

## Verification

`tsc` + `eslint` clean; unit tests for extraction + budget (incl. a filename-injection regression, added by the `pr-reviewer` gate); full suite 1188/1188 green. Verified end-to-end with a live smoke test in DEV (attached a doc, the model returned all distinctive facts from it). **PR2** added a Playwright E2E (`tests/e2e/chat-attach-files.spec.ts`) that registers a fresh user, attaches a `.txt`, and asserts the ready chip (proving the full upload → extract → private-R2 store → DB insert path), then detaches. E2E is a local-only check — CI runs install/lint/tsc/vitest/build, not Playwright.

### Two race-condition fixes the PR2 E2E surfaced (latent since PR1)

Both broke *attaching to a **fresh** conversation* (the manual PR1 smoke test used an existing conversation, so neither showed):

1. **Emptied FileList** — `handleAttachFiles` read the live `FileList` *after* `await newChat()`, but the `<input>`'s `onChange` clears `value = ""` synchronously, which empties that live list → zero files uploaded. Fix: snapshot `Array.from(files)` **before** any `await`.
2. **Stale-load clobber** — attaching creates the conversation, which makes it active and fires the load-attachments effect; that empty first load raced the in-flight upload and wiped the optimistic chip. Fix: a consume-once `skipAttachLoadRef` skips exactly that one pointless load (the client is authoritative for a just-created conversation); genuine conversation switches still reload from the server. See [[2026-07-07-attach-fresh-conversation-races]].

## Deferred (fast-follow)

Images / scanned PDFs (vision pipeline); reuse-across-conversations picker; prompt caching; citations; auto-title. Full design + review trail: `~/.gstack/projects/robertangeles-cc-archos-labs/robangeles-main-design-20260706-161301.md`.
