---
title: CSP goes enforcing, keeping 'unsafe-inline'
category: decision
created: 2026-07-30
updated: 2026-07-30
related: [[2026-07-30-csp-runtime-hosts-invisible-to-reports]], [[deployment-architecture]], [[2026-07-27-remove-admin-bypass]]
---

The Content-Security-Policy shipped Report-Only on 2026-07-28 went enforcing on 2026-07-30, two days rather than the planned week, and deliberately keeps `'unsafe-inline'` in `script-src`.

## Why not wait the week

The plan said collect a week of violations and build the allowlist from real traffic. Two days of data plus a direct inspection made the remaining wait worthless:

- The stream held two reports. One was a synthetic probe. One was a visitor's browser extension beaconing to `*.on.aws` — correctly blocked, deliberately not allowlisted.
- Every host CSP governs across `/`, `/about`, `/blog`, a post, `/consulting`, `/contact` and both `/tools` pages was already listed. The outbound `<a href>` targets (GitHub, LinkedIn, X, Hugging Face) are navigation, which CSP does not govern.
- Only three of the six allowlisted hosts are live at all: Meta Pixel has no configured ID and Turnstile defaults off.

More importantly, the report stream was structurally incapable of answering the question that mattered — see [[2026-07-30-csp-runtime-hosts-invisible-to-reports]]. Browser verification found and fixed a GA4 transport host (`www.google.com`) that would have silently broken measurement; no additional waiting would have surfaced it.

## Why keep 'unsafe-inline'

Removing it needs a per-request nonce. Three facts make that a separate piece of work rather than part of this change:

1. `next.config.ts` `headers()` is static and cannot emit a per-request value.
2. `proxy.ts` **is** the middleware (Next 16 renamed `middleware.ts`), but its matcher is `["/admin/:path*", "/api/admin/:path*"]`, so it never runs on the public routes that need the nonce. Widening it puts the Edge runtime in front of every public request.
3. A hash-based policy is not a shortcut. The homepage alone emits 21 Next.js RSC flight-data blocks whose contents change every render, so their hashes are not knowable at config time.

## What this buys, stated honestly

Enforced: the external-script allowlist, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`. Unauthorised third-party script hosts are now blocked, including that extension beacon.

Not enforced: inline script injection. With `'unsafe-inline'` present this is not XSS protection for inline content. The non-script directives close real attack classes regardless, so this is a partial win, not theatre — but it is a partial win.

## Three hosts added, all for the same reason

Each was missing from `connect-src` while being present in a directive that only covers a different transport. All three fail silently.

| Host | Why `connect-src` specifically |
|---|---|
| `www.google.com` | `gtag.js` posts `page_view`/`scroll`/`user_engagement` to `/g/collect`. Found by browser trace; invisible to source, HTML and reports |
| `www.facebook.com` | `fbevents.js`' primary transport is an `Image()` GET (covered by `img-src`), but it falls back to `sendBeacon`/`fetch` against `/tr/` on unload. Found by reading the live script |
| `challenges.cloudflare.com` | Cloudflare's edge-injected bot-management telemetry GETs `/cdn-cgi/challenge-platform/h/b/pat/…` from the top-level page. Observed live on production. **Not** our Turnstile widget, which is off |

**Correction, made after the merge.** The `challenges.cloudflare.com` entry was originally justified as Turnstile's clearance-redemption path being live because the site is Cloudflare Zone-integrated. Verifying on production showed the mechanism is different: that path appears in no application code, the served HTML of `/`, `/login` and `/contact` reference it zero times, and `/login` carries no `sitekey` (so `TurnstileWidget` returns null). Cloudflare injects it at the edge, after parse, on proxied pages. The entry is required **today**, with Turnstile off — so the original reasoning would have led a future reader to delete a live dependency. Corrected in `next.config.ts`.

`www.facebook.com` genuinely is inert (no Pixel ID configured), which is exactly why it could never have appeared in the violation stream. The pattern worth keeping: **a host in `script-src` or `img-src` is not thereby allowed to `fetch`**, and third-party tags routinely use more than one transport.

Listing `challenges.cloudflare.com` in `connect-src` grants close to no new surface, since it already holds `script-src` — a host permitted to execute arbitrary script can do anything a `fetch` could.

## Verification

Five fresh pages driven in a real browser under the enforcing policy: 0 console violations, 5 successful GA4 `g/collect` hits, GTM initialised (`dataLayer` populated, `google_tag_manager` present), consent banner rendering, R2 blog imagery loading. Full suite green: 150 files, 1853 tests.

## Open

- The nonce work (widen the `proxy.ts` matcher) remains undone and is the only path to inline-script protection.
- GA4 country-TLD variants (`www.google.com.au` and friends, used for ads cookie sync) are not allowlisted. Nothing requests them today; `/api/csp-report` will say if that changes.
- GTM can inject tags at runtime, which no code-derived allowlist can cover. Reporting stays wired for exactly this — watch for `disposition:"enforce"`.
