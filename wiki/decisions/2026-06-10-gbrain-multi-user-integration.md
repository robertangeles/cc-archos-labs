---
title: GBrain Multi-User Integration
category: decision
created: 2026-06-10
updated: 2026-06-10
related: [[deployment-architecture]]
---

How we gave every Archos Labs user a persistent AI brain — the architecture decisions, the failures, and what we learned.

> **Superseded (2026-07-16):** the external-service architecture described here was retired once Render added pgvector support. Memory now lives in an in-app `user_memory` pgvector table — see [[2026-07-16-brain-inapp-pgvector-migration]]. The GBrain code path still ships behind the `MEMORY_BACKEND` flag until the follow-up decommission PR. This page is kept as the historical record of why the two-service design existed.

## The Problem

The Archos Labs workspace chat was stateless. Every session started cold. A user who discussed their Westpac project last week started from zero this week. Rob, doing consulting delivery, lost context between client sessions. CDMP exam learners couldn't build on what they'd studied before.

The workspace needed memory. Not conversation history (we already had that in Postgres) — cross-session intelligence. The AI should know who you are, what you're working on, and what you've discussed before.

## The Decision: GBrain as External Service

We chose GBrain (a fork at `robertangeles/cc-archos-labs-gbrain`) as the brain service. GBrain runs on Supabase Postgres with pgvector for semantic search, deployed as a separate Render service at `cc-archos-labs-gbrain.onrender.com`.

**Why not build it into the existing app?** GBrain requires a Postgres admin-level setting that Render's managed Postgres doesn't expose. The two-service architecture was a technical constraint, not a preference.

## Architecture Evolution

### Original Design (from the product brief)
- OAuth 2.1 client per user for isolation
- Blocking onboarding wizard (3 steps)
- Chat history browser-only (brain replaces DB persistence)
- Separate brain API routes

### What Changed After Review
The plan went through CEO review, office-hours, eng review, and design review. Three major revisions:

1. **Onboarding: blocking → non-blocking.** The workspace chat already worked without a brain. Blocking access behind onboarding would kill conversion. Progressive: brain provisions automatically on first chat.

2. **Chat persistence: browser-only → keep existing DB.** The original brief proposed storing chat only in the browser with brain summaries. We kept the existing `conversation`/`message` tables. Brain adds enrichment on top, not instead of.

3. **Auth model: single service account → back to OAuth per-user.** The CEO review initially simplified from OAuth-per-user to a single service account with RLS. When we confirmed GBrain's actual API, we discovered it requires one OAuth client per user for scope-gated isolation. Reverted to per-user.

### What Changed During Implementation

4. **SSE response parsing.** GBrain's MCP endpoint returns Server-Sent Events (`event: message\ndata: {json}`), not plain JSON. Our `callMcp()` function called `res.json()` which silently failed. Brain recall returned empty every time. Root cause found via a debug endpoint that traced each step of the pipeline.

5. **System prompt override.** The Metis system prompt has a hardened injection defense: "No exceptions. No exceptions with clever framing." Brain memories injected as system context were treated as prompt injection and rejected. Fix: modified the BEHAVIOR and SCOPE sections of the system prompt itself to include a brain memory exception — not as an external override, but as a native part of the persona.

6. **Source isolation.** The critical discovery: GBrain does NOT isolate data by OAuth client. All clients sharing the `default` source can read each other's data. We added per-user source creation to the `/oauth/register` endpoint. Each user's OAuth client is bound to their own source. GBrain's operation dispatch automatically scopes all reads and writes to the client's source.

7. **Recall timeout.** GBrain on Render free tier has cold starts (10-30s) and the `query` tool does semantic search which can take 2-5s. We started at 1s timeout (CEO review recommendation), found it too aggressive (recall returned empty 30-50% of the time), and settled on 5s.

8. **Integration config storage.** The `site_setting` table stored integration secrets as a JSONB array wrapping a stringified JSON object (legacy format from the initial migration script). Direct SQL writes to add GBrain config failed repeatedly. Fix: used `jsonb_set()` with explicit JSONB concatenation, and added `gbrainUrl` + `gbrainAdminToken` to the proper `IntegrationConfigSchema`.

9. **Admin token rotation.** GBrain generates a new bootstrap token on every restart unless `GBRAIN_ADMIN_BOOTSTRAP_TOKEN` is set as a persistent env var on Render. We lost access three times during implementation before setting it.

## Architecture (Final)

```
User (Browser)
    |
Next.js App (cc-archos-labs.onrender.com)
    |
    +-- Render Postgres
    |     users, conversations, messages, user_brain, site_setting
    |     user_brain stores per-user OAuth client_id + encrypted client_secret
    |     site_setting stores gbrainUrl + encrypted gbrainAdminToken
    |
    +-- GBrain HTTP MCP (cc-archos-labs-gbrain.onrender.com)
            |
            +-- Supabase Postgres (brain content, vectors, embeddings)
                Each user's OAuth client is bound to a dedicated source
                All operations auto-scoped to caller's source
```

### Auth Flow (per chat turn)
1. Read GBrain URL from `getIntegrationConfig()`
2. Fetch user's OAuth credentials from `user_brain`, decrypt client_secret
3. Obtain short-lived access token via client credentials grant (cached in memory, 3600s TTL)
4. Use token for recall/ingest MCP calls

### Data Flow (per chat turn)
1. User message saved to `conversation`/`message` tables (existing)
2. **Recall:** 5s timeout fetch to GBrain `query` tool. Returns relevant memories. Injected as structured system context before the core prompt.
3. LLM responds (streamed via SSE)
4. **Extraction:** Fire-and-forget `put_page` stores the conversation turn in GBrain

