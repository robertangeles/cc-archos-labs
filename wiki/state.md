---
title: Project state — auto-generated
category: synthesis
generated: 2026-06-08T06:11:17.298Z
generator: scripts/wiki-state.mjs
---

Auto-generated snapshot of what is currently shipped. **Source of truth for ship state.** Read this before claiming any route, API endpoint, or component does not exist.

Do not hand-edit. Regenerate with `pnpm wiki:state` or stage any change under `app/` or `components/` to fire the pre-commit hook.

## Routes (58)

| Route | File | Last shipped |
|-------|------|--------------|
| `/` | [app/page.tsx](../app/page.tsx) | 2026-05-27 |
| `/(auth)/auth/password-reset/[token]` | [app/(auth)/auth/password-reset/[token]/page.tsx](../app/(auth)/auth/password-reset/[token]/page.tsx) | 2026-06-03 |
| `/(auth)/forgot-password` | [app/(auth)/forgot-password/page.tsx](../app/(auth)/forgot-password/page.tsx) | 2026-06-03 |
| `/(auth)/login` | [app/(auth)/login/page.tsx](../app/(auth)/login/page.tsx) | 2026-06-03 |
| `/(auth)/register` | [app/(auth)/register/page.tsx](../app/(auth)/register/page.tsx) | 2026-06-03 |
| `/[...slug]` | [app/[...slug]/page.tsx](../app/[...slug]/page.tsx) | 2026-05-18 |
| `/about` | [app/about/page.tsx](../app/about/page.tsx) | 2026-05-27 |
| `/account` | [app/account/page.tsx](../app/account/page.tsx) | 2026-06-07 |
| `/account/history` | [app/account/history/page.tsx](../app/account/history/page.tsx) | 2026-06-07 |
| `/account/personalisation` | [app/account/personalisation/page.tsx](../app/account/personalisation/page.tsx) | 2026-06-08 |
| `/account/skills` | [app/account/skills/page.tsx](../app/account/skills/page.tsx) | 2026-06-07 |
| `/account/skills/[id]` | [app/account/skills/[id]/page.tsx](../app/account/skills/[id]/page.tsx) | 2026-06-07 |
| `/account/skills/[id]/edit` | [app/account/skills/[id]/edit/page.tsx](../app/account/skills/[id]/edit/page.tsx) | 2026-06-07 |
| `/account/skills/new` | [app/account/skills/new/page.tsx](../app/account/skills/new/page.tsx) | 2026-06-07 |
| `/account/workflows` | [app/account/workflows/page.tsx](../app/account/workflows/page.tsx) | 2026-06-07 |
| `/account/workflows/[id]` | [app/account/workflows/[id]/page.tsx](../app/account/workflows/[id]/page.tsx) | 2026-06-07 |
| `/account/workflows/new` | [app/account/workflows/new/page.tsx](../app/account/workflows/new/page.tsx) | 2026-06-07 |
| `/account/workspace` | [app/account/workspace/page.tsx](../app/account/workspace/page.tsx) | 2026-06-08 |
| `/admin/(authed)/auth` | [app/admin/(authed)/auth/page.tsx](../app/admin/(authed)/auth/page.tsx) | 2026-05-26 |
| `/admin/(authed)/blog` | [app/admin/(authed)/blog/page.tsx](../app/admin/(authed)/blog/page.tsx) | 2026-05-20 |
| `/admin/(authed)/blog/posts` | [app/admin/(authed)/blog/posts/page.tsx](../app/admin/(authed)/blog/posts/page.tsx) | 2026-05-21 |
| `/admin/(authed)/blog/posts/[id]` | [app/admin/(authed)/blog/posts/[id]/page.tsx](../app/admin/(authed)/blog/posts/[id]/page.tsx) | 2026-05-21 |
| `/admin/(authed)/blog/posts/[id]/revisions` | [app/admin/(authed)/blog/posts/[id]/revisions/page.tsx](../app/admin/(authed)/blog/posts/[id]/revisions/page.tsx) | 2026-05-21 |
| `/admin/(authed)/blog/posts/new` | [app/admin/(authed)/blog/posts/new/page.tsx](../app/admin/(authed)/blog/posts/new/page.tsx) | 2026-05-21 |
| `/admin/(authed)/cdmp` | [app/admin/(authed)/cdmp/page.tsx](../app/admin/(authed)/cdmp/page.tsx) | 2026-06-03 |
| `/admin/(authed)/diagnostic` | [app/admin/(authed)/diagnostic/page.tsx](../app/admin/(authed)/diagnostic/page.tsx) | 2026-05-15 |
| `/admin/(authed)/integrations` | [app/admin/(authed)/integrations/page.tsx](../app/admin/(authed)/integrations/page.tsx) | 2026-05-15 |
| `/admin/(authed)/integrations/[slug]` | [app/admin/(authed)/integrations/[slug]/page.tsx](../app/admin/(authed)/integrations/[slug]/page.tsx) | 2026-05-17 |
| `/admin/(authed)/knowledge` | [app/admin/(authed)/knowledge/page.tsx](../app/admin/(authed)/knowledge/page.tsx) | 2026-06-03 |
| `/admin/(authed)/pages` | [app/admin/(authed)/pages/page.tsx](../app/admin/(authed)/pages/page.tsx) | 2026-05-18 |
| `/admin/(authed)/pages/[id]` | [app/admin/(authed)/pages/[id]/page.tsx](../app/admin/(authed)/pages/[id]/page.tsx) | 2026-05-18 |
| `/admin/(authed)/pages/[id]/revisions` | [app/admin/(authed)/pages/[id]/revisions/page.tsx](../app/admin/(authed)/pages/[id]/revisions/page.tsx) | 2026-05-18 |
| `/admin/(authed)/pages/new` | [app/admin/(authed)/pages/new/page.tsx](../app/admin/(authed)/pages/new/page.tsx) | 2026-05-18 |
| `/admin/(authed)/prompts` | [app/admin/(authed)/prompts/page.tsx](../app/admin/(authed)/prompts/page.tsx) | 2026-05-17 |
| `/admin/(authed)/prompts/[slug]` | [app/admin/(authed)/prompts/[slug]/page.tsx](../app/admin/(authed)/prompts/[slug]/page.tsx) | 2026-05-17 |
| `/admin/(authed)/site` | [app/admin/(authed)/site/page.tsx](../app/admin/(authed)/site/page.tsx) | 2026-05-18 |
| `/admin/(authed)/users` | [app/admin/(authed)/users/page.tsx](../app/admin/(authed)/users/page.tsx) | 2026-05-26 |
| `/admin/(authed)/users/[id]` | [app/admin/(authed)/users/[id]/page.tsx](../app/admin/(authed)/users/[id]/page.tsx) | 2026-05-26 |
| `/admin/blog/posts/[id]/preview` | [app/admin/blog/posts/[id]/preview/page.tsx](../app/admin/blog/posts/[id]/preview/page.tsx) | 2026-05-24 |
| `/admin/login` | [app/admin/login/page.tsx](../app/admin/login/page.tsx) | 2026-05-15 |
| `/ai-readiness-assessment` | [app/ai-readiness-assessment/page.tsx](../app/ai-readiness-assessment/page.tsx) | 2026-05-15 |
| `/blog` | [app/blog/page.tsx](../app/blog/page.tsx) | 2026-06-05 |
| `/blog/[slug]` | [app/blog/[slug]/page.tsx](../app/blog/[slug]/page.tsx) | 2026-05-25 |
| `/blog/category/[slug]` | [app/blog/category/[slug]/page.tsx](../app/blog/category/[slug]/page.tsx) | 2026-06-05 |
| `/book/[slug]` | [app/book/[slug]/page.tsx](../app/book/[slug]/page.tsx) | 2026-05-22 |
| `/book/[slug]/confirmation/[bookingId]` | [app/book/[slug]/confirmation/[bookingId]/page.tsx](../app/book/[slug]/confirmation/[bookingId]/page.tsx) | 2026-05-17 |
| `/book/manage/[token]` | [app/book/manage/[token]/page.tsx](../app/book/manage/[token]/page.tsx) | 2026-05-17 |
| `/book/manage/[token]/reschedule` | [app/book/manage/[token]/reschedule/page.tsx](../app/book/manage/[token]/reschedule/page.tsx) | 2026-05-17 |
| `/consulting` | [app/consulting/page.tsx](../app/consulting/page.tsx) | 2026-05-27 |
| `/contact` | [app/contact/page.tsx](../app/contact/page.tsx) | 2026-05-22 |
| `/share/chat/[token]` | [app/share/chat/[token]/page.tsx](../app/share/chat/[token]/page.tsx) | 2026-06-08 |
| `/sign-in` | [app/sign-in/page.tsx](../app/sign-in/page.tsx) | 2026-05-12 |
| `/sign-in/check-email` | [app/sign-in/check-email/page.tsx](../app/sign-in/check-email/page.tsx) | 2026-05-15 |
| `/tools/ai-readiness` | [app/tools/ai-readiness/page.tsx](../app/tools/ai-readiness/page.tsx) | 2026-06-03 |
| `/tools/ai-readiness/report/[sessionId]` | [app/tools/ai-readiness/report/[sessionId]/page.tsx](../app/tools/ai-readiness/report/[sessionId]/page.tsx) | 2026-06-03 |
| `/tools/ai-readiness/share/[token]` | [app/tools/ai-readiness/share/[token]/page.tsx](../app/tools/ai-readiness/share/[token]/page.tsx) | 2026-05-13 |
| `/tools/cdmp-practice` | [app/tools/cdmp-practice/page.tsx](../app/tools/cdmp-practice/page.tsx) | 2026-06-03 |
| `/tools/cdmp-practice/history/[sessionId]` | [app/tools/cdmp-practice/history/[sessionId]/page.tsx](../app/tools/cdmp-practice/history/[sessionId]/page.tsx) | 2026-06-03 |

