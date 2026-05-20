import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// End-of-post author bio. Lighter than PersonCard (which is the /about
// hero block). Photo + name + 1–2 paragraph bio (markdown) + optional
// LinkedIn link. Hairline-separated above and below.

export interface AuthorBioProps {
  name: string;
  bioMd: string;
  photoUrl: string | null;
  linkedinUrl: string | null;
}

export function AuthorBio({
  name,
  bioMd,
  photoUrl,
  linkedinUrl,
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
        {linkedinUrl ? (
          <a
            href={linkedinUrl}
            target="_blank"
            rel="me noopener noreferrer"
            className="inline-flex w-fit items-center text-body-sm text-primary hover:text-primary-hover"
          >
            Connect on LinkedIn →
          </a>
        ) : null}
      </div>
    </section>
  );
}
