// Reply-by-email CTA — replaces an on-site comment system for this brand.
// Sits between <PostBody> and <SocialShare> at the end of /blog/[slug].
//
// Why this and not comments: the practitioner-led brand voice + single-
// person practice can't sustain comment moderation; on-site discourse
// quality from cold readers is consistently worse than what arrives in
// an inbox. Reply-by-email selects for readers who care enough to write
// — exactly the audience we want. Reference set with the same posture:
// Stratechery, Patrick McKenzie's bits, A16Z, FirstRound Review, Stripe
// Press. See wiki/decisions/2026-05-24-no-comments-reply-by-email.md.
//
// Server component — receives the recipient email from the page that
// renders it (sourced from getPrimaryConsultant.publicEmail). Renders
// a single mailto: anchor with a sensible pre-filled subject. No client
// JS, no analytics beacon — the user's mail client takes over on click.

interface ReplyByEmailProps {
  /** Recipient address (e.g. consultant.publicEmail). */
  toEmail: string;
  /** Used to pre-fill the email subject as "Re: <postTitle>". */
  postTitle: string;
}

export function ReplyByEmail({ toEmail, postTitle }: ReplyByEmailProps) {
  // Pre-fill subject so the reader doesn't have to type one.
  // encodeURIComponent handles quotes / colons / unicode safely.
  const subject = encodeURIComponent(`Re: ${postTitle}`);
  const href = `mailto:${toEmail}?subject=${subject}`;

  return (
    <aside
      // Visual rhythm: same spacing + border treatment as <AuthorBio>
      // and <ReadNext>, so this slots into the post tail naturally.
      className="mt-16 rounded-lg border border-hairline bg-surface-1 p-6 md:p-8"
    >
      <p className="text-eyebrow uppercase tracking-[0.12em] text-ink-subtle">
        Reply
      </p>
      <h2 className="mt-3 text-card-title text-ink">
        Thoughts on this? Reply by email.
      </h2>
      <p className="mt-3 text-body-sm leading-relaxed text-ink-subtle">
        No comments section — replies come straight to Rob&rsquo;s inbox.
        High-signal feedback wins.
      </p>
      <a
        href={href}
        // Mobile tap target: 44px minimum (Apple HIG / WCAG). py-3
        // + the natural text height + padding gets us comfortably
        // over that on every breakpoint.
        className="mt-5 inline-flex min-h-[44px] items-center rounded-md border border-hairline px-5 py-3 text-sm font-medium text-ink hover:bg-surface-2"
      >
        Reply by email →
      </a>
    </aside>
  );
}
