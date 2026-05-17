---
title: Claude eval suites for booking prompts
category: concept
created: 2026-05-17
updated: 2026-05-17
related: [[booking-prompts-in-db]]
---

How to verify a prompt edit didn't regress quality before shipping. Fixture-based, programmatic checks, live Claude calls.

## When to run

After any edit to a booking prompt in `/admin/prompts`. Particularly when:
- You change the rubric (e.g. tighten P1 criteria on the brief)
- You add forbidden phrases / words
- You switch models in `/admin/integrations` → AI Model
- You're considering rolling back a prompt edit and want to A/B in your head

Not in CI. The eval suite makes live Claude calls and costs money — running it on every PR would burn budget. The default `pnpm test` excludes it; `pnpm eval` is opt-in.

## How to run

```powershell
pnpm eval
```

Requires:
- `.env.local` with `DATABASE_URL` set (the loader reads prompts from `site_setting`)
- `OPENROUTER_API_KEY` or equivalent in `/admin/integrations` so Claude calls actually work
- ~30 seconds and ~$0.02 in API spend

Output: per-case pass/fail, the predicted priority/follow-up/matches, and the cost per case. Failures show exactly which expectation broke.

## What the suite covers

Three booking prompts, 5 fixtures each (15 cases total). All checks are programmatic — no LLM-as-judge yet. The point is to catch:

- **Schema regression** — Claude returns a malformed object after a prompt edit
- **Rubric drift** — P1/P2/P3 calls flip across the same fixtures (signals the brief prompt's calibration changed)
- **Generic-output drift** — talking points start saying "understand their goals" again (forbidden filler list)
- **Hallucinated URLs** — blog-match returns a URL not in the library
- **Filler-question drift** — follow-up prompt starts asking "tell me more"

What the suite does NOT cover (yet):
- Semantic quality (would need LLM-as-judge — deferred)
- Tone / voice fidelity (same)
- Diagnostic narrative prompt (separate; would need DB-configured prompt)

## Fixture format

Each suite is a `.eval.test.ts` file under `tests/eval/`. Fixtures are inline TypeScript arrays — no JSON, no separate fixture loader. The expected shape is in the `expected: { ... }` block of each fixture.

To add a fixture: copy an existing one, change `input` to the new shape, set `expected` based on what the prompt SHOULD do. The case names show up in the Vitest output so describe them clearly.

## When a case fails

Default response: figure out whether the prompt is wrong or the fixture is wrong.

- **Prompt is wrong**: edit it in `/admin/prompts`, re-run `pnpm eval`. If now passing, save the prompt.
- **Fixture is wrong**: the expected behaviour was wrong-headed. Relax the expectation, document why in the fixture comment, commit.
- **Both are reasonable**: the prompt is making a judgement call we hadn't anticipated. Decide which is the desired behaviour, edit the loser.

## Cost discipline

Eval cost is real but small (~$0.02 / run). Ways to keep it down:

- Run only the suite you changed: `pnpm eval -- precall-brief` runs just that file
- Add fixtures sparingly. The point is coverage of distinct shapes, not volume.
- The diagnostic eval (when added) will be more expensive — diagnostic outputs are 5-10x longer than booking outputs.

## Related

- [[booking-prompts-in-db]] — where the prompts live
- The eval lives separate from `pnpm test` to keep CI free