## API endpoints (96)

| Endpoint | File | Last shipped |
|----------|------|--------------|
| `/api/admin/auth-settings` | [app/api/admin/auth-settings/route.ts](../app/api/admin/auth-settings/route.ts) | 2026-05-26 |
| `/api/admin/google-oauth/cb` | [app/api/admin/google-oauth/cb/route.ts](../app/api/admin/google-oauth/cb/route.ts) | 2026-05-31 |
| `/api/admin/google-oauth/disconnect` | [app/api/admin/google-oauth/disconnect/route.ts](../app/api/admin/google-oauth/disconnect/route.ts) | 2026-05-22 |
| `/api/admin/google-oauth/start` | [app/api/admin/google-oauth/start/route.ts](../app/api/admin/google-oauth/start/route.ts) | 2026-05-15 |
| `/api/admin/integrations` | [app/api/admin/integrations/route.ts](../app/api/admin/integrations/route.ts) | 2026-06-07 |
| `/api/admin/integrations/models` | [app/api/admin/integrations/models/route.ts](../app/api/admin/integrations/models/route.ts) | 2026-06-07 |
| `/api/admin/integrations/reveal` | [app/api/admin/integrations/reveal/route.ts](../app/api/admin/integrations/reveal/route.ts) | 2026-05-15 |
| `/api/admin/integrations/reveal-auth` | [app/api/admin/integrations/reveal-auth/route.ts](../app/api/admin/integrations/reveal-auth/route.ts) | 2026-05-15 |
| `/api/admin/integrations/rotate-master-key` | [app/api/admin/integrations/rotate-master-key/route.ts](../app/api/admin/integrations/rotate-master-key/route.ts) | 2026-05-15 |
| `/api/admin/integrations/test/openrouter` | [app/api/admin/integrations/test/openrouter/route.ts](../app/api/admin/integrations/test/openrouter/route.ts) | 2026-05-15 |
| `/api/admin/integrations/test/resend` | [app/api/admin/integrations/test/resend/route.ts](../app/api/admin/integrations/test/resend/route.ts) | 2026-05-15 |
| `/api/admin/knowledge` | [app/api/admin/knowledge/route.ts](../app/api/admin/knowledge/route.ts) | 2026-06-03 |
| `/api/admin/knowledge/upload` | [app/api/admin/knowledge/upload/route.ts](../app/api/admin/knowledge/upload/route.ts) | 2026-06-03 |
| `/api/admin/login` | [app/api/admin/login/route.ts](../app/api/admin/login/route.ts) | 2026-05-15 |
| `/api/admin/logout` | [app/api/admin/logout/route.ts](../app/api/admin/logout/route.ts) | 2026-05-08 |
| `/api/admin/pages` | [app/api/admin/pages/route.ts](../app/api/admin/pages/route.ts) | 2026-05-18 |
| `/api/admin/pages/[id]` | [app/api/admin/pages/[id]/route.ts](../app/api/admin/pages/[id]/route.ts) | 2026-05-18 |
| `/api/admin/pages/[id]/blocks` | [app/api/admin/pages/[id]/blocks/route.ts](../app/api/admin/pages/[id]/blocks/route.ts) | 2026-05-18 |
| `/api/admin/pages/[id]/restore` | [app/api/admin/pages/[id]/restore/route.ts](../app/api/admin/pages/[id]/restore/route.ts) | 2026-05-18 |
| `/api/admin/pages/[id]/revisions` | [app/api/admin/pages/[id]/revisions/route.ts](../app/api/admin/pages/[id]/revisions/route.ts) | 2026-05-18 |
| `/api/admin/pages/[id]/revisions/[revId]/restore` | [app/api/admin/pages/[id]/revisions/[revId]/restore/route.ts](../app/api/admin/pages/[id]/revisions/[revId]/restore/route.ts) | 2026-05-18 |
| `/api/admin/posts` | [app/api/admin/posts/route.ts](../app/api/admin/posts/route.ts) | 2026-05-20 |
| `/api/admin/posts/[id]` | [app/api/admin/posts/[id]/route.ts](../app/api/admin/posts/[id]/route.ts) | 2026-05-20 |
| `/api/admin/posts/[id]/image` | [app/api/admin/posts/[id]/image/route.ts](../app/api/admin/posts/[id]/image/route.ts) | 2026-06-07 |
| `/api/admin/posts/[id]/regenerate-og` | [app/api/admin/posts/[id]/regenerate-og/route.ts](../app/api/admin/posts/[id]/regenerate-og/route.ts) | 2026-05-20 |
| `/api/admin/posts/[id]/restore` | [app/api/admin/posts/[id]/restore/route.ts](../app/api/admin/posts/[id]/restore/route.ts) | 2026-05-20 |
| `/api/admin/posts/[id]/revisions` | [app/api/admin/posts/[id]/revisions/route.ts](../app/api/admin/posts/[id]/revisions/route.ts) | 2026-05-20 |
| `/api/admin/posts/[id]/revisions/[revId]/restore` | [app/api/admin/posts/[id]/revisions/[revId]/restore/route.ts](../app/api/admin/posts/[id]/revisions/[revId]/restore/route.ts) | 2026-05-20 |
| `/api/admin/posts/[id]/suggest-links` | [app/api/admin/posts/[id]/suggest-links/route.ts](../app/api/admin/posts/[id]/suggest-links/route.ts) | 2026-05-20 |
| `/api/admin/settings/blog-enabled` | [app/api/admin/settings/blog-enabled/route.ts](../app/api/admin/settings/blog-enabled/route.ts) | 2026-05-20 |
| `/api/admin/settings/booking-prompts` | [app/api/admin/settings/booking-prompts/route.ts](../app/api/admin/settings/booking-prompts/route.ts) | 2026-05-17 |
| `/api/admin/settings/cdmp-config` | [app/api/admin/settings/cdmp-config/route.ts](../app/api/admin/settings/cdmp-config/route.ts) | 2026-06-03 |
| `/api/admin/settings/diagnostic-content` | [app/api/admin/settings/diagnostic-content/route.ts](../app/api/admin/settings/diagnostic-content/route.ts) | 2026-05-15 |
| `/api/admin/settings/diagnostic-prompt` | [app/api/admin/settings/diagnostic-prompt/route.ts](../app/api/admin/settings/diagnostic-prompt/route.ts) | 2026-05-15 |
| `/api/admin/settings/site` | [app/api/admin/settings/site/route.ts](../app/api/admin/settings/site/route.ts) | 2026-05-08 |
| `/api/admin/users` | [app/api/admin/users/route.ts](../app/api/admin/users/route.ts) | 2026-05-26 |
| `/api/admin/users/[id]/active` | [app/api/admin/users/[id]/active/route.ts](../app/api/admin/users/[id]/active/route.ts) | 2026-05-26 |
| `/api/admin/users/[id]/role` | [app/api/admin/users/[id]/role/route.ts](../app/api/admin/users/[id]/role/route.ts) | 2026-05-26 |
| `/api/auth/email-change/confirm` | [app/api/auth/email-change/confirm/route.ts](../app/api/auth/email-change/confirm/route.ts) | 2026-06-03 |
| `/api/auth/email-change/request` | [app/api/auth/email-change/request/route.ts](../app/api/auth/email-change/request/route.ts) | 2026-05-25 |
| `/api/auth/google/callback` | [app/api/auth/google/callback/route.ts](../app/api/auth/google/callback/route.ts) | 2026-06-03 |
| `/api/auth/google/start` | [app/api/auth/google/start/route.ts](../app/api/auth/google/start/route.ts) | 2026-05-26 |
| `/api/auth/google/unlink` | [app/api/auth/google/unlink/route.ts](../app/api/auth/google/unlink/route.ts) | 2026-05-26 |
| `/api/auth/lead/logout` | [app/api/auth/lead/logout/route.ts](../app/api/auth/lead/logout/route.ts) | 2026-05-13 |
| `/api/auth/lead/request` | [app/api/auth/lead/request/route.ts](../app/api/auth/lead/request/route.ts) | 2026-05-15 |
| `/api/auth/lead/verify` | [app/api/auth/lead/verify/route.ts](../app/api/auth/lead/verify/route.ts) | 2026-06-03 |
| `/api/auth/login` | [app/api/auth/login/route.ts](../app/api/auth/login/route.ts) | 2026-05-26 |
| `/api/auth/logout` | [app/api/auth/logout/route.ts](../app/api/auth/logout/route.ts) | 2026-05-25 |
| `/api/auth/magic-link/request` | [app/api/auth/magic-link/request/route.ts](../app/api/auth/magic-link/request/route.ts) | 2026-06-03 |
| `/api/auth/magic-link/verify` | [app/api/auth/magic-link/verify/route.ts](../app/api/auth/magic-link/verify/route.ts) | 2026-06-03 |
| `/api/auth/me` | [app/api/auth/me/route.ts](../app/api/auth/me/route.ts) | 2026-06-03 |
| `/api/auth/password-reset/confirm` | [app/api/auth/password-reset/confirm/route.ts](../app/api/auth/password-reset/confirm/route.ts) | 2026-05-25 |
| `/api/auth/password-reset/request` | [app/api/auth/password-reset/request/route.ts](../app/api/auth/password-reset/request/route.ts) | 2026-05-26 |
| `/api/auth/profile` | [app/api/auth/profile/route.ts](../app/api/auth/profile/route.ts) | 2026-06-03 |
| `/api/auth/register` | [app/api/auth/register/route.ts](../app/api/auth/register/route.ts) | 2026-06-03 |
| `/api/auth/verify-email` | [app/api/auth/verify-email/route.ts](../app/api/auth/verify-email/route.ts) | 2026-06-03 |
| `/api/booking/[slug]/availability` | [app/api/booking/[slug]/availability/route.ts](../app/api/booking/[slug]/availability/route.ts) | 2026-05-17 |
| `/api/booking/[slug]/create` | [app/api/booking/[slug]/create/route.ts](../app/api/booking/[slug]/create/route.ts) | 2026-05-17 |
| `/api/booking/cancel` | [app/api/booking/cancel/route.ts](../app/api/booking/cancel/route.ts) | 2026-05-17 |
| `/api/booking/intake-followup` | [app/api/booking/intake-followup/route.ts](../app/api/booking/intake-followup/route.ts) | 2026-05-17 |
| `/api/booking/reschedule` | [app/api/booking/reschedule/route.ts](../app/api/booking/reschedule/route.ts) | 2026-05-17 |
| `/api/cdmp/answer` | [app/api/cdmp/answer/route.ts](../app/api/cdmp/answer/route.ts) | 2026-06-03 |
| `/api/cdmp/complete` | [app/api/cdmp/complete/route.ts](../app/api/cdmp/complete/route.ts) | 2026-06-03 |
| `/api/cdmp/flag` | [app/api/cdmp/flag/route.ts](../app/api/cdmp/flag/route.ts) | 2026-06-03 |
| `/api/cdmp/history` | [app/api/cdmp/history/route.ts](../app/api/cdmp/history/route.ts) | 2026-06-03 |
| `/api/cdmp/results/[sessionId]` | [app/api/cdmp/results/[sessionId]/route.ts](../app/api/cdmp/results/[sessionId]/route.ts) | 2026-06-03 |
| `/api/cdmp/start` | [app/api/cdmp/start/route.ts](../app/api/cdmp/start/route.ts) | 2026-06-03 |
| `/api/chat/conversations` | [app/api/chat/conversations/route.ts](../app/api/chat/conversations/route.ts) | 2026-06-08 |
| `/api/chat/conversations/[id]` | [app/api/chat/conversations/[id]/route.ts](../app/api/chat/conversations/[id]/route.ts) | 2026-06-08 |
| `/api/chat/conversations/[id]/messages` | [app/api/chat/conversations/[id]/messages/route.ts](../app/api/chat/conversations/[id]/messages/route.ts) | 2026-06-08 |
| `/api/chat/conversations/[id]/share` | [app/api/chat/conversations/[id]/share/route.ts](../app/api/chat/conversations/[id]/share/route.ts) | 2026-06-08 |
| `/api/chat/conversations/search` | [app/api/chat/conversations/search/route.ts](../app/api/chat/conversations/search/route.ts) | 2026-06-08 |
| `/api/chat/slash-command` | [app/api/chat/slash-command/route.ts](../app/api/chat/slash-command/route.ts) | 2026-06-08 |
| `/api/contact` | [app/api/contact/route.ts](../app/api/contact/route.ts) | 2026-05-15 |
| `/api/cron/process-scheduled` | [app/api/cron/process-scheduled/route.ts](../app/api/cron/process-scheduled/route.ts) | 2026-05-17 |
| `/api/cron/process-scheduled-posts` | [app/api/cron/process-scheduled-posts/route.ts](../app/api/cron/process-scheduled-posts/route.ts) | 2026-05-20 |
| `/api/cron/purge-inactive-leads` | [app/api/cron/purge-inactive-leads/route.ts](../app/api/cron/purge-inactive-leads/route.ts) | 2026-05-18 |
| `/api/cron/purge-session-metadata` | [app/api/cron/purge-session-metadata/route.ts](../app/api/cron/purge-session-metadata/route.ts) | 2026-05-18 |
| `/api/diagnostic/generate` | [app/api/diagnostic/generate/route.ts](../app/api/diagnostic/generate/route.ts) | 2026-06-03 |
| `/api/diagnostic/report/[sessionId]/pdf` | [app/api/diagnostic/report/[sessionId]/pdf/route.ts](../app/api/diagnostic/report/[sessionId]/pdf/route.ts) | 2026-06-03 |
| `/api/diagnostic/share` | [app/api/diagnostic/share/route.ts](../app/api/diagnostic/share/route.ts) | 2026-06-03 |
| `/api/diagnostic/share/[id]/revoke` | [app/api/diagnostic/share/[id]/revoke/route.ts](../app/api/diagnostic/share/[id]/revoke/route.ts) | 2026-06-03 |
| `/api/events` | [app/api/events/route.ts](../app/api/events/route.ts) | 2026-05-18 |
| `/api/health/cron` | [app/api/health/cron/route.ts](../app/api/health/cron/route.ts) | 2026-05-17 |
| `/api/rules` | [app/api/rules/route.ts](../app/api/rules/route.ts) | 2026-06-08 |
| `/api/rules/[id]` | [app/api/rules/[id]/route.ts](../app/api/rules/[id]/route.ts) | 2026-06-08 |
| `/api/rules/[id]/toggle` | [app/api/rules/[id]/toggle/route.ts](../app/api/rules/[id]/toggle/route.ts) | 2026-06-08 |
| `/api/skills` | [app/api/skills/route.ts](../app/api/skills/route.ts) | 2026-06-07 |
| `/api/skills/[id]` | [app/api/skills/[id]/route.ts](../app/api/skills/[id]/route.ts) | 2026-06-07 |
| `/api/skills/[id]/execute` | [app/api/skills/[id]/execute/route.ts](../app/api/skills/[id]/execute/route.ts) | 2026-06-08 |
| `/api/skills/[id]/versions` | [app/api/skills/[id]/versions/route.ts](../app/api/skills/[id]/versions/route.ts) | 2026-06-07 |
| `/api/skills/models` | [app/api/skills/models/route.ts](../app/api/skills/models/route.ts) | 2026-06-07 |
| `/api/workflows` | [app/api/workflows/route.ts](../app/api/workflows/route.ts) | 2026-06-07 |
| `/api/workflows/[id]` | [app/api/workflows/[id]/route.ts](../app/api/workflows/[id]/route.ts) | 2026-06-07 |
| `/api/workflows/[id]/duplicate` | [app/api/workflows/[id]/duplicate/route.ts](../app/api/workflows/[id]/duplicate/route.ts) | 2026-06-07 |
| `/api/workflows/[id]/execute` | [app/api/workflows/[id]/execute/route.ts](../app/api/workflows/[id]/execute/route.ts) | 2026-06-07 |

