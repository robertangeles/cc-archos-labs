---
title: Scrub 10 near-duplicate human-written posts
category: decision
created: 2026-10-24
updated: 2026-10-24
related: [[2026-10-24-remove-ai-slop-posts]], [[2026-10-24-remove-blog-agent-pipeline]]
---

After the agent posts were cut, the Search Console "Crawled, not indexed" list (67 URLs) was checked for what was left. Ten human-written posts were near-duplicates of a better sibling and now 308 to it. They are archived, not deleted.

## What the 67 turned out to be

- 14 listing pages (`/blog?page=N`, category pages). Google skips deep pagination everywhere; left alone.
- 53 posts, **all human-written**, all live, 500–950 words. 43 migrated from WordPress, 10 written later by running the *Archos Blog* workflow by hand (May–Jul 2026, hash-suffixed slugs such as `-e6c2`).
- Google had indexed only 42 URLs on the whole site. "Crawled, not indexed" gives no per-page reason, so it is not evidence that any single post is bad. **None of the hash-suffixed workflow posts is indexed**; every indexed blog post is a WordPress migration.

## The real defect: the same article twice

The workflow was run twice on one topic two to three weeks apart, leaving two near-identical posts (embedding cosine distance 0.09–0.14; openings read as the same article). The earlier slop review only covered the 254 agent posts, so these 45 non-WordPress human posts had never been looked at.

## The 10 redirects

Rule: keep the twin Google indexed; otherwise keep the longer, or the older WordPress one.

| Redirected | Kept | Distance |
|---|---|---|
| `ai-training-tracks-completion-not-capability-e6c2` | `ai-training-that-measures-the-wrong-thing-6e16` | 0.092 |
| `shadow-ai-is-already-on-your-team-e69d` | `shadow-ai-is-already-here` (indexed) | 0.102 |
| `transformation-starts-with-listening-not-executive-mandates` | `transformation-starts-with-listening` (indexed) | 0.107 |
| `why-ai-tools-don-t-build-capability-on-their-own-edda` | `the-four-investments-that-make-ai-tools-actually-work-8e18` | 0.109 |
| `why-ai-pilots-succeed-but-never-reach-production` | `why-most-ai-pilots-die` | 0.118 |
| `your-ai-pilot-isn-t-failing-because-the-ai-is-bad-b8a4` | `why-most-ai-pilots-die` | 0.139 |
| `your-ai-tool-isn-t-broken-your-data-is-1799` | `your-ai-tool-is-lying-to-you-bad-data-is-why-3f66` | 0.123 |
| `ai-risk-gaps-your-board-register-is-missing` | `ai-risk-taxonomy-every-board-needs-now-3568` | 0.126 |
| `data-fluency-is-the-skill-your-dashboard-won-t-teach-db9f` | `more-data-made-you-worse-at-this-12f0` | 0.128 |
| `ai-governance-framework-board-directors` | `ai-governance-framework-for-executives` | 0.152 (judgment call, both were crawled-not-indexed) |

27 earlier redirects pointed at one of these ten; they were repointed to the final target so nothing chains. `lib/blog-removed-redirects.test.ts` enforces that.

## Deliberately not done

- `your-ai-agent-is-lying-because-your-data-is-broken-2df9`: 0.170 from the kept post, over the 0.16 cut-off. Left live.
- Three more pairs at 0.14–0.15 (`ai-use-case-prioritization`, `dashboards-dont-drive-decisions-people-do` / `you-dont-have-a-data-problem-…`, `strategy-isnt-top-down-its-sideways` / `your-org-chart-isnt-your-culture-map-…`): different angles or stories. Kept both.
- Invented first-person anecdotes: 7 non-WordPress human posts claimed experience ("once told me", "I have seen"). Two were redirected above; the other six kept posts (`more-data-made-you-worse-at-this-12f0`, `your-ai-tool-is-lying-to-you-bad-data-is-why-3f66`, `why-your-ai-business-case-fails-finance-review`, `why-your-data-model-is-breaking-your-ai-agent-65cc`, `write-this-before-any-ai-project-starts-ac69`, `your-crm-data-is-lying-to-your-ai-b246`) were **edited on PROD on 2026-10-24 UTC (the 25th local)**: each claimed experience became a plain hypothetical ("Picture a founder who…") or a general statement. `ac69` carried a second one ("A founder I know approved a $180,000 AI contract…") that the first search missed. Backup before the edit: `~/.gstack/backups/archos_pdb_post_2026-10-25_pre-anecdote-edit.dump`. The check only finds first-person phrasing; a claimed experience in the third person with no "I" would not be caught. See [[2026-07-25-no-fabricated-experience]]. The 39 WordPress posts with similar phrasing are probably the owner's own voice and were not touched.

## Undo

Rows are archived, never deleted. Backup before the change: `~/.gstack/backups/archos_pdb_post_2026-10-24_pre-duplicate-scrub.dump`. Restore by setting `archived_at = NULL` on the ten slugs and removing their entries (and reverting the 27 repointed destinations) from `lib/blog-removed-redirects.json`.
