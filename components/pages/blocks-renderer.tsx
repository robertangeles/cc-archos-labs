// BlocksRenderer — server component that renders an ordered list of
// page_block rows for a composed page. The catch-all delegates to this
// when page.template === 'composed'.
//
// Defense-in-depth render path:
//   1. Iterate blocks in position order
//   2. For each block: validate props against the registry's Zod schema
//      via safeParseBlockProps (never throws)
//   3. Map block_type → block adapter component via BLOCK_COMPONENTS
//   4. Wrap each block in BlockErrorBoundary so an exception inside an
//      adapter (e.g. an unexpected runtime nil) shows a placeholder
//      instead of killing the entire page render
//
// What the public sees if a block fails:
//   - Unknown block_type      → small grey placeholder ("[unknown block]")
//   - Invalid props           → small grey placeholder ("[invalid block props]")
//   - Adapter component throws → BlockErrorBoundary catches → placeholder
//
// What the admin preview sees (preview === true):
//   - Same placeholder + a small inline error message so the author
//     knows which block to fix. Logged at warn level.

import type { PageBlock } from "../../lib/db/schema";
import {
  BLOCK_REGISTRY,
  isKnownBlockType,
  safeParseBlockProps,
} from "../../lib/pages/blocks/registry";
import { BlockErrorBoundary } from "./block-error-boundary";
import { HeroBlock } from "./blocks/hero-block";
import { ProofGridBlock } from "./blocks/proof-grid-block";
import { ServiceGridBlock } from "./blocks/service-grid-block";
import { CtaPairBlock } from "./blocks/cta-pair-block";
import { MarkdownBlock } from "./blocks/markdown-block";

// Map block_type → adapter component. Keep this aligned with
// BLOCK_REGISTRY in lib/pages/blocks/registry.ts — adding a block_type
// requires updating both. Mismatch is caught by the registry test.
const BLOCK_COMPONENTS: Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (props: any) => React.ReactNode
> = {
  hero: HeroBlock,
  proof_grid: ProofGridBlock,
  service_grid: ServiceGridBlock,
  cta_pair: CtaPairBlock,
  markdown: MarkdownBlock,
};

export interface BlocksRendererProps {
  blocks: PageBlock[];
  /** When true, render failures show a visible error message above the
   *  placeholder for admin debugging. Production traffic passes false. */
  preview?: boolean;
}

export function BlocksRenderer({ blocks, preview }: BlocksRendererProps) {
  if (blocks.length === 0) {
    if (preview) {
      return (
        <EmptyState message="This page has no blocks yet. Add one from the admin editor to see it here." />
      );
    }
    return null;
  }

  // Render in position order. The query upstream already sorts ASC by
  // position, but we don't trust input — sort again here.
  const ordered = [...blocks].sort((a, b) => a.position - b.position);

  return (
    <>
      {ordered.map((block) => (
        <BlockErrorBoundary key={block.id} preview={preview}>
          <SingleBlock block={block} preview={preview} />
        </BlockErrorBoundary>
      ))}
    </>
  );
}

function SingleBlock({
  block,
  preview,
}: {
  block: PageBlock;
  preview?: boolean;
}) {
  if (!isKnownBlockType(block.blockType)) {
    return (
      <Placeholder
        label={`unknown block type: ${block.blockType}`}
        preview={preview}
      />
    );
  }
  const parsed = safeParseBlockProps(block.blockType, block.props);
  if (!parsed.ok) {
    return (
      <Placeholder
        label={`invalid props on ${block.blockType}: ${parsed.error}`}
        preview={preview}
      />
    );
  }
  const Component = BLOCK_COMPONENTS[block.blockType];
  if (!Component) {
    // Registry has the type but no component — registry/renderer drift.
    // Caught by the registry test in normal flow; fail-safe here.
    return (
      <Placeholder
        label={`no render component registered for ${block.blockType}`}
        preview={preview}
      />
    );
  }
  return <Component {...(parsed.value as object)} />;
}

function Placeholder({
  label,
  preview,
}: {
  label: string;
  preview?: boolean;
}) {
  if (!preview) {
    // Public visitor: minimal placeholder so layout doesn't shift, but
    // no leaking internals. Author-facing only.
    return (
      <div className="mx-auto max-w-[1080px] px-6 py-12 md:px-12">
        <div className="rounded-md border border-hairline bg-surface-1 p-6 text-center text-sm text-ink-tertiary">
          [block unavailable]
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[1080px] px-6 py-12 md:px-12">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-800 dark:text-amber-200">
        <p className="font-semibold">Block render failed</p>
        <p className="mt-1 break-words font-mono text-[12px]">{label}</p>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-[1080px] px-6 py-32 md:px-12">
      <div className="rounded-md border border-hairline bg-surface-1 p-12 text-center text-ink-tertiary">
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
}

// Convenience export so the catch-all + admin preview can introspect
// what block_types are available without importing the registry.
export const RENDERABLE_BLOCK_TYPES = Object.keys(BLOCK_REGISTRY);
