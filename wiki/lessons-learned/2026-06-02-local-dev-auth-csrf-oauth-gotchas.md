---
title: Local dev auth — CSRF needs localhost site URL, Google sign-in needs its own redirect URI
category: lessons-learned
created: 2026-06-02
updated: 2026-06-02
related: [[local-dev-setup]], [[2026-05-17-asymmetric-turnstile-config]], [[2026-06-02-cdmp-sequential-generation-slow]]
---

Two auth flows fail on a fresh local checkout for non-obvious reasons: the CSRF check rejects localhost unless `NEXT_PUBLIC_SITE_URL` points at it, and Google sign-in needs a redirect URI separate from the admin Google integration.

## Problem 1 — register/login show "Security check failed"

Submitting the register or login form returned **403** and the UI showed *"Security check failed. Reload and try again."* Easy to misread as a Turnstile/CAPTCHA failure — it is **not**.

**Evidence:** [register-form.tsx](../../app/(auth)/register/register-form.tsx) maps `data.error === "csrf"` to that message. The route ([app/api/auth/register/route.ts](../../app/api/auth/register/route.ts)) calls `assertSameOriginRequest()`, which returns `{error:"csrf"}` / 403.

**Root cause:** [lib/auth/csrf.ts](../../lib/auth/csrf.ts) compares the request `Origin`/`Referer` against `getSiteUrl()`. [lib/site-config.ts](../../lib/site-config.ts) resolves that **purely from env**: `process.env.NEXT_PUBLIC_SITE_URL ?? "https://archoslabs.xyz"`. With no local override, the browser's `http://localhost:3007` origin ≠ `https://archoslabs.xyz` → reject.

**Fix:** set `NEXT_PUBLIC_SITE_URL=http://localhost:3007` in `.env.local`. Env-only, no DB/prod impact. Bonus: verification-email links then point at localhost too.

## Problem 2 — Google sign-in shows `redirect_uri_mismatch`

"Sign in with Google" → Google blocked with **Error 400: redirect_uri_mismatch**.

**Root cause:** the OAuth client ([app/api/auth/google/start/route.ts](../../app/api/auth/google/start/route.ts) builds `redirectUri = getPublicOrigin(request) + "/api/auth/google/callback"`) had only the **admin** Google-integration redirect registered (`/api/admin/google-oauth/cb`). User **sign-in** uses a *different* callback path (`/api/auth/google/callback`). Same client, two distinct flows, two distinct paths.

**Fix:** in Google Cloud Console → the OAuth client whose ID is stored in the DB `integration_secrets.googleOauthClientId`, add **both** sign-in callbacks alongside the existing admin ones:
```
http://localhost:3007/api/auth/google/callback     (local sign-in)
https://archoslabs.xyz/api/auth/google/callback    (prod sign-in)
```
Match exactly: `http` for localhost, port `3007`, no trailing slash. These persist on the client and are **not machine-specific** — any dev box on port 3007 works without re-adding.

## Rule

On a fresh local checkout, before testing auth:
1. Set `NEXT_PUBLIC_SITE_URL=http://localhost:3007` — or every mutating `/api/auth/*` and `/api/admin/*` POST 403s on the CSRF origin check.
2. "Security check failed" = CSRF origin mismatch first, Turnstile second. Check `error === "csrf"` before chasing CAPTCHA ([[2026-05-17-asymmetric-turnstile-config]]).
3. Google **sign-in** and Google **admin/calendar** are separate OAuth flows with separate callback paths on the same client. Whitelisting one does not cover the other.

See [[local-dev-setup]] for the full bring-up checklist.
