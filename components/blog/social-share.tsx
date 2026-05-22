import { FacebookIcon, LinkedinIcon, XIcon } from "../icons/social";

// Article share row. Plain anchor tags — no JS, no analytics, no popup
// window sizing. The respective platforms handle the share dialog.
//
// Rendered twice on a post page (above + below the author bio) so both
// the skimmer and the finisher get a share moment without the row
// feeling heavy in either spot.
//
// `variant` controls only the surrounding spacing/border so the two
// placements read as distinct rather than identical:
//   - "post-body" — tight top border, sits between body and author bio
//   - "footer"    — no border, sits below the author bio inside the
//                   same article column

export interface SocialShareProps {
  url: string;
  title: string;
  variant?: "post-body" | "footer";
}

export function SocialShare({
  url,
  title,
  variant = "post-body",
}: SocialShareProps) {
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
  const xHref = `https://x.com/intent/post?url=${encodedUrl}&text=${encodedTitle}`;
  const facebookHref = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;

  const containerCls =
    variant === "post-body"
      ? "mt-16 flex items-center gap-4 border-t border-hairline pt-8"
      : "mt-12 flex items-center gap-4";

  const iconCls =
    "inline-flex h-10 w-10 items-center justify-center rounded-full border border-hairline text-ink-subtle transition-colors hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary focus-visible:outline-none";

  return (
    <div className={containerCls} aria-label="Share this article">
      <span className="text-eyebrow uppercase tracking-[0.08em] text-ink-subtle">
        Share
      </span>
      <a
        href={linkedinHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on LinkedIn"
        className={iconCls}
      >
        <LinkedinIcon className="h-4 w-4" aria-hidden />
      </a>
      <a
        href={xHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on X"
        className={iconCls}
      >
        <XIcon className="h-4 w-4" aria-hidden />
      </a>
      <a
        href={facebookHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on Facebook"
        className={iconCls}
      >
        <FacebookIcon className="h-4 w-4" aria-hidden />
      </a>
    </div>
  );
}
