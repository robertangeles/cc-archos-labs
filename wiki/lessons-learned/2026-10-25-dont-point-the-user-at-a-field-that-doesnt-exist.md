---
title: Don't tell the user to use a field that nobody built
category: synthesis
created: 2026-10-25
updated: 2026-10-25
related: [[2026-07-26-verify-by-running-not-by-deploying]]
---

## Problem

Three review summaries for the news radar told Rob to "add the TypeSafe (Jev) key at /admin/integrations". The Integrations panel had no TypeSafe field. Nothing in `IntegrationConfigSchema`, the PATCH route, the grid or the panel could store one. The build task for it (ET8) sat on the plan's task list, unbuilt. Rob went looking for the field, found nothing, and asked why a placeholder he was told about did not exist.

## Why

A task on a plan reads like a feature that exists once it has been written down and agreed. The instruction to the user was composed from the plan, not from the product. Nobody opened `/admin/integrations/typesafe`, and `wiki/state.md` and `grep` would both have shown there was no such page.

## Rule

An instruction that sends the user to a screen, field or command is a claim about what exists today. Check it the same way as any other claim: `grep` for the field, load the page, read `wiki/state.md`. If the destination is still on a task list, say "I still have to build this first" and build it before asking for the secret. A plan task is not shipped state.
