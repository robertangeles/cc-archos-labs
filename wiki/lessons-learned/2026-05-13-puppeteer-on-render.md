---
title: Puppeteer-on-Render setup needs three things, not one
category: lessons-learned
created: 2026-05-13
updated: 2026-05-13
related: [[2026-05-08-drizzle-kit-push-hangs-on-render]], [[2026-05-12-schema-drift-needs-origin-main-check]]
---

## Problem

The server-side PDF endpoint (Puppeteer launches headless Chromium, navigates to the report page, returns the rendered PDF) worked first time locally on Windows but failed three different ways in succession on Render. Each failure looked like it could be the whole problem; each fix exposed the next.

## Three sequential failures, three sequential fixes

### Failure 1 — Chromium binary missing

**Render runtime log:**
```
Error: Could not find Chrome (ver. 148.0.7778.97). ... your cache path
is incorrectly configured (which is: /opt/render/.cache/puppeteer).
```

**Why**: pnpm 10 doesn't run package post-install scripts by default. Even with `puppeteer` in `pnpm-workspace.yaml`'s `onlyBuiltDependencies`, Render's `pnpm install --frozen-lockfile` didn't trigger the Chromium download that the package would normally do post-install.

**Fix**: append `npx puppeteer browsers install chrome` to Render's Build Command:
```
pnpm install --frozen-lockfile && npx puppeteer browsers install chrome && pnpm build
```

### Failure 2 — Cache path mismatch between build and runtime

After the build command fix, Chromium DID download. The error didn't change. Why?

**Why**: on Render the build phase and the runtime phase have different effective `HOME` directories, so the default Puppeteer cache `~/.cache/puppeteer` resolves to different absolute paths in each phase. Chromium downloaded to a path the runtime couldn't see.

**Fix**: pin the cache to a path inside the project directory (identical between build and runtime). Set an env var on Render:
```
PUPPETEER_CACHE_DIR=/opt/render/project/src/.cache/puppeteer
```
The `puppeteer browsers install` command respects this env var on install; `puppeteer.launch()` respects it on runtime. Same path both times.

### Failure 3 — Navigation URL uses internal hostname

Chromium now installs and launches. New error:
```
net::ERR_SSL_PROTOCOL_ERROR at https://localhost:10000/tools/ai-readiness/report/<id>
```

**Why**: Render's load balancer terminates TLS at the edge and forwards to the internal Node process at `localhost:10000` over plain HTTP, but sets `X-Forwarded-Proto: https`. Next.js's `request.url` reconstructs the URL as `https://localhost:10000` from those signals. The original PDF route used `requestUrl.origin` as Puppeteer's navigation target — so headless Chromium attempted a TLS handshake against an HTTP socket and got `ERR_SSL_PROTOCOL_ERROR`.

**Fix**: in `app/api/diagnostic/report/[sessionId]/pdf/route.ts`, derive the navigation target from `NEXT_PUBLIC_SITE_URL` (which is the *public* HTTPS origin Render's edge handles correctly), falling back to `request.url` only for local dev. The cookie domain that gets set on the Puppeteer page has to use the same source — getting one right and not the other gives a silent owner-check 404.

## Rule

When you add a server-side headless-browser feature to a Render Node service, plan for **all three** of these failures up front:

1. **Install**: append `npx puppeteer browsers install chrome` to the Build Command. Don't rely on package post-install scripts.
2. **Cache path**: set `PUPPETEER_CACHE_DIR=/opt/render/project/src/.cache/puppeteer` in env vars. Don't use the default `~/.cache/puppeteer`.
3. **Navigation URL**: use a configured public URL (`NEXT_PUBLIC_SITE_URL` or equivalent), not `request.url`. Don't trust `requestUrl.origin` to give you a publicly-reachable hostname.

Each of these in isolation reads like a small footnote. Together they cost a deploy + diagnosis cycle each. Sequence the fixes in the same PR if you can.

## Diagnostic pattern that worked

After the first two speculative fixes didn't land, switching to the CLAUDE.md debugging protocol (Confirmed / Evidence / Root cause / Fix / Verify with) collapsed the third failure from minutes of guessing to a one-shot diagnosis. The runtime log message itself named the failed URL, which named the cause once you knew where the URL was constructed.

The lesson: when a fix doesn't take, stop iterating on the same hypothesis. Re-read the new error message from scratch, locate the exact line in source that produced the input the error is complaining about, write down what is *evidence* vs what is *inference*, then act only on evidence.

## Related infrastructure

- Render's Node service runtime: containerised Ubuntu-flavoured Linux, internal port via `PORT` env var (Render defaults to 10000), TLS terminated at the edge.
- `pnpm-workspace.yaml` has `onlyBuiltDependencies: [puppeteer]` for local dev's Chromium download. Doesn't help on Render — Render's pnpm invocation skips build scripts regardless.
- The PDF route still works on local dev (Windows) via the bundled Puppeteer Chromium download. No env-var overrides needed there; Puppeteer's defaults work.
