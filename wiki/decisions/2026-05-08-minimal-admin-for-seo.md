---
title: Minimal admin for SEO config (single user, key-value table)
category: decision
created: 2026-05-08
updated: 2026-05-08
related: [[2026-05-08-admin-deferred]], [[2026-05-08-render-postgres-over-neon]], [[backlog]], [[index]]
---

Built a minimal admin section to manage site-wide SEO/brand config from a UI rather than env vars. Reuses architectural patterns from `cc-spresso-data-studio` but at ~5% of the surface area — one user, one settings page, one DB row. Partially supersedes [[2026-05-08-admin-deferred]] for the SEO-config slice only.

## Why now

Rob asked for SEO config to live in an admin section instead of growing the env-var surface for every brand attribute. Originally proposed a code-only `lib/site-config.ts` (no admin) which would have shipped Phase 1.C in 30 minutes — Rob explicitly chose the admin path with intent to build it properly. This decision records what was built and what was intentionally not built.

## Scope built (~7 hours)

### Database
- `lib/db/schema.ts` — single `site_setting` table (`id` UUID PK, `key` text unique, `value` jsonb, `created_at`/`updated_at` timestamps). Single row keyed `'site'` holds the SEO/brand JSON blob.
- `lib/db/index.ts` — lazy Drizzle client on top of `postgres-js` with `ssl: 'require'` for Render Postgres.
- `drizzle.config.ts` + generated migration in `drizzle/`. `drizzle-kit push` against Render Postgres hangs at "Pulling schema from database"; `pnpm db:migrate` (script `scripts/db-apply.mjs`) applies generated SQL directly via the working `postgres-js` connection. See lessons-learned `2026-05-08-drizzle-kit-push-hangs-on-render.md`.

### Auth (single admin)
- `lib/auth.ts` — Edge-safe JWT sign/verify (jose), constant-time password compare. Reads `AUTH_SECRET` + `ADMIN_PASSWORD` env vars. Fails closed if either missing.
- `lib/auth-server.ts` — server-only cookie helpers (`next/headers`). Kept separate from `lib/auth.ts` so middleware (Edge runtime) can't accidentally pull `next/headers`.
- `middleware.ts` — gates `/admin/**` (redirects to `/admin/login`) and `/api/admin/**` (returns 401 JSON) when no valid session cookie present. Whitelists the login page + login API.
- `app/api/admin/login/route.ts` — rate-limited (10/IP/hour) password POST → JWT cookie set on 200.
- `app/api/admin/logout/route.ts` — clears cookie.

### Admin UI
- `app/admin/login/page.tsx` — single-field password form, redirects to `/admin/site` on success.
- `app/admin/site/page.tsx` — site settings form: siteName, tagline, description, founderName, founderLinkedinUrl, ogImageUrl, twitterHandle, linkedinUrl. Loads via fetch on mount, saves via PUT. Sign-out button.
- `app/api/admin/settings/site/route.ts` — GET (returns row or defaults), PUT (Zod-validated upsert).

### SEO consumption
- `lib/site-config.ts` — `getSiteSettings()` (React `cache()` for per-request dedup, falls back to `SITE_DEFAULTS` if DB unreachable), `buildPageMetadata({title, description, path})` helper that composes the full `Metadata` object (title template, description, canonical alternates, openGraph, twitter) from settings.
- `app/layout.tsx` — async root layout reads settings, emits `Organization` + `WebSite` JSON-LD scripts, applies root metadata via `buildPageMetadata`.
- Each per-page (`app/page.tsx` left default; `/privacy`, `/terms`, `/contact`, `/ai-readiness-assessment`) calls `buildPageMetadata` for its page-specific title + description.

### AIEO assets
- `app/sitemap.ts` — Next.js native sitemap, hardcoded route list.
- `app/robots.ts` — allow public site, disallow `/admin/`, `/api/admin/`. Sitemap pointer.
- `public/llms.txt` — llmstxt.org-style hint file for LLM crawlers (ChatGPT, Claude, Perplexity, Gemini). Lists pages, voice, service lines, who-we're-built-for/not-for.
- `app/opengraph-image.tsx` — programmatic OG card via Next.js `ImageResponse` (1200×630, brand mark + tagline + description, regenerates whenever admin saves).

## What's reused from spresso

| Pattern | Source |
| --- | --- |
| Key-value settings table (`getSetting('smtp')` style) | `packages/server/src/services/admin.service.ts` |
| Settings page UI shape (load on mount, edit, save with feedback) | `packages/client/src/pages/settings/SiteSettingsPage.tsx` |
| `authenticate` middleware concept (JWT in cookie, redirect on missing) | `packages/server/src/middleware/auth.middleware.ts` |
| Drizzle ORM + Postgres connection | `packages/server/src/db/` |

## What's intentionally NOT built (deferred per [[2026-05-08-admin-deferred]])

- Multi-user system / `users` and `roles` tables / role-based access
- Magic-link auth (single admin uses simple password instead)
- All other settings pages from spresso (Auth, Billing, Community, Database, Email, LLM, Media, Navigation, Pages, Profile, RoleManagement, SkillCreator, SocialMedia, Stripe, SystemPrompts, UsageDashboard)
- OAuth providers (Bluesky/Facebook/Instagram/LinkedIn/Pinterest)
- Profile management for end users
- Integrations panel for runtime-editable secrets

## Trade-offs

- **`ADMIN_PASSWORD` env var** — single password instead of per-user passwords. One more env var to manage; trade-off accepted because there's only one admin and proper user management would be 10× the scope.
- **JWT secret in `AUTH_SECRET`** — was already on the .env.example for Phase 2 W4 (magic-link). Reused for the single-admin session JWT.
- **Settings cached per-request via React `cache()`** — admin saves don't appear immediately on already-rendered pages. Next page request sees the new values. Acceptable for SEO config which doesn't change minute-to-minute.
- **No invalidation broadcast** — when admin saves, public site pages keep their cached metadata for the duration of any in-flight request. Next request gets fresh values.

## Trigger to revisit

When Phase 2 W4 builds magic-link auth for end users (executives taking the AI Readiness Assessment), revisit the admin auth: either extend the single-user password to per-user magic-link, or keep the admin separate with a stronger second factor. Re-evaluate after the multi-user table exists.
