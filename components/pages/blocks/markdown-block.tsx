import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Section } from "../../sections/home/section";
import type { MarkdownBlockProps } from "../../../lib/pages/blocks/schemas";

// Markdown block — free-form prose between section blocks.
//
// Typography matches the HOME PAGE Section pattern (h2 text-display-md
// ink, body text-body-lg ink-subtle) so composed pages don't diverge
// from the visual standard the home page already set.
//
// XSS posture: react-markdown default config + remark-gfm only. No
// rehype-raw — same defense as MarkdownArticle.

export function MarkdownBlock(props: MarkdownBlockProps) {
  return (
    <Section bg="canvas">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ node: _n, ...rest }) => (
            <h2 className="text-display-md text-ink" {...rest} />
          ),
          h3: ({ node: _n, ...rest }) => (
            <h3 className="mt-12 text-headline text-ink" {...rest} />
          ),
          p: ({ node: _n, ...rest }) => (
            <p className="mt-6 text-body-lg text-ink-subtle" {...rest} />
          ),
          ul: ({ node: _n, ...rest }) => (
            <ul
              className="mt-6 space-y-3 text-body-lg text-ink-subtle [&>li]:list-disc [&>li]:ml-6"
              {...rest}
            />
          ),
          ol: ({ node: _n, ...rest }) => (
            <ol
              className="mt-6 space-y-3 text-body-lg text-ink-subtle [&>li]:list-decimal [&>li]:ml-6"
              {...rest}
            />
          ),
          li: ({ node: _n, ...rest }) => <li {...rest} />,
          strong: ({ node: _n, ...rest }) => (
            <strong className="font-semibold text-ink" {...rest} />
          ),
          em: ({ node: _n, ...rest }) => (
            <em className="italic text-ink" {...rest} />
          ),
          a: ({ node: _n, href, children, ...rest }) => {
            const isExternal = /^https?:\/\//i.test(href ?? "");
            return (
              <a
                href={href}
                className="text-primary hover:underline"
                {...(isExternal
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                {...rest}
              >
                {children}
              </a>
            );
          },
          hr: () => <hr className="my-12 border-0 border-t border-hairline" />,
        }}
      >
        {props.content}
      </ReactMarkdown>
    </Section>
  );
}
