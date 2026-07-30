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

## Verification

Five fresh pages driven in a real browser under the enforcing policy: 0 console violations, 5 successful GA4 `g/collect` hits, GTM initialised (`dataLayer` populated, `google_tag_manager` present), consent banner rendering, R2 blog imagery loading. Full suite green: 150 files, 1853 tests.

## Open

- The nonce work (widen the `proxy.ts` matcher) remains undone and is the only path to inline-script protection.
- GA4 country-TLD variants (`www.google.com.au` and friends, used for ads cookie sync) are not allowlisted. Nothing requests them today; `/api/csp-report` will say if that changes.
- GTM can inject tags at runtime, which no code-derived allowlist can cover. Reporting stays wired for exactly this — watch for `disposition:"enforce"`.
