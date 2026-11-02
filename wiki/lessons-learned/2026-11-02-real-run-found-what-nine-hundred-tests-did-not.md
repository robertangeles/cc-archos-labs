---
title: A real run on five stories found defects that about nine hundred tests did not
category: synthesis
created: 2026-11-02
updated: 2026-11-02
related: [[news-draft-pipeline]], [[2026-10-26-pglite-accepts-what-postgres-js-rejects]], [[news-draft-runbook]]
---

## Problem

The news draft pipeline had unit, integration and mutation-checked tests (about 900 for the feature) and passed lint and types. The first real run, five Kept stories with real models and the real network on DEV, completed one story and stopped four. Reading each stored step showed defects, none of which a test had caught. The first five:

1. **A skill variable the tests never saw.** Rob's steelman skill ends with a note that names `{{article_draft}}`, the thing a later step produces. The pipeline refuses a skill that names a variable it does not supply, correctly, and the test skills were clean templates. Every job stopped at the steelman.
2. **The quote check paired quotation marks wrongly.** The regex ignored a quotation under 6 characters (`"Picks"`, `"2025"`, `"all"`), so its closing mark opened the next pair and the text between two real quotes was read as a quote. Two honest briefs failed, and the one real invented quote in them was buried.
3. **A retry that did not say why.** The corrected attempt was told `"X" is not in any document`. For `"does not establish... serving precision"` the cause was the ellipsis joining two passages, and the model repeated it.
4. **A token budget that fit one essay and not the next.** 16,000 tokens included the model's thinking: one essay used 10,600, the next ran out and the job stopped.
5. **A column I assumed.** The Radar page's new draft line read `post.published_at` for the scheduled time. The real column for a scheduled post is `scheduled_publish_at`; `published_at` is empty until it goes live. The test stub used my assumption, so the test agreed with the bug. Found by reading the real post row.

Later real runs and a read-through of my own diff found three more: a skill that tells the writer to label inferences with `[Inference]` while a gate forbids the tag (the rewrites kept the tag until the instruction said what to do instead); a kill switch the drain read only at the start; and a "look once after a Keep" refresh that could never find its row. After the fixes, four of the five stories became drafts and the fifth was refused for lack of a primary source, which is the intended result.

## Why

Tests encode what I already thought of. The fixtures were my versions of the skills, the briefs and the post table, so they shared my blind spots. A single real brief from a real model contains the short quotes, the ellipses and the variable names the fixtures did not.

## Rule

- Before calling a pipeline built on models done, run it on at least five real inputs and **read every stored step**, not only the final status. Treat each stop as evidence, not noise.
- Build fixtures from the real rows (the skill text from the database, a real brief from a real run), not from a tidy imitation.
- When a gate rejects output, the message that goes back to the writer must say **why**, in terms the writer can act on.
- Give a reasoning model a budget that covers its thinking and its answer; the cost is only paid when used.
- A test stub of an existing table copies the column names from `lib/db/schema.ts`, never from memory.
