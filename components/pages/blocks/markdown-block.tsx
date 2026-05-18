import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Section } from "../../sections/home/section";
import type { MarkdownBlockProps } from "../../../lib/pages/blocks/schemas";

// Markdown block — free-form prose between section blocks. Uses the
// SAME react-markdown + remark-gfm configuration as MarkdownArticle
// (NO rehype-raw), so the XSS posture is identical: raw HTML in source
// renders as escaped text, never executes.
//
// Width-constrained to the long-form reading column (max-w-[760px])
// so paragraphs inside a composed marketing page remain readable.

export function MarkdownBlock(props: MarkdownBlockProps) {
  return (
    <Section bg="canvas" pad="tight">
      <div className="mx-auto max-w-[760px] text-base leading-[1.7] text-ink-subtle">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h2: ({ node: _n, ...rest }) => (
              <h2
                className="mt-12 text-2xl font-semibold tracking-[-0.01em] text-ink"
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
            hr: () => (
              <hr className="my-12 border-0 border-t border-hairline" />
            ),
          }}
        >
          {props.content}
        </ReactMarkdown>
      </div>
    </Section>
  );
}
