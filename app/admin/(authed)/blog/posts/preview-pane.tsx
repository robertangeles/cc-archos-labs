"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Client-side markdown preview for the editor. Mirrors components/blog/
// post-body.tsx's renderer + token classes so what the author sees here
// is what readers see on /blog/[slug] — minus rehype-slug + copy-link
// buttons (admin only, no need for anchor IDs in the preview).
//
// Same XSS posture as PostBody: no rehype-raw → raw HTML is stripped.

interface PreviewPaneProps {
  content: string;
}

export function PreviewPane({ content }: PreviewPaneProps) {
  if (!content.trim()) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-ink-subtle">
        Start writing to see the preview.
      </div>
    );
  }
  return (
    <div className="markdown-body p-6 text-base leading-[1.7] text-ink-subtle">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node: _n, ...rest }) => (
            <h1
              className="mt-8 text-3xl font-semibold tracking-[-0.01em] text-ink first:mt-0"
              {...rest}
            />
          ),
          h2: ({ node: _n, ...rest }) => (
            <h2
              className="mt-12 text-2xl font-semibold tracking-[-0.01em] text-ink first:mt-0"
              {...rest}
            />
          ),
          h3: ({ node: _n, ...rest }) => (
            <h3
              className="mt-10 text-xl font-semibold tracking-[-0.01em] text-ink"
              {...rest}
            />
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
          strong: ({ node: _n, ...rest }) => (
            <strong className="font-semibold text-ink" {...rest} />
          ),
          em: ({ node: _n, ...rest }) => (
            <em className="italic text-ink" {...rest} />
          ),
          a: ({ node: _n, href, ...rest }) => (
            <a
              href={href ?? ""}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
              className="text-primary hover:underline"
              {...rest}
            />
          ),
          hr: () => <hr className="my-10 border-0 border-t border-hairline" />,
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
          blockquote: ({ node: _n, ...rest }) => (
            <blockquote
              className="my-8 border-l-2 border-primary pl-6 italic text-ink"
              {...rest}
            />
          ),
          img: ({ node: _n, alt, src, ...rest }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={alt ?? ""}
              src={typeof src === "string" ? src : ""}
              loading="lazy"
              className="my-6 w-full rounded-lg border border-hairline"
              {...rest}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