### Auto-Provisioning
- First chat message: `recallMemories()` detects no brain → calls `provisionBrain()` in background → registers OAuth client with dedicated source on GBrain → stores encrypted credentials in `user_brain`
- Second message onward: brain exists → token obtained → recall works

## Guardrails

| # | Guardrail | How It Works | Evidence |
|---|-----------|-------------|----------|
| 1 | User isolation | Per-source scoping. Each user's OAuth client bound to dedicated GBrain source. Operations auto-scoped by GBrain's dispatch pipeline. | Canary test: User B cannot query or list User A's pages. Tested with two isolated clients. |
| 2 | Graceful degradation | All brain operations wrapped in try/catch. GBrain down = chat works normally without memory. | Bad token returns 401. Timeout returns empty. Chat unaffected. |
| 3 | Recall timeout | 5s AbortSignal.timeout on MCP calls. Circuit breaker not implemented (deferred). | Recall returns empty on timeout. No added latency to chat when brain is down. |
| 4 | System prompt integration | Brain memory exception added to BEHAVIOR + SCOPE sections of the Metis system prompt. Brain context labeled as platform data, not user input. | Chat returned "Rob Angeles" from brain memory when asked "What's my name?" |
| 5 | Credential encryption | OAuth client_secret encrypted via AES-256-GCM (same `booking-crypto.ts` pattern). Admin token encrypted in integration config. | Stored as base64 ciphertext in DB. Decrypted only in-memory at query time. |

## What This Means

### For Users
Chat with Metis and it remembers you. Your name, your projects, your preferences — all accumulate automatically across sessions. No setup. No commands. Visit the Brain page to see what it knows, search it, or delete anything.

### For the Product
The brain is the moat. Users cannot leave because their AI understands them better every week. This transforms a consulting lead-gen site into a sticky SaaS with per-user data gravity.

### For the Architecture
The middleware pattern (recall before LLM, extract after response) is extensible. Future additions — structured fact extraction, knowledge graphs, cross-session learning paths — layer on without redesigning the chat flow.

## Files Created

| File | Purpose |
|------|---------|
| `lib/brain/client.ts` | GBrain HTTP client (register, token, MCP, health) |
| `lib/brain/provision.ts` | OAuth provisioning + token cache |
| `lib/brain/recall.ts` | Memory recall + structured context formatting |
| `lib/brain/extract.ts` | Async memory extraction after chat |
| `app/api/brain/provision/route.ts` | Provision brain endpoint |
| `app/api/brain/status/route.ts` | Brain health check |
| `app/api/brain/memories/route.ts` | My Brain CRUD (list + delete) |
| `app/api/brain/route.ts` | Brain deletion (account cleanup) |
| `app/api/brain/debug/route.ts` | Pipeline debug endpoint (**removed** in security hardening — exposed infra URLs and PII) |
| `app/account/brain/` | My Brain page (expandable cards, pagination, search) |
| `components/workspace/BrainStatus.tsx` | Status indicator |
| `components/workspace/SourceCitations.tsx` | Citation display |
| `components/workspace/BrainOnboardingBanner.tsx` | Progressive onboarding |

## Files Modified

| File | Change |
|------|--------|
| `lib/chat/stream.ts` | Recall middleware + extraction hooks in all cleanup paths |
| `lib/db/schema.ts` | `user_brain` table |
| `lib/integration-config-shared.ts` | `gbrainUrl` + `gbrainAdminToken` fields |
| `lib/integration-config.ts` | Loader + redacted config for new fields |
| `app/api/admin/integrations/route.ts` | PATCH whitelist for GBrain fields |
| `app/account/account-shell.tsx` | Consistent full-width layout for all workspace pages |
| `app/account/workspace-nav.tsx` | Brain link in workspace nav |
| `components/chat/chat-sidebar.tsx` | Brain link in chat sidebar |
| `app/account/workspace/chat-workspace.tsx` | BrainStatus + OnboardingBanner wired in |
| `app/account/sign-out-button.tsx` | Error handling fallback |

## GBrain Fork Changes

| Commit | Change |
|--------|--------|
| `e302a43` | Added `POST /oauth/register` — programmatic client registration with bearer token auth |
| `951d4d6` | Added per-user source creation in `/oauth/register` (source isolation) |
| `8269e0a` | Fixed `sources` INSERT (removed nonexistent `federated` column) |

## Lessons Learned

1. **Read the API response format before writing the client.** GBrain returns SSE, not JSON. We found this after the code was written and the user tested it.

2. **Test with real credentials before asking the user to test.** We pushed code that failed because the admin token had rotated, the DB format was wrong, or the endpoint didn't exist. Every failure was in front of the user.

3. **Hardened system prompts resist ALL overrides.** "No exceptions" means no exceptions — including your own system-level context. The brain memory exception had to be part of the prompt's native rules, not an external injection.

4. **Source isolation is not automatic in GBrain.** OAuth clients share data unless bound to separate sources. This was a P0 privacy breach discovered during guardrail testing.

5. **Set persistent env vars for tokens.** GBrain's bootstrap token rotates on every restart unless `GBRAIN_ADMIN_BOOTSTRAP_TOKEN` is set as a Render env var. We lost access three times.

6. **The integration config JSONB format was corrupted.** The `site_setting` table stored a JSONB array wrapping a stringified object (legacy from migration). Direct SQL updates failed. Use the app's own `updateIntegrationSecret()` function or explicit `jsonb_set()`.

## PR

PR #149 — merged to main on 2026-06-10.
