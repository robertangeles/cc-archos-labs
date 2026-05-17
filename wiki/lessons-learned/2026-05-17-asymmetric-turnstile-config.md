---
title: Turnstile needs BOTH keys set — Site Key alone or Secret alone silently breaks
category: lesson
created: 2026-05-17
updated: 2026-05-17
related: [[book-a-call-architecture]]
---

Cloudflare Turnstile needs both the Site Key (public, rendered into the page) and the Secret Key (server-side verification) to function. A half-configured state where only one is set produces a confusing failure mode that's easy to misdiagnose as a prompt or form bug.

## Problem

PR #42 originally had `isTurnstileConfigured()` return `true` when the Secret Key was set in `/admin/integrations`. But the widget client-side only renders when the Site Key is also set. The asymmetric case (Secret set, Site Key not set) caused:

1. Form renders without the Turnstile widget (no Site Key → nothing to render)
2. Form submits with `turnstileToken: ""` (no widget → no token)
3. Server sees `isTurnstileConfigured()` is true (Secret IS set) → calls Cloudflare `siteverify` with empty token
4. Cloudflare returns `missing-input-response`
5. Server returns 400 "Bot check failed. Refresh and try again."

User sees "Bot check failed" with no widget on the page they could possibly have completed. Confusing.

## Fix

`isTurnstileConfigured()` now requires BOTH keys to consider Turnstile enabled:

```ts
export async function isTurnstileConfigured(): Promise<boolean> {
  const config = await getIntegrationConfig();
  return Boolean(config.turnstileSiteKey && config.turnstileSecretKey);
}
```

If only one is set, treat as not-configured. The form skips the widget entirely; the server skips verification entirely. Booking goes through without bot protection until the admin saves the other key.

Two regression tests in `lib/turnstile.test.ts` lock this in:
- "returns false when only the site key is set"
- "returns false when only the secret key is set"

## Rule

When a feature needs paired secrets (one public, one private), test all FOUR config states:

1. Both set → feature enabled
2. Neither set → feature disabled (default)
3. Only public set → feature disabled (NOT enabled with broken verification)
4. Only private set → feature disabled (NOT enabled without a way to submit)

States 3 and 4 should behave like state 2, not like state 1.

## Why this is easy to get wrong

The naive check is "did the admin save the secret part?" because that's the value-bearing field. But it doesn't capture "is the OTHER half of the pair also configured." For Turnstile, the Site Key is just an identifier (low-value, public anyway) which makes it feel less load-bearing than the Secret Key — but BOTH are required for the widget to function.

Same trap exists for any OAuth client (Client ID + Client Secret), API key + webhook signing secret, public/private keypairs. Always check both.

## Where the code lives

- `lib/turnstile.ts` — `isTurnstileConfigured` (the fix)
- `lib/turnstile.test.ts` — regression tests
- `/admin/integrations/anti-spam` — both keys live in the same form, saved together
