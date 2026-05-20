import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { HeadingCopyLinkButton } from "./heading-copy-link-button";

// Renders a post body's markdown content. Mirrors the security posture
// of components/pages/markdown-article.tsx — react-markdown default
// rejects raw HTML, no rehype-raw — so embedded HTML in WP-migrated
// posts is stripped. The XSS regression test pattern from
// markdown-article.test.tsx applies here too.
//
// Difference from MarkdownArticle:
//   - Adds rehype-slug so h2/h3 get id="..." attributes for TOC anchors
//   - Heading renderer emits a HeadingCopyLinkButton next to every h2/h3
//   - No page-level <h1> / last-updated row — those live in PostHeader
//
// Server component (no use client). HeadingCopyLinkButton is the only
// client-bounded element inside; React serialises it across the
// boundary as a regular child component.

export interface PostBodyProps {
  contentMd: string;
}

export function PostBody({ contentMd }: PostBodyProps) {
  return (
    <div className="markdown-body text-base leading-[1.7] text-ink-subtle">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={{
          h2: ({ node: _n, id, children, ...rest }) => (
            <h2
              id={id}
              className="group mt-16 flex items-center text-2xl font-semibold tracking-[-0.01em] text-ink"
              {...rest}
            >
              <span>{children}</span>
              {id ? <HeadingCopyLinkButton id={String(id)} /> : null}
            </h2>
          ),
          h3: ({ node: _n, id, children, ...rest }) => (
            <h3
              id={id}
              className="group mt-12 flex items-center text-xl font-semibold tracking-[-0.01em] text-ink"
              {...rest}
            >
              <span>{children}</span>
              {id ? <HeadingCopyLinkButton id={String(id)} /> : null}
            </h3>
          ),
          p: ({ node: _n, ...rest }) => (
            <p className="mt-4 text-base leading-[1.7] text-ink-subtle" {...rest} />
          ),
          ul: ({ node: _n, ...rest }) => (
            <ul
              className="mt-6 space-y-3 text-base leading-[1.7] text-ink-subtle [&>li]:list-disc [&>li]:ml-6"
              {...rest}
            />
          ),
          ol: ({ node: _n, ...rest }) => (
            <ol
              className="mt-6 space-y-3 text-base leading-[1.7] text-ink-subtle [&>li]:list-decimal [&>li]:ml-6"
              {...rest}
            />
          ),
          li: ({ node: _n, ...rest }) => (
            <li className="text-base leading-[1.7]" {...rest} />
          ),
          strong: ({ node: _n, ...rest }) => (
            <strong className="font-semibold text-ink" {...rest} />
          ),
          em: ({ node: _n, ...rest }) => (
            <em className="italic text-ink" {...rest} />
          ),
          a: ({ node: _n, ...rest }) => <SafeLink {...rest} />,
          hr: () => <hr className="my-12 border-0 border-t border-hairline" />,
          table: ({ node: _n, ...rest }) => (
            <div className="mt-8 overflow-x-auto">
              <table
                className="w-full border-collapse text-left text-sm"
                {...rest}
              />
            </div>
          ),
          thead: ({ node: _n, ...rest }) => (
            <thead className="border-b border-hairline text-ink" {...rest} />
          ),
          th: ({ node: _n, ...rest }) => (
            <th className="px-3 py-2 text-left font-semibold" {...rest} />
          ),
          td: ({ node: _n, ...rest }) => (
            <td
              className="border-t border-hairline px-3 py-2 align-top text-ink-subtle"
              {...rest}
            />
          ),
          code: ({ node: _n, ...rest }) => (
            <code
              className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.95em] text-ink"
              {...rest}
            />
          ),
          pre: ({ node: _n, ...rest }) => (
            <pre
              className="mt-6 overflow-x-auto rounded-md border border-hairline bg-surface-1 p-4 font-mono text-sm leading-[1.6] text-ink"
              {...rest}
            />
          ),
          blockquote: ({ node: _n, children, ...rest }) => (
            <PullQuote {...rest}>{children}</PullQuote>
          ),
          img: ({ node: _n, alt, src, ...rest }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={alt ?? ""}
              src={typeof src === "string" ? src : ""}
              loading="lazy"
              className="my-8 w-full rounded-lg border border-hairline"
              {...rest}
            />
          ),
        }}
      >
        {contentMd}
      </ReactMarkdown>
    </div>
  );
}

function PullQuote({ children, ...rest }: { children: ReactNode }) {
  return (
    <blockquote
      className="my-10 border-l-2 border-primary pl-6 text-card-title italic text-ink"
      {...rest}
    >
      {children}
    </blockquote>
  );
}

function SafeLink({ href, children, ...rest }: ComponentPropsWithoutRef<"a">) {
  const url = href ?? "";
  const isExternal = /^https?:\/\//i.test(url);
  const isInternalPath = url.startsWith("/") && !url.startsWith("//");
  if (isInternalPath) {
    return (
      <Link href={url} className="text-primary hover:underline" {...rest}>
        {children}
      </Link>
    );
  }
  if (isExternal) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline"
        {...rest}
      >
        {children}
      </a>
    );
  }
  return (
    <a href={url} className="text-primary hover:underline" {...rest}>
      {children}
    </a>
  );
}
