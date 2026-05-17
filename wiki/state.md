---
title: Project state — auto-generated
category: synthesis
generated: 2026-05-17T10:51:40.840Z
generator: scripts/wiki-state.mjs
---

Auto-generated snapshot of what is currently shipped. **Source of truth for ship state.** Read this before claiming any route, API endpoint, or component does not exist.

Do not hand-edit. Regenerate with `pnpm wiki:state` or stage any change under `app/` or `components/` to fire the pre-commit hook.

## Routes (21)

| Route | File | Last shipped |
|-------|------|--------------|
| `/` | [app/page.tsx](../app/page.tsx) | 2026-05-17 |
| `/admin/(authed)/diagnostic` | [app/admin/(authed)/diagnostic/page.tsx](../app/admin/(authed)/diagnostic/page.tsx) | 2026-05-15 |
| `/admin/(authed)/integrations` | [app/admin/(authed)/integrations/page.tsx](../app/admin/(authed)/integrations/page.tsx) | 2026-05-15 |
| `/admin/(authed)/integrations/[slug]` | [app/admin/(authed)/integrations/[slug]/page.tsx](../app/admin/(authed)/integrations/[slug]/page.tsx) | 2026-05-17 |
| `/admin/(authed)/prompts` | [app/admin/(authed)/prompts/page.tsx](../app/admin/(authed)/prompts/page.tsx) | 2026-05-17 |
| `/admin/(authed)/prompts/[slug]` | [app/admin/(authed)/prompts/[slug]/page.tsx](../app/admin/(authed)/prompts/[slug]/page.tsx) | 2026-05-17 |
| `/admin/(authed)/site` | [app/admin/(authed)/site/page.tsx](../app/admin/(authed)/site/page.tsx) | 2026-05-15 |
| `/admin/login` | [app/admin/login/page.tsx](../app/admin/login/page.tsx) | 2026-05-15 |
| `/ai-readiness-assessment` | [app/ai-readiness-assessment/page.tsx](../app/ai-readiness-assessment/page.tsx) | 2026-05-15 |
| `/book/[slug]` | [app/book/[slug]/page.tsx](../app/book/[slug]/page.tsx) | 2026-05-17 |
| `/book/[slug]/confirmation/[bookingId]` | [app/book/[slug]/confirmation/[bookingId]/page.tsx](../app/book/[slug]/confirmation/[bookingId]/page.tsx) | 2026-05-17 |
| `/book/manage/[token]` | [app/book/manage/[token]/page.tsx](../app/book/manage/[token]/page.tsx) | 2026-05-17 |
| `/book/manage/[token]/reschedule` | [app/book/manage/[token]/reschedule/page.tsx](../app/book/manage/[token]/reschedule/page.tsx) | 2026-05-17 |
| `/contact` | [app/contact/page.tsx](../app/contact/page.tsx) | 2026-05-15 |
| `/privacy` | [app/privacy/page.tsx](../app/privacy/page.tsx) | 2026-05-15 |
| `/sign-in` | [app/sign-in/page.tsx](../app/sign-in/page.tsx) | 2026-05-12 |
| `/sign-in/check-email` | [app/sign-in/check-email/page.tsx](../app/sign-in/check-email/page.tsx) | 2026-05-15 |
| `/terms` | [app/terms/page.tsx](../app/terms/page.tsx) | 2026-05-15 |
| `/tools/ai-readiness` | [app/tools/ai-readiness/page.tsx](../app/tools/ai-readiness/page.tsx) | 2026-05-13 |
| `/tools/ai-readiness/report/[sessionId]` | [app/tools/ai-readiness/report/[sessionId]/page.tsx](../app/tools/ai-readiness/report/[sessionId]/page.tsx) | 2026-05-13 |
| `/tools/ai-readiness/share/[token]` | [app/tools/ai-readiness/share/[token]/page.tsx](../app/tools/ai-readiness/share/[token]/page.tsx) | 2026-05-13 |

## API endpoints (30)