## Components (88)

| File | Last shipped |
|------|--------------|
| [components/admin/integrations/integrations-grid.tsx](../components/admin/integrations/integrations-grid.tsx) | 2026-05-17 |
| [components/admin/integrations/integrations-panel.tsx](../components/admin/integrations/integrations-panel.tsx) | 2026-06-07 |
| [components/analytics/analytics-client.tsx](../components/analytics/analytics-client.tsx) | 2026-05-18 |
| [components/blog/author-bio.tsx](../components/blog/author-bio.tsx) | 2026-05-24 |
| [components/blog/category-chips.tsx](../components/blog/category-chips.tsx) | 2026-05-20 |
| [components/blog/editorial-list-row.tsx](../components/blog/editorial-list-row.tsx) | 2026-05-21 |
| [components/blog/heading-copy-link-button.tsx](../components/blog/heading-copy-link-button.tsx) | 2026-05-20 |
| [components/blog/pagination.tsx](../components/blog/pagination.tsx) | 2026-05-20 |
| [components/blog/post-body.tsx](../components/blog/post-body.tsx) | 2026-05-20 |
| [components/blog/post-header.tsx](../components/blog/post-header.tsx) | 2026-05-21 |
| [components/blog/read-next.tsx](../components/blog/read-next.tsx) | 2026-05-21 |
| [components/blog/reply-by-email.tsx](../components/blog/reply-by-email.tsx) | 2026-05-24 |
| [components/blog/social-share.tsx](../components/blog/social-share.tsx) | 2026-05-22 |
| [components/blog/toc.tsx](../components/blog/toc.tsx) | 2026-05-20 |
| [components/booking/calendar-picker.tsx](../components/booking/calendar-picker.tsx) | 2026-05-17 |
| [components/chat/chat-empty-state.tsx](../components/chat/chat-empty-state.tsx) | 2026-06-08 |
| [components/chat/chat-input.tsx](../components/chat/chat-input.tsx) | 2026-06-08 |
| [components/chat/chat-message.tsx](../components/chat/chat-message.tsx) | 2026-06-08 |
| [components/chat/chat-model-picker.tsx](../components/chat/chat-model-picker.tsx) | 2026-06-08 |
| [components/chat/chat-sidebar.tsx](../components/chat/chat-sidebar.tsx) | 2026-06-08 |
| [components/chat/chat-skill-form.tsx](../components/chat/chat-skill-form.tsx) | 2026-06-08 |
| [components/contact/contact-form.tsx](../components/contact/contact-form.tsx) | 2026-05-15 |
| [components/diagnostic/recommended-readings.tsx](../components/diagnostic/recommended-readings.tsx) | 2026-05-24 |
| [components/icons/social.tsx](../components/icons/social.tsx) | 2026-05-22 |
| [components/layout/footer.tsx](../components/layout/footer.tsx) | 2026-05-18 |
| [components/layout/header.tsx](../components/layout/header.tsx) | 2026-05-22 |
| [components/layout/lead-sign-out-button.tsx](../components/layout/lead-sign-out-button.tsx) | 2026-06-03 |
| [components/layout/nav.tsx](../components/layout/nav.tsx) | 2026-06-08 |
| [components/pages/block-error-boundary.tsx](../components/pages/block-error-boundary.tsx) | 2026-05-18 |
| [components/pages/blocks-renderer.test.tsx](../components/pages/blocks-renderer.test.tsx) | 2026-05-18 |
| [components/pages/blocks-renderer.tsx](../components/pages/blocks-renderer.tsx) | 2026-05-19 |
| [components/pages/blocks/closing-statement-block.tsx](../components/pages/blocks/closing-statement-block.tsx) | 2026-05-19 |
| [components/pages/blocks/cta-pair-block.tsx](../components/pages/blocks/cta-pair-block.tsx) | 2026-05-18 |
| [components/pages/blocks/editorial-essay-block.tsx](../components/pages/blocks/editorial-essay-block.tsx) | 2026-05-19 |
| [components/pages/blocks/editorial-faq-block.tsx](../components/pages/blocks/editorial-faq-block.tsx) | 2026-05-19 |
| [components/pages/blocks/hero-block.tsx](../components/pages/blocks/hero-block.tsx) | 2026-05-19 |
| [components/pages/blocks/markdown-block.tsx](../components/pages/blocks/markdown-block.tsx) | 2026-05-19 |
| [components/pages/blocks/objection-faq-block.tsx](../components/pages/blocks/objection-faq-block.tsx) | 2026-05-19 |
| [components/pages/blocks/process-steps-block.tsx](../components/pages/blocks/process-steps-block.tsx) | 2026-05-19 |
| [components/pages/blocks/proof-grid-block.tsx](../components/pages/blocks/proof-grid-block.tsx) | 2026-05-18 |
| [components/pages/blocks/quick-diagnosis-block.tsx](../components/pages/blocks/quick-diagnosis-block.tsx) | 2026-05-19 |
| [components/pages/blocks/section-counter.tsx](../components/pages/blocks/section-counter.tsx) | 2026-05-19 |
| [components/pages/blocks/service-grid-block.tsx](../components/pages/blocks/service-grid-block.tsx) | 2026-05-18 |
| [components/pages/blocks/stat-band-block.tsx](../components/pages/blocks/stat-band-block.tsx) | 2026-05-19 |
| [components/pages/blocks/timeline-block.tsx](../components/pages/blocks/timeline-block.tsx) | 2026-05-19 |
| [components/pages/markdown-article.test.tsx](../components/pages/markdown-article.test.tsx) | 2026-05-18 |
| [components/pages/markdown-article.tsx](../components/pages/markdown-article.tsx) | 2026-05-18 |
| [components/rules/rule-form.tsx](../components/rules/rule-form.tsx) | 2026-06-08 |
| [components/rules/rules-list.tsx](../components/rules/rules-list.tsx) | 2026-06-08 |
| [components/sections/about/index.ts](../components/sections/about/index.ts) | 2026-05-18 |
| [components/sections/about/person-card.tsx](../components/sections/about/person-card.tsx) | 2026-05-27 |
| [components/sections/about/philosophy-block.tsx](../components/sections/about/philosophy-block.tsx) | 2026-05-27 |
| [components/sections/about/selected-work-card.tsx](../components/sections/about/selected-work-card.tsx) | 2026-05-18 |
| [components/sections/about/way-of-working-steps.tsx](../components/sections/about/way-of-working-steps.tsx) | 2026-05-27 |
| [components/sections/home/anchor-nav.tsx](../components/sections/home/anchor-nav.tsx) | 2026-05-27 |
| [components/sections/home/audience-list.tsx](../components/sections/home/audience-list.tsx) | 2026-05-27 |
| [components/sections/home/cta-pair.tsx](../components/sections/home/cta-pair.tsx) | 2026-05-18 |
| [components/sections/home/hero.tsx](../components/sections/home/hero.tsx) | 2026-05-27 |
| [components/sections/home/index.ts](../components/sections/home/index.ts) | 2026-05-18 |
| [components/sections/home/objection-faq.tsx](../components/sections/home/objection-faq.tsx) | 2026-05-18 |
| [components/sections/home/proof-item.tsx](../components/sections/home/proof-item.tsx) | 2026-05-27 |
| [components/sections/home/section.tsx](../components/sections/home/section.tsx) | 2026-05-27 |
| [components/sections/home/service-card.tsx](../components/sections/home/service-card.tsx) | 2026-05-27 |
| [components/sections/home/sticky-mobile-cta.tsx](../components/sections/home/sticky-mobile-cta.tsx) | 2026-05-18 |
| [components/sections/home/timeline.tsx](../components/sections/home/timeline.tsx) | 2026-05-27 |
| [components/skills/model-selector.tsx](../components/skills/model-selector.tsx) | 2026-06-07 |
| [components/skills/skill-creator.tsx](../components/skills/skill-creator.tsx) | 2026-06-07 |
| [components/skills/skill-detail.tsx](../components/skills/skill-detail.tsx) | 2026-06-08 |
| [components/skills/skills-list.tsx](../components/skills/skills-list.tsx) | 2026-06-08 |
| [components/skills/use-enabled-models.ts](../components/skills/use-enabled-models.ts) | 2026-06-07 |
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
| [components/workflows/edit-tab.tsx](../components/workflows/edit-tab.tsx) | 2026-06-07 |
| [components/workflows/field-builder.tsx](../components/workflows/field-builder.tsx) | 2026-06-07 |
| [components/workflows/run-tab.tsx](../components/workflows/run-tab.tsx) | 2026-06-07 |
| [components/workflows/step-designer.tsx](../components/workflows/step-designer.tsx) | 2026-06-07 |
| [components/workflows/workflow-builder.tsx](../components/workflows/workflow-builder.tsx) | 2026-06-07 |
| [components/workflows/workflow-creator.tsx](../components/workflows/workflow-creator.tsx) | 2026-06-07 |
| [components/workflows/workflow-settings.tsx](../components/workflows/workflow-settings.tsx) | 2026-06-07 |
| [components/workflows/workflows-list.tsx](../components/workflows/workflows-list.tsx) | 2026-06-08 |

