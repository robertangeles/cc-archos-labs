---
title: A full-bleed canvas needs a definite height — h-full collapses under min-h-full
category: lessons-learned
created: 2026-06-17
updated: 2026-06-17
related: [[model-studio-canvas]]
---

A React Flow canvas (or any element that must fill its container rather than grow from content) renders as a zero-height void if its height chain bottoms out in percentages under the app's `min-h-full` body.

## Problem

The Model Studio canvas page compiled clean, the route served, and unit tests passed — but the canvas rendered as an empty black rectangle: no nodes, no toolbar, no controls. Only the E2E (clicking the "Add entity" button) surfaced it: Playwright reported the click was intercepted by a wrapper div, and the failure screenshot showed React Flow occupying zero height.

Root cause: the root layout's `<body>` is `min-h-full` (min-height, not height). A child with `h-full` (height: 100%) resolves against the parent's **height**; when that height is `auto`/`min-height`-driven, the percentage doesn't resolve and collapses. The chain `body(min-h-full) → div(flex-1) → main(flex-1) → view(h-full) → ModelCanvas(h-full) → .react-flow(height:100%)` looked fine but the `h-full` links silently became zero. Content-bearing pages (the model list) never hit this because their content gives the body intrinsic height; a fill-the-space canvas has none.

## Fix

Two parts: size via flex, not percentage, down the chain (`flex-1 min-h-0` instead of `h-full`), and give React Flow a guaranteed pixel box by making its immediate parent `relative` and the canvas wrapper `absolute inset-0`. Absolute positioning resolves against the padding box in real pixels, sidestepping percentage-height resolution entirely.

## Rule

- Any element that must FILL (canvas, map, full-height editor) rather than grow from content: don't rely on a chain of `h-full` under a `min-h-full` body. Use `flex-1 min-h-0` for the chain and `relative` + `absolute inset-0` for the leaf that needs a concrete box.
- This class of bug is invisible to tsc, lint, and build, and often to unit tests. A real-browser E2E or screenshot is the only thing that catches "renders as a void." The Playwright spec ([[model-studio-canvas]]) that found this seeds auth by registering a fresh user against the real API (Turnstile is bypassed in dev; same-origin CSRF passes via the `Origin` header) — no test backdoor in the app. Note register is IP-rate-limited (in-memory, 1h window); rapid local reruns 429 until the dev server restarts.
