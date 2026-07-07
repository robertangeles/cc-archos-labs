---
title: Chat Attach Files
category: entity
created: 2026-07-07
updated: 2026-07-07
related: [[deployment-architecture]], [[integration-config]], [[org-consulting-workspace]], [[blog-featured-image-upload]]
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
- **UI:** paperclip → hidden file input → chips above the input (Linear DESIGN.md tokens: surface-2 + hairline + rounded-md; spinner / ready / error states, `×` to remove). `components/chat/chat-input.tsx` + `app/account/workspace/chat-workspace.tsx`.
- **Cleanup:** conversation-delete + account-delete delete the R2 objects (Postgres can't); detach is ref-counted.

## PROD status

Live 2026-07-07. Migration `0031` applied to PROD (see [[deployment-architecture]]); the R2 "Chat Documents" integration was configured separately in PROD (secrets are per-env, not migrated). Attachments return a clean 503 if storage isn't configured; chat is unaffected.

## Verification

`tsc` + `eslint` clean; unit tests for extraction + budget (incl. a filename-injection regression, added by the `pr-reviewer` gate). Verified end-to-end with a live smoke test in DEV (attached a doc, the model returned all distinctive facts from it) before ship.

## Deferred (PR2 / fast-follow)

Drag-and-drop + paste (E1), extraction trust preview (E2), in-tab doc preview (E3), a11y polish (F4); images / scanned PDFs (vision pipeline); reuse-across-conversations picker; prompt caching. Full design + review trail: `~/.gstack/projects/robertangeles-cc-archos-labs/robangeles-main-design-20260706-161301.md`.
