---
title: Session Log
category: synthesis
created: 2026-05-07
updated: 2026-05-07
related:
---

Append-only log of sessions. Newest entry at the top.

## 2026-05-07 — Project bootstrap

- Scaffolded Next.js 16.2.5 + TypeScript + Tailwind v4 + ESLint into project root via `pnpm create next-app` (App Router, no `src/` dir, `@/*` alias).
- Created folder structure per CLAUDE.md: `app/api/{diagnostic,contact}/`, `components/{ui,diagnostic,layout}/`, `lib/`, `public/{images,fonts}/`, `wiki/{entities,concepts,decisions,synthesis,raw-index,backlog,lessons-learned}/`, `scripts/`.
- Seeded `wiki/index.md` and `wiki/log.md`.
- Set local dev port to 3007 (CLAUDE.md mandate).
- Initialized git, first commit on `main` (author: Rob Angeles <trebor.selegna@outlook.com>).
- **Decision:** kept Next.js 16.2.5 (scaffold default). Updated CLAUDE.md tech stack from "Next.js 15" to "Next.js 16".
