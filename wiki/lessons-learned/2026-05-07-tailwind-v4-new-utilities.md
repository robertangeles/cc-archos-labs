---
title: Tailwind v4 dev server doesn't always compile new utility names on hot-reload
category: synthesis
created: 2026-05-07
updated: 2026-05-07
related: [[2026-05-07-linear-redesign]]
---

## Problem

During the Linear-quality redesign I added new colour tokens to `app/globals.css`:

```css
@theme {
  --color-canvas: #0f0f0f;   /* was --color-paper */
  --color-surface: #18181b;  /* new */
  --color-fg: #f5f5f5;       /* was --color-ink */
  ...
}
```

Components were updated to use the new utilities (`bg-canvas`, `bg-surface`, `text-fg`) in the same session. The dev server (`pnpm dev`, Turbopack) was running throughout.

After the changes, the page rendered with a transparent body background and pure-black text. Computed styles via Playwright confirmed `body { background-color: rgba(0, 0, 0, 0); color: rgb(0, 0, 0); }`. But `font-sans` (also from `@theme inline`) had updated correctly to Inter, and the existing `bg-accent`/`text-accent`/`border-rule` utilities had updated to their new values (#3b82f6 etc.) and were visible in the rendered page.

Inspecting the served stylesheet directly via `curl` to `/_next/static/chunks/[root-of-the-server]__*.css`:

```
$ curl -s … | grep -oE '(bg-canvas|bg-surface|text-fg|border-rule|bg-accent|text-accent)\b' | sort -u
bg-accent
border-rule
text-accent
```

`bg-canvas`, `bg-surface`, `text-fg` were not in the compiled CSS. Tailwind's content scanner had not detected the new utility *class names* even though it had hot-reloaded the new *token values*.

## Fix

Re-save `app/globals.css` (any change — even adding a comment is enough). On the next request, Tailwind re-scans the source files, picks up the new utility names, and emits them.

After a single comment-only re-save:

```
$ curl -s … | grep -oE '(bg-canvas|bg-surface|text-fg|border-rule|bg-accent|text-accent)\b' | sort -u
bg-accent
bg-canvas
bg-surface
border-rule
text-accent
text-fg
```

Page rendered correctly thereafter.

## Rule

**When introducing net-new Tailwind v4 utility class names alongside an existing dev server, expect to re-save `app/globals.css` once after the components are updated.** Token *value* changes hot-reload reliably; new utility *names* (i.e. utilities derived from new `--color-*` / `--font-*` / `--spacing-*` tokens) sometimes do not, because the content scanner only re-runs when it sees a CSS file change, not a TSX file change.

This is a Tailwind v4 + Turbopack interaction. It does not require restarting the dev server; a one-character edit to `globals.css` is sufficient.

If the page renders with default browser colours (transparent bg, black text) even though component classes look right, the diagnostic is:

```
curl -s "$CSS_URL" | grep -oE '<class-name>'
```

If the new utility doesn't appear in the served CSS — re-save `globals.css`.
