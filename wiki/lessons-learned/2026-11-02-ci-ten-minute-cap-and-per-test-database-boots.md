---
title: The PR's CI run hit the 10 minute cap because 85 tests each booted their own database
category: synthesis
created: 2026-11-02
updated: 2026-11-02
related: [[news-draft-pipeline]], [[2026-11-02-real-run-found-what-nine-hundred-tests-did-not]]
---

## Problem

PR #259 (the news draft pipeline) passed lint, wiki lint, typecheck and the whole test step, then CI cancelled the job during `next build` with "The job has exceeded the maximum execution time of 10m0s". The job in `.github/workflows/ci.yml` has `timeout-minutes: 10`. The reviewing agent called it a flake; the step times said otherwise. The Test step took 506 s on this PR against 240 s and 319 s on the two green runs just before it, and Build, which normally takes 42 to 51 s, never got to run.

Cause: `makeDraftTestDb()` boots a fresh in-process Postgres (pglite) and replays two migrations, about 0.7 s on a fast machine. Four test files called it from `beforeEach`, so 85 tests paid for 85 boots: 55 s locally for those files, against 0.8 s for the 39 tests of `queries.test.ts`, which boots once and truncates. CI runs the files one at a time on two cores (`fileParallelism: !process.env.CI`), so the boots add up in full and the runner is slower than a laptop. A second cause is runner speed: two nearly identical green runs differed by a third.

## Fix

The helper gained `reset()` (one `TRUNCATE ... RESTART IDENTITY CASCADE` over every table it migrates, the same pattern `queries.test.ts` already used). The four files boot once in `beforeAll` and reset in `beforeEach`. Those files went from 54.6 s to 1.9 s locally; the full serial suite from about 247 s to 195 s.

Moving to a shared database exposed a test that renamed `news_draft_job` to simulate a broken database and never put it back, which had been harmless while every test got a throwaway one. It now restores the name in a `finally`.

## Rule

- **A test that adds a database boot per test is adding CI minutes.** Boot once per file and reset between tests. Check the time of the new test files before pushing, not after CI cancels.
- **A cancelled job is not automatically a flake.** Read the step timings (`gh api repos/<owner>/<repo>/actions/jobs/<job id>`; `gh run view` does not print step times) and compare them with the last green runs.
- **A test that changes the schema of a shared database restores it in a `finally`.**
- Other suites boot a database per test too: `tests/clients/clients-service.test.ts`, `tests/model-studio/entity-service.test.ts` and `tests/projects/kanban-service.test.ts` call `makeOrgTestDb()` from `beforeEach`. The main branch's green runs already take 344 to 476 s of the 600 s cap, so the cap is a standing risk for every PR. Raising `timeout-minutes` or converting those suites is a separate change.
