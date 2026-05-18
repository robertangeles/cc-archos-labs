// Renders a Pages-CMS page body as a long-form article. Mirrors the
// typography of the legacy hand-coded /privacy and /terms pages exactly
// so the cutover is visually invisible.
//
// Security posture (load-bearing):
//   - react-markdown default config rejects raw HTML in source
//   - NO rehype-raw — adding it would re-introduce the XSS vector the
//     XSS regression test (markdown-article.test.tsx) guards against
//   - remark-gfm enables tables + footnotes (Privacy uses a third-party
//     processor table; Terms uses bulleted clauses)
//   - Custom link renderer adds rel="noopener noreferrer" + target="_blank"
//     on external links; internal links route via next/link transparently
//
// Phase 1 caps at the long_form template. Phase 2 introduces composed
// pages (section blocks) which render via a different component
// (BlocksRenderer), not via this one.

import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PublishedPageView } from "../../lib/pages/types";

export interface MarkdownArticleProps {
  page: PublishedPageView;
  /** When true, shows a "Draft preview" banner above the body. */
  preview?: boolean;
}

export function MarkdownArticle({ page, preview }: MarkdownArticleProps) {
  const lastUpdated = formatIsoDate(
    page.lastReviewedAt ?? page.updatedAt,
  );
  // The component renders the page title as <h1> from page.title above
  // the body. Markdown content that ALSO starts with `# Title` (common
  // when an author pastes from a styled doc) would stack a second H1.
  // Strip the leading `# Heading` line before handing to ReactMarkdown
  // so the component is the single source of truth for the page title.
  const body = stripLeadingH1(page.contentMd);
  return (
    <main className="flex flex-1 flex-col bg-canvas">
      {preview ? (
        <div className="bg-amber-500/10 px-6 py-2 text-center text-sm text-amber-700 dark:text-amber-300">
          Draft preview — not visible to the public.
        </div>
      ) : null}
      <article className="mx-auto w-full max-w-[760px] px-6 pt-24 pb-32 md:px-12">
        <h1 className="text-display-md text-ink md:text-display-lg">
          {page.title}
        </h1>
        <p className="mt-6 text-[18px] leading-[1.6] text-ink-subtle">
          Last updated{" "}
          <time dateTime={lastUpdated}>{lastUpdated}</time>.
        </p>

        <div className="markdown-body mt-12 text-base leading-[1.7] text-ink-subtle">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            // Override default renderers so the output matches the
            // legacy /privacy + /terms typography token-for-token.
            //
            // Every override destructures `node` OUT of the spread so
            // it never lands on the DOM element. react-markdown passes
            // its internal MDAST AST node as a `node` prop, and React
            // will stringify it to `node="[object Object]"` if spread.
            components={{
              h1: ({ node: _n, ...rest }) => (
                <h1
                  className="mt-16 text-display-md text-ink md:text-display-lg"
                  {...rest}
                />
              ),
              h2: ({ node: _n, ...rest }) => (
                <h2
                  className="mt-16 text-2xl font-semibold tracking-[-0.01em] text-ink"
                  {...rest}
                />
              ),
              h3: ({ node: _n, ...rest }) => (
                <h3
                  className="mt-12 text-xl font-semibold tracking-[-0.01em] text-ink"
                  {...rest}
                />
              ),
              p: ({ node: _n, ...rest }) => (
                <p
                  className="mt-4 text-base leading-[1.7] text-ink-subtle"
                  {...rest}
                />
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
              hr: () => (
                <hr className="my-12 border-0 border-t border-hairline" />
              ),
              table: ({ node: _n, ...rest }) => (
                <div className="mt-8 overflow-x-auto">
                  <table
                    className="w-full border-collapse text-left text-sm"
                    {...rest}
                  />
                </div>
              ),
              thead: ({ node: _n, ...rest }) => (
                <thead
                  className="border-b border-hairline text-ink"
                  {...rest}
                />
              ),
              th: ({ node: _n, ...rest }) => (
                <th
                  className="px-3 py-2 text-left font-semibold"
                  {...rest}
                />
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
              blockquote: ({ node: _n, ...rest }) => (
                <blockquote
                  className="my-6 border-l-2 border-hairline pl-4 italic text-ink-subtle"
                  {...rest}
                />
              ),
            }}
          >
            {body}
          </ReactMarkdown>
        </div>
      </article>
    </main>
  );
}

// External links get rel="noopener noreferrer" + target="_blank".
// Internal links (start with / or #) route via next/link so client-side
// nav stays fast. mailto:/tel:/fragment links fall through to a plain
// anchor (no target=_blank).
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
  // Mailto, tel:, fragment-only, or anything else — render as a plain
  // anchor without target/rel. react-markdown already strips javascript:
  // and data: URLs as part of its default link sanitizer.
  return (
    <a href={url} className="text-primary hover:underline" {...rest}>
      {children}
    </a>
  );
}

function formatIsoDate(d: Date): string {
  // YYYY-MM-DD — what the legacy pages use, matches the <time datetime>
  // attribute convention.
  return d.toISOString().slice(0, 10);
}

/**
 * Remove a single leading `# Heading` line (with optional surrounding
 * blank lines). The component renders `page.title` as the canonical H1
 * above the body, so a duplicate H1 inside the markdown stacks visibly.
 * Authors can paste markdown from external sources without worrying
 * whether it starts with a heading — we always render one H1.
 *
 * Idempotent on content that doesn't start with `#`. Only strips the
 * FIRST h1 — subsequent h1s are unusual but technically allowed; an
 * author who writes two h1s in the body has bigger problems.
 */
export function stripLeadingH1(md: string): string {
  return md.replace(/^[\s\n]*#\s+[^\n]+\n+/, "");
}