| Endpoint | File | Last shipped |
|----------|------|--------------|
| `/api/admin/google-oauth/cb` | [app/api/admin/google-oauth/cb/route.ts](../app/api/admin/google-oauth/cb/route.ts) | 2026-05-17 |
| `/api/admin/google-oauth/disconnect` | [app/api/admin/google-oauth/disconnect/route.ts](../app/api/admin/google-oauth/disconnect/route.ts) | 2026-05-15 |
| `/api/admin/google-oauth/start` | [app/api/admin/google-oauth/start/route.ts](../app/api/admin/google-oauth/start/route.ts) | 2026-05-15 |
| `/api/admin/integrations` | [app/api/admin/integrations/route.ts](../app/api/admin/integrations/route.ts) | 2026-05-17 |
| `/api/admin/integrations/reveal` | [app/api/admin/integrations/reveal/route.ts](../app/api/admin/integrations/reveal/route.ts) | 2026-05-15 |
| `/api/admin/integrations/reveal-auth` | [app/api/admin/integrations/reveal-auth/route.ts](../app/api/admin/integrations/reveal-auth/route.ts) | 2026-05-15 |
| `/api/admin/integrations/rotate-master-key` | [app/api/admin/integrations/rotate-master-key/route.ts](../app/api/admin/integrations/rotate-master-key/route.ts) | 2026-05-15 |
| `/api/admin/integrations/test/openrouter` | [app/api/admin/integrations/test/openrouter/route.ts](../app/api/admin/integrations/test/openrouter/route.ts) | 2026-05-15 |
| `/api/admin/integrations/test/resend` | [app/api/admin/integrations/test/resend/route.ts](../app/api/admin/integrations/test/resend/route.ts) | 2026-05-15 |
| `/api/admin/login` | [app/api/admin/login/route.ts](../app/api/admin/login/route.ts) | 2026-05-15 |
| `/api/admin/logout` | [app/api/admin/logout/route.ts](../app/api/admin/logout/route.ts) | 2026-05-08 |
| `/api/admin/settings/booking-prompts` | [app/api/admin/settings/booking-prompts/route.ts](../app/api/admin/settings/booking-prompts/route.ts) | 2026-05-17 |
| `/api/admin/settings/diagnostic-content` | [app/api/admin/settings/diagnostic-content/route.ts](../app/api/admin/settings/diagnostic-content/route.ts) | 2026-05-15 |
| `/api/admin/settings/diagnostic-prompt` | [app/api/admin/settings/diagnostic-prompt/route.ts](../app/api/admin/settings/diagnostic-prompt/route.ts) | 2026-05-15 |
| `/api/admin/settings/site` | [app/api/admin/settings/site/route.ts](../app/api/admin/settings/site/route.ts) | 2026-05-08 |
| `/api/auth/lead/logout` | [app/api/auth/lead/logout/route.ts](../app/api/auth/lead/logout/route.ts) | 2026-05-13 |
| `/api/auth/lead/request` | [app/api/auth/lead/request/route.ts](../app/api/auth/lead/request/route.ts) | 2026-05-15 |
| `/api/auth/lead/verify` | [app/api/auth/lead/verify/route.ts](../app/api/auth/lead/verify/route.ts) | 2026-05-13 |
| `/api/booking/[slug]/availability` | [app/api/booking/[slug]/availability/route.ts](../app/api/booking/[slug]/availability/route.ts) | 2026-05-17 |
| `/api/booking/[slug]/create` | [app/api/booking/[slug]/create/route.ts](../app/api/booking/[slug]/create/route.ts) | 2026-05-17 |
| `/api/booking/cancel` | [app/api/booking/cancel/route.ts](../app/api/booking/cancel/route.ts) | 2026-05-17 |
| `/api/booking/intake-followup` | [app/api/booking/intake-followup/route.ts](../app/api/booking/intake-followup/route.ts) | 2026-05-17 |
| `/api/booking/reschedule` | [app/api/booking/reschedule/route.ts](../app/api/booking/reschedule/route.ts) | 2026-05-17 |
| `/api/contact` | [app/api/contact/route.ts](../app/api/contact/route.ts) | 2026-05-15 |
| `/api/cron/process-scheduled` | [app/api/cron/process-scheduled/route.ts](../app/api/cron/process-scheduled/route.ts) | 2026-05-17 |
| `/api/diagnostic/generate` | [app/api/diagnostic/generate/route.ts](../app/api/diagnostic/generate/route.ts) | 2026-05-13 |
| `/api/diagnostic/report/[sessionId]/pdf` | [app/api/diagnostic/report/[sessionId]/pdf/route.ts](../app/api/diagnostic/report/[sessionId]/pdf/route.ts) | 2026-05-15 |
| `/api/diagnostic/share` | [app/api/diagnostic/share/route.ts](../app/api/diagnostic/share/route.ts) | 2026-05-13 |
| `/api/diagnostic/share/[id]/revoke` | [app/api/diagnostic/share/[id]/revoke/route.ts](../app/api/diagnostic/share/[id]/revoke/route.ts) | 2026-05-13 |
| `/api/health/cron` | [app/api/health/cron/route.ts](../app/api/health/cron/route.ts) | 2026-05-17 |

## Components (18)

| File | Last shipped |
|------|--------------|
| [components/admin/integrations/integrations-grid.tsx](../components/admin/integrations/integrations-grid.tsx) | 2026-05-17 |
| [components/admin/integrations/integrations-panel.tsx](../components/admin/integrations/integrations-panel.tsx) | 2026-05-17 |
| [components/booking/calendar-picker.tsx](../components/booking/calendar-picker.tsx) | 2026-05-17 |
| [components/contact/contact-form.tsx](../components/contact/contact-form.tsx) | 2026-05-15 |
| [components/layout/footer.tsx](../components/layout/footer.tsx) | 2026-05-15 |
| [components/layout/header.tsx](../components/layout/header.tsx) | 2026-05-15 |
| [components/layout/lead-sign-out-button.tsx](../components/layout/lead-sign-out-button.tsx) | 2026-05-15 |
| [components/layout/nav.tsx](../components/layout/nav.tsx) | 2026-05-15 |
| [components/ui/add-to-calendar-buttons.tsx](../components/ui/add-to-calendar-buttons.tsx) | 2026-05-15 |
| [components/ui/button.tsx](../components/ui/button.tsx) | 2026-05-15 |
| [components/ui/day-cell.tsx](../components/ui/day-cell.tsx) | 2026-05-15 |
| [components/ui/dialog.tsx](../components/ui/dialog.tsx) | 2026-05-15 |
| [components/ui/field.tsx](../components/ui/field.tsx) | 2026-05-15 |
| [components/ui/pill.tsx](../components/ui/pill.tsx) | 2026-05-15 |
| [components/ui/skeleton.tsx](../components/ui/skeleton.tsx) | 2026-05-15 |
| [components/ui/slot-pill.tsx](../components/ui/slot-pill.tsx) | 2026-05-15 |
| [components/ui/step-heading.tsx](../components/ui/step-heading.tsx) | 2026-05-15 |
| [components/ui/trust-micro.tsx](../components/ui/trust-micro.tsx) | 2026-05-15 |

