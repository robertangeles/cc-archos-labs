---
title: Next Link to the current URL is a no-op — stateful tools get stuck
category: synthesis
created: 2026-06-29
updated: 2026-06-29
related: [[2026-06-02-cdmp-sequential-generation-slow]]
---

A nav `<Link>` whose href equals the current pathname does not navigate, so a heavy client-state tool on that page never resets.

## Problem

On the CDMP practice page, clicking **Tools → CDMP Practice Exam** from inside a
finished exam did nothing. The user was stuck on the results screen with no way
back to the start except a manual reload.

Root cause: the nav link targets `/tools/cdmp-practice` — the exact URL the user
is already on. Next.js treats a `<Link>` click to the current URL as a no-op: no
navigation fires, so the `<Exam>` client component (which holds its `phase` in
`useState`, initialised only on mount) never re-mounts and never resets. A
client-side fix inside `<Exam>` cannot catch this because the component never
hears about the click — the no-op happens at the link layer.

## Fix

Scope a same-page reset to the **Tools menu** links only (the tools that hold
heavy client state). In `components/layout/nav.tsx`, the Tools `<Link>` onClick
compares `tool.href` against `usePathname()`; on a match it calls
`e.preventDefault()` + `window.location.href = tool.href` to force a full reload,
which remounts the tool to its landing state. Top-level nav links (Home/About/…)
are left untouched — they hold no client state, so a hard reload there would only
cost SPA snappiness for no benefit.

## Rule

When a nav link can point at the page the user is already on AND that page holds
meaningful client state (a multi-step tool, a wizard, an in-progress form),
clicking the link will look broken because Next.js no-ops same-URL navigations.
Either (a) force a hard reload for that specific link when `href === pathname`,
or (b) reflect the tool's progress in the URL so the bare link becomes a real,
state-resetting navigation. Do not try to fix it from inside the stateful
component — it never receives the click.
