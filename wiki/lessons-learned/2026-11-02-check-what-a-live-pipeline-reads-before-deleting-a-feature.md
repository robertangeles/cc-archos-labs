---
title: Check what a live pipeline reads before deleting a feature
category: synthesis
created: 2026-11-02
updated: 2026-11-02
related: [[2026-11-02-remove-skills-workflows-social]], [[news-draft-pipeline]], [[2026-11-02-check-what-the-page-already-renders]]
---

## Problem

Rob asked to remove Skills, Workflows and Social posts because "we will never use them again". Skills looked like a self-contained feature (pages, API, builder). It was not: the news draft pipeline, activated on PROD the same day, loads all four of its prompts from the `skill` table, and the Skills page was the only editor for those rows. Deleting the feature as named would have left a live pipeline with prompts nobody could edit, and dropping the table would have stopped it. Rob's reaction on hearing it was "Whoa wait. the new pipeline is dependent on these?"

## Fix

Before any deletion, list what the live code reads from the thing being removed: `grep` the table's importers outside the feature's own folders, and find the editor for any data a pipeline loads at run time. Stop and say so when a live pipeline depends on it, with the exact file and line, and offer the options. Here that meant keeping the `skill` table and loader, dropping the builder and its child tables, and recording that prompt edits are now row edits.

## Rule

"Remove feature X" is not "drop table X". Name every non-feature reader of the table, every shared helper that lives inside the feature's folder (`fence.ts`, the model list, the models route), and every place a feature was the only editor of data something else uses. The request may not know about them; the code does.
