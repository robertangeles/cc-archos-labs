---
title: Vitest retry:2 is the right pattern for live-API eval suites
category: lesson
created: 2026-05-17
updated: 2026-05-17
related: [[claude-eval-suites]]
---

Eval suites that hit a real LLM see a mix of transient noise (rate limits, 5xx, occasional Claude wobble on a tight assertion) and real regressions. `retry: 2` in `vitest.eval.config.ts` lets each test get 3 total attempts — transient noise filters out at attempt 2, real regressions still fail all 3.

## Problem

The first `pnpm eval` run after PR #46 produced 12/15 pass with three failures:
1. One transient null (catch-all path in `generateConversationalFollowup` fired for a network blip)
2. One self-contradicting fixture (case named "could go either way" with a strict assertion)
3. One miscalibrated fixture (P2 expected, P1 correct per the rubric)

Reflexive response was "tighten the prompt" or "accept the failures and live with red CI." Both wrong:
- Tightening the prompt for a transient API issue is a category error.
- Accepting flaky eval failures destroys the signal of the suite — every red turn becomes "is this real?"

## What worked

`vitest.eval.config.ts`:

```ts
test: {
  // ...
  retry: 2,
}
```

Every test gets 3 total attempts. Outcomes:
- Transient blip → fails attempt 1, passes attempt 2. Reported as pass.
- Real regression → fails all 3 attempts. Reported as fail with the actual error.
- Flaky case where Claude is 80% right → fails sometimes, passes mostly. Still reported as pass when ANY attempt succeeds within the 3.

The cost is bounded: worst case 3× API spend on the genuinely-broken cases. Practically most cases pass on attempt 1, no retry cost at all.

## What didn't work

**Don't make the assertion "soft" (catch and ignore failures)**. That would mask real regressions too.

**Don't set `retry: 5` or higher**. At some point you're papering over a real flakiness signal. 3 attempts is a good "transient vs deterministic" discriminator. If something fails 3 times in a row, the failure IS the signal.

In fact, in PR #48 we hit exactly this — one case failed all 3 retries. Surfaced as a real signal, not noise, which led to discovering Claude was emitting JSON-then-prose self-corrections. Parser fix in PR #48 closed it for good.

## The companion fix

Beyond retry, we added a literal `'either'` value for boolean expectation fields:

```ts
expected: {
  shouldFollowUp: boolean | "either";
}
```

When set to `"either"`, the suite skips the strict boolean assertion but still enforces every OTHER check (forbidden phrases, length, etc). Used only when the case sits on a genuine judgement boundary — NOT as a "I couldn't make up my mind" cop-out.

## Rule

For LLM eval suites:
1. **Always set retry to 2 or 3.** LLMs are non-deterministic; assertions are tight; transient noise is real.
2. **Don't soft-fail.** If retry doesn't recover a case, that's signal — investigate.
3. **Reserve "either" for honest judgement-boundary cases.** Don't use it to hide a fixture you should think harder about.

## Why this matters for our workflow

`/admin/prompts` lets admin edit booking prompts at 10pm without a deploy. `pnpm eval` lets admin verify the edit didn't break anything before clicking save. The eval IS the safety net — if it stays noisy, admin stops trusting it, the safety net is gone, and edit-at-10pm becomes break-the-pipeline-at-10pm.

`retry: 2` keeps the safety net honest.
