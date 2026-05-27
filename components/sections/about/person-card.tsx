// Person section card — photo slot + name/role + bio paragraphs +
// credentials chip row + social link list.
//
// Composition: photo on the left (md+), bio on the right. Stacks on
// mobile. The photo slot is intentionally placeholder-tolerant: when
// `photoSrc` is null, a hairline-outlined figure renders with a
// single-line mono caption signalling intent. Photo lands later as a
// one-line config change without touching layout.
//
// Photo treatment uses rounded-xl (16px) per the May 2026 /about brief
// — matches DESIGN.md's product-screenshot-card token. Credential pills
// use rounded-sm (6px) per the same brief, NOT rounded-full, so they
// read as tags rather than status pills.
//
// rel="me noopener" on outbound links: `me` reinforces Person identity
// for verification (Mastodon/IndieAuth pattern) and aligns with the
// Schema.org Person `sameAs` payload; `noopener` blocks the reverse-tab
// vector.

import Image from "next/image";
import { PLATFORM_META, type SocialLink, type SocialPlatform } from "../../../lib/social-links";

// Re-export for downstream consumers that still import from this file.
export type { SocialLink, SocialPlatform };

export type PersonCardProps = {
  name: string;
  role: string;
  paragraphs: string[];
  credentials: string[];
  photoSrc: string | null;
  photoAlt?: string;
  /** Social-platform identity links rendered as a small text list below
   *  the credentials chips. Each entry contributes one anchor labelled by
   *  the platform's display name. Empty array hides the row. */
  socialLinks: SocialLink[];
};

export function PersonCard({
  name,
  role,
  paragraphs,
  credentials,
  photoSrc,
  photoAlt = "",
  socialLinks,
}: PersonCardProps) {
  return (
    <article className="grid gap-10 md:grid-cols-[1fr_2fr] md:gap-12">
      <figure className="relative aspect-[4/5] overflow-hidden rounded-xl border border-hairline bg-surface-1">
        {photoSrc ? (
          <Image
            src={photoSrc}
            alt={photoAlt}
            fill
            className="object-cover"
            sizes="(min-width: 768px) 33vw, 100vw"
          />
        ) : (
          <figcaption className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <span className="text-mono uppercase text-ink-tertiary">
              Workspace photo. Practitioner in context.
            </span>
          </figcaption>
        )}
      </figure>
      <div className="flex flex-col gap-6">
        <header>
          <p className="text-eyebrow uppercase text-ink-subtle">{role}</p>
          <h3 className="mt-2 text-headline text-ink">{name}</h3>
        </header>
        <div className="flex flex-col gap-5 text-body-lg leading-relaxed text-ink-muted">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        {credentials.length > 0 ? (
          <ul
            aria-label="Credentials"
            className="flex flex-wrap gap-x-2 gap-y-2 pt-2"
          >
            {credentials.map((cred) => (
              <li
                key={cred}
                className="rounded-sm border border-hairline bg-surface-2 px-3 py-1 text-eyebrow uppercase text-ink-subtle"
              >
                {cred}
              </li>
            ))}
          </ul>
        ) : null}
        {socialLinks.length > 0 ? (
          <ul
            aria-label="Rob on social platforms"
            className="flex flex-col gap-2 pt-1 text-body-sm text-ink-subtle"
          >
            {socialLinks.map(({ platform, url }) => {
              const meta = PLATFORM_META[platform];
              return (
                <li key={platform}>
                  <a
                    href={url}
                    rel="me noopener"
                    target="_blank"
                    className="inline-flex items-center gap-2 transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  >
                    <span>{meta.label}</span>
                    <span aria-hidden>→</span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
