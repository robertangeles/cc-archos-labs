---
title: No on-site comments — reply-by-email instead
category: decision
created: 2026-05-24
updated: 2026-07-25
related: [[translation-layer]], [[2026-05-20-translation-layer-public-render]], [[2026-05-24-blog-tidy-ceo-review]]
---

> **SUPERSEDED 2026-07-25 — the reply-by-email CTA was removed from `/blog/[slug]`.**
> `components/blog/reply-by-email.tsx` is deleted; the post tail is now
> PostBody → SocialShare → AuthorBio → ReadNext. The "no on-site comments"
> half of this decision still holds — there is still no comment system, and
> none is planned. What changed is the replacement: the CTA named Rob's inbox
> directly, which stopped making sense once the byline became Metis. The
> reasoning below is kept as the record of why comments were rejected.
> (Byline change logged in `wiki/log.md` under 2026-07-25.)

The Translation Layer does not have an on-site comment system. Reader feedback flows through a "Reply by email" CTA at the foot of every post, plus the existing LinkedIn and email share affordances. This is a deliberate brand decision, not a deferred feature.

## What ships

- A `<ReplyByEmail>` component slotted between `<PostBody>` and `<SocialShare>` on every `/blog/[slug]` page.
- Pre-filled mailto: link with subject "Re: <post title>" so the reader doesn't have to type one.
- Recipient is `consultant.publicEmail` (falls back to `consultant.email`) via `getPrimaryConsultant()` in `lib/booking.ts`.
- CTA is suppressed if no consultant is configured — the page renders without it rather than with a broken mailto:.

## What does not ship

- No on-site comment threads, no inline discussion, no Disqus/Hyvor/Coral/Commento integration.
- No upvotes, no reactions, no view counters.
- No comment moderation queue, no spam filter, no email-notification fan-out for replies.

## Why

### The brand needs reader feedback to feel like a 1:1 conversation, not a public square

The Translation Layer is the publication arm of a solo consulting practice. Readers we want most are senior executives weighing whether to talk to Rob. The conversion path is post → trust → book a call. A public comment thread that reads "first!" or "great post bro" actively erodes trust on that path — and even high-quality comment threads consume reader attention that should land on the CTA stack.

### Comments demand moderation Rob can't sustain

A one-person practice cannot moderate a public comment thread without it becoming the practice. The math doesn't work even at moderate volume — at 100 comments/week with 30% requiring response or removal, that's 5+ hours/week of moderation that produces zero revenue and a constant context-switch tax.

### Spam is a permanent operating cost

The prior WordPress install (robertangeles.com) was hit hard enough by comment spam that the migration inventory explicitly noted it as one reason to leave WP. Any on-site comment system inherits the same problem regardless of platform. Reply-by-email shifts the spam problem to Gmail/Outlook, which already win at it.

### The brand's reference set has no comments

The publications Rob aspires to compete with — Stratechery (Ben Thompson), patio11's bits (Patrick McKenzie), A16Z, FirstRound Review, Stripe Press, Benedict Evans — all have zero on-site comments. Engagement happens via email, LinkedIn, and Twitter. None of these brands lose to platforms with comments; they win precisely because their reader relationship feels personal.

### "Reply by email" selects for higher-signal feedback

Readers who care enough to write an email are typically the readers worth hearing from. The friction filters out drive-by negativity and rewards considered responses. Inbox replies also route directly to where they can become consulting conversations.

## When this decision would be revisited

- If the publication grows past ~50k readers/post and a community forms organically on a third-party surface (Substack chat, Discord, etc.), revisit whether to give that community an on-site home.
- If a paid product launches that needs user-to-user discussion (e.g., a course or a SaaS tool), revisit whether comments make sense in *that* surface — separate from the blog.
- If the brand pivots to community-driven rather than practitioner-led, the entire posture changes.

None of those trigger conditions exist today, none are projected to exist within 12 months. This decision is the right answer for the foreseeable horizon.

## What this supersedes

- [Phase D explicit deferrals](2026-05-20-posts-admin-phase-d-ui.md) line "Comments / discussion — not a planned surface for this brand" — this decision promotes that one-liner into a written policy with reasoning.

## What this enables

- Newsletter capture (Phase D item 35, deferred) becomes the next investment for reader engagement. Newsletter beats comments on every brand-relevant axis: owned audience, repeat exposure, segmentation, lead source.
- The blog page footprint stays focused on the CTA stack (book / assess / share) without comment-section visual weight.

## Implementation reference

- Component: [`components/blog/reply-by-email.tsx`](../../components/blog/reply-by-email.tsx)
- Wired into: [`app/blog/[slug]/page.tsx`](../../app/blog/[slug]/page.tsx) between `<PostBody>` and `<SocialShare>`
- Recipient lookup: [`getPrimaryConsultant()`](../../lib/booking.ts) returns the first consultant by `created_at`; uses `publicEmail` with fallback to `email`
- Failure mode: if no consultant is configured, the CTA is suppressed — no broken mailto: ships
