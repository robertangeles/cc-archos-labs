---
title: Turbopack workspace root must be set explicitly on Next.js 16
category: synthesis
created: 2026-05-07
updated: 2026-05-07
related: [[2026-05-07-brand-foundation]]
---

## Problem

`pnpm dev` ran fine initially but crashed with exit code 1 after `pnpm add -D @playwright/test` triggered a Turbopack rebuild. Error:

```
Error: Next.js inferred your workspace root, but it may not be correct.
We couldn't find the Next.js package (next/package.json) from the project directory:
C:\My AI Projects\cc-archos-labs\app
```

The error originated from Turbopack walking up the directory tree from `app/` looking for `next/package.json` and getting confused — likely because the parent path `c:\My AI Projects\` contains other projects with their own lockfiles/package.json files. The dependency-install event was the trigger, not the cause; the fragile root inference was the cause.

## Fix

Explicitly set `turbopack.root` in `next.config.ts`:

```ts
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
};
```

Restart dev server. Verify `Ready in N ms` appears with no Turbopack error and `/` returns 200.

## Rule

**On any Next.js 16 project living inside a directory tree that contains other Node projects, set `turbopack.root` explicitly in `next.config.ts` from day one.** Don't rely on root inference. The default works for fresh projects in clean directories but breaks in shared workspace folders. Cost to set explicitly: 3 lines. Cost of not setting: a confusing crash mid-session that masquerades as a dependency problem.

This is a Next.js 16 issue specifically — Turbopack became the default and its root-inference heuristic is stricter than Webpack's was.
