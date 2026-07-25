import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PLATFORM_META, type SocialLink } from "../../lib/social-links";

// End-of-post author bio. Lighter than PersonCard (which is the /about
// hero block). Photo + name + 1–2 paragraph bio (markdown) + social
// icon row matching the /about page (LinkedIn / X / GitHub / Hugging
// Face). Hairline-separated above and below.

export interface AuthorBioProps {
  name: string;
  bioMd: string;
  photoUrl: string | null;
  /**
   * Founder identity links — same shape PersonCard consumes. Pass an
   * empty array to hide the row. Order is preserved; renderer iterates
   * in supplied order. See [[social-links]] for the canonical source.
   */
  socialLinks: SocialLink[];
}

export function AuthorBio({
  name,
  bioMd,
  photoUrl,
  socialLinks,
}: AuthorBioProps) {
  const hasBio = bioMd.trim().length > 0;
  return (
    <section
      aria-label={`About ${name}`}
      className="mt-20 grid gap-8 border-t border-hairline pt-10 md:grid-cols-[auto_1fr] md:gap-12"
    >
      <figure className="relative h-24 w-24 overflow-hidden rounded-full border border-hairline bg-surface-1 md:h-32 md:w-32">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={name}
            fill
            sizes="128px"
            className="object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-headline text-ink-subtle">
            {name.charAt(0)}
          </span>
        )}
      </figure>
      <div className="flex flex-col gap-3">
        <p className="text-eyebrow uppercase tracking-[0.08em] text-ink-subtle">
          Written by
        </p>
        <h2 className="text-headline text-ink">{name}</h2>
        {hasBio ? (
          <div className="markdown-body text-body-sm leading-[1.7] text-ink-subtle">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{bioMd}</ReactMarkdown>
          </div>
        ) : null}
        {socialLinks.length > 0 ? (
          <>
            {/* Labelled because the byline is Metis but the accounts are
                the studio's — without this the icons read as hers. */}
            <p className="mt-2 text-eyebrow uppercase tracking-[0.08em] text-ink-subtle">
              Follow Archos Labs
            </p>
            <ul
              className="flex items-center gap-x-1"
              aria-label="Archos Labs on social platforms"
            >
              {socialLinks.map(({ platform, url }) => {
                const meta = PLATFORM_META[platform];
                const Icon = meta.Icon;
                return (
                  <li key={platform}>
                    <a
                      href={url}
                      rel="me noopener noreferrer"
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
          </>
        ) : null}
      </div>
    </section>
  );
}
