---
title: Brain recall silently failed on GBrain cold starts — "Metis doesn't remember me"
category: lessons-learned
created: 2026-06-22
updated: 2026-06-22
related: [[2026-06-10-gbrain-multi-user-integration]], [[2026-06-10-gbrain-security-hardening]], [[deployment-architecture]]
---

Reported as "the Metis chat space does not remember me now." It was the memory (Brain) recall silently timing out, not lost data. Persistence, schema, credentials, and config were all healthy.

## Problem: a 5s recall timeout vs a cold-starting GBrain

GBrain runs as a separate Render service that spins down after idle. Memory recall ([lib/brain/recall.ts](../../lib/brain/recall.ts)) makes two sequential network calls — `getAccessToken` then a vector `query` — each on a hard 5s timeout, and **every failure is swallowed** (recall returns empty and the chat proceeds with no memory, no error surfaced).

Measured against the live service for the affected account: the same query ran **~1.5s warm but >5s on a cold/just-woken instance**. So whenever a user opened Metis after GBrain had gone idle, the first recall blew the 5s budget → returned zero memories → Metis answered "Do you remember me?" generically. Intermittent by nature ("now"), which is why it looked like data loss.

Diagnosis confirmed the data was fine: the user's 5 memories existed and recalled successfully when warm; conversations persisted correctly (a rolled-back insert and the real `chatService` path both wrote to PROD cleanly). The only fault was the timeout.

## Fix

1. **Widened the timeouts** so a cold-but-recovering call completes instead of being silently killed: recall query 5s→10s ([recall.ts](../../lib/brain/recall.ts)), token fetch 5s→8s ([client.ts](../../lib/brain/client.ts)).
2. **Warm GBrain on workspace open** — new `warmBrain()` ([lib/brain/warm.ts](../../lib/brain/warm.ts)) + `POST /api/brain/warm`, fired fire-and-forget from the workspace mount. It pre-fetches+caches the token and runs a throwaway query, moving the cold-start cost off the user's first message. Verified end-to-end: warm-up absorbed a real 6.2s cold start, then recall returned all 5 memories in ~1.8s.
3. **Made failures visible** — recall now logs `timeout`/`error` outcomes in production (was dev-only), so a silently-degraded brain shows up in logs.

## Rule

A swallowed-failure path on a cold-start-prone dependency is invisible until a user notices. When a remote dependency can cold-start (Render free/idle services), either keep it warm ahead of the critical path or budget the timeout for the cold case — never both swallow the error AND set a timeout tuned only for the warm case. And log the failure outcome in prod, always.
