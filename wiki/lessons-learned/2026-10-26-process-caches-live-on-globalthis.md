---
title: A saved integration key showed blank because the page and the route kept separate caches
category: synthesis
created: 2026-10-26
updated: 2026-10-26
related: [[integration-config]], [[2026-10-25-dont-point-the-user-at-a-field-that-doesnt-exist]]
---

## Problem

Rob saved the Jev (TypeSafe) key at `/admin/integrations/typesafe`. On reload the field was blank while every other key showed `••••••••xxxx`, and the card said "Not configured". The key was in the database, and the Test button (a route handler) used it fine.

## Why

`lib/integration-config.ts` cached the config in a module-level `let`. Next loads that module once per route graph, so the admin page and the PATCH route held separate caches inside one server process. The save cleared the PATCH route's copy only; the page kept the config it read before the save until the server restarted. On the live dev server `GET /api/admin/integrations` returned the key masked while the server-rendered page held `typesafeApiKey: ""`, same process, same row. That the page and route load separate module instances is [Inference] from those two results and the fix working.

## Rule

State that must be shared across pages and route handlers in one Next process (a cache, a client, a flag) lives on `globalThis`, not in a module-level variable. Any writer that invalidates a cache must reach every reader. When a saved value looks missing, compare what the API returns with what the page was rendered with before touching the data. `lib/integration-config-cache.test.ts` loads two module instances and fails if a clear in one does not reach the other.
