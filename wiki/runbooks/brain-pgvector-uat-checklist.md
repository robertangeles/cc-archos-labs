---
title: Local UAT — brain migration (GBrain → in-app pgvector)
category: runbook
created: 2026-07-16
updated: 2026-07-16
related: [[2026-07-16-brain-inapp-pgvector-migration]], [[deployment-architecture]]
---

Run this end-to-end by hand before shipping the brain migration — proves every existing memory function works on the pgvector backend and, above all, that memory is isolated per user (no cross-user leak = no privacy breach). ~20–30 min.

- **Branch:** `feature/inapp-pgvector-brain`
- **Critical:** start the server with `MEMORY_BACKEND=pgvector`, or you'll be testing the old GBrain path instead of the new one.
- PROD stays on GBrain (flag default) until a deliberate cutover — see [[2026-07-16-brain-inapp-pgvector-migration]].

## 0. Setup (one time)

- [ ] On branch `feature/inapp-pgvector-brain`. Run `pnpm install` if anything changed.
- [ ] Apply the migration on DEV (idempotent — safe to re-run):
      `pnpm db:migrate` → should show `0032_user_memory.sql` applied (or already applied).
- [ ] Start the dev server **in pgvector mode** (this is the whole point):
      `MEMORY_BACKEND=pgvector pnpm dev`
- [ ] Open http://localhost:3007 and confirm it loads.
- [ ] (Optional confidence, ~30s) run the automated proofs first:
  - Service + isolation canary (live embeddings + DB):
    `node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.eval.config.ts tests/eval/brain-pgvector.eval.test.ts`
  - Full UI isolation e2e (needs the pgvector dev server running):
    `pnpm test:e2e tests/e2e/brain-isolation.spec.ts`

## A. Capture — memory forms as you chat

- [ ] Register / log in as **User A**.
- [ ] Open the workspace chat. Send 2–3 messages with memorable facts, e.g.
      "My name is Rob", "I'm leading the Westpac lakehouse migration".
- [ ] Wait for each reply to finish. Go to **/account/brain** (My Brain).
- [ ] **PASS:** your messages appear as memories (newest first).

## B. Recall — Metis remembers you across sessions

- [ ] Start a **new conversation** (fresh chat).
- [ ] Ask: "What's my name?" and "What do you know about my project?"
- [ ] **PASS:** Metis answers from memory (Rob / Westpac lakehouse), without you
      repeating it this session.

## C. My Brain page — management

- [ ] /account/brain lists your memories, newest first.
- [ ] The search box filters them.
- [ ] Expand a card → full content shows.
- [ ] Delete one → it disappears; refresh confirms it's gone.
- [ ] **PASS:** list / search / expand / delete all work.

## D. Status + onboarding

- [ ] The workspace shows the "Brain" indicator once you have memories.
- [ ] **PASS:** indicator behaves (no console errors, no broken UI).

## E. ISOLATION — the privacy check (use TWO accounts) ★ most important

- [ ] Log in as **User A** in one browser, **User B** in a second browser
      (or an incognito window) — two separate sessions.
- [ ] As A, save a distinctive secret via chat: "My secret codename is ALPHA-SECRET."
- [ ] As B, save a different one: "My secret codename is BETA-SECRET."
- [ ] As A → /account/brain: shows ALPHA-SECRET, **never** BETA-SECRET.
- [ ] As B → /account/brain: shows BETA-SECRET, **never** ALPHA-SECRET.
- [ ] As B, new chat: "What's my secret codename?" → returns BETA (never ALPHA).
- [ ] As A, new chat: "What's my secret codename?" → returns ALPHA (never BETA).
- [ ] **PASS:** neither user can see or recall the other's memory.
      **Any leak = STOP, do not ship.**

## F. Graceful degradation (spot check)

- [ ] Chat must keep working even if memory can't. (Hard to force by hand — just
      confirm nothing about memory ever blocks or errors the chat itself.)

## G. Rollback sanity — the flag toggles cleanly

- [ ] Stop the server. Restart WITHOUT the flag: `pnpm dev` (back on GBrain).
- [ ] Confirm the workspace chat still loads and works.
- [ ] **PASS:** flipping `MEMORY_BACKEND` off returns to the old backend with no
      breakage — this is the production rollback path.

## Pass criteria

All boxes checked, and Section E shows zero cross-user leakage → ready to ship +
run the PROD cutover. Any failure in E is a privacy blocker — report it before
anything ships.
