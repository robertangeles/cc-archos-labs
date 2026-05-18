// Person section card — photo slot + name/role + bio paragraphs +
// credentials chip row + social icon row.
//
// Composition: photo on the left (md+), bio on the right. Stacks on
// mobile. The photo slot is intentionally placeholder-tolerant: when
// `photoSrc` is null, a hairline-outlined figure renders with a
// single-line mono caption signalling intent. Photo lands later as a
// one-line config change without touching layout.
//
// rel="me noopener" on outbound links: `me` reinforces Person identity
// for verification (Mastodon/IndieAuth pattern) and aligns with the
// Schema.org Person `sameAs` payload; `noopener` blocks the reverse-tab
// vector.

import Image from "next/image";
import type { ComponentType, SVGProps } from "react";
import {
  GithubIcon,
  HuggingFaceIcon,
  LinkedinIcon,
  XIcon,
} from "../../icons/social";

export type SocialPlatform = "linkedin" | "x" | "github" | "huggingface";

export type SocialLink = {
  platform: SocialPlatform;
  url: string;
};

const PLATFORM_META: Record<
  SocialPlatform,
  { label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  linkedin: { label: "LinkedIn", Icon: LinkedinIcon },
  x: { label: "X", Icon: XIcon },
  github: { label: "GitHub", Icon: GithubIcon },
  huggingface: { label: "Hugging Face", Icon: HuggingFaceIcon },
};

export type PersonCardProps = {
  name: string;
  role: string;
  paragraphs: string[];
  credentials: string[];
  photoSrc: string | null;
  photoAlt?: string;
  /** Social-platform identity links rendered as an icon row below the
   *  credentials chips. Each entry contributes one anchor with an
   *  aria-label derived from the platform. Empty array hides the row. */
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
      <figure className="relative aspect-[4/5] overflow-hidden rounded-lg border border-hairline bg-surface-1">
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
      <div className="flex flex-col gap-5">
        <header>
          <h3 className="text-headline text-ink">{name}</h3>
          <p className="mt-1 text-body text-ink-subtle">{role}</p>
        </header>
        <div className="flex flex-col gap-5 text-body-lg text-ink-subtle">
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
                className="rounded-full border border-hairline px-3 py-1 text-eyebrow uppercase text-ink-subtle"
              >
                {cred}
              </li>
            ))}
          </ul>
        ) : null}
        {socialLinks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
            <span className="text-body text-ink-subtle">Find Rob</span>
            <ul
              className="flex items-center gap-x-1"
              aria-label="Rob on social platforms"
            >
              {socialLinks.map(({ platform, url }) => {
                const meta = PLATFORM_META[platform];
                const Icon = meta.Icon;
                return (
                  <li key={platform}>
                    <a
                      href={url}
                      rel="me noopener"
                      target="_blank"
                      aria-label={meta.label}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-surface-1 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                    >
                      <Icon className="h-5 w-5" aria-hidden />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </article>
  );
}
