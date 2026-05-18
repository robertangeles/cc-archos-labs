"use client";

import { Component, type ReactNode } from "react";

// Per-block error boundary. Wraps a single block render so a thrown
// exception inside the adapter (or any of its children) is caught and
// shown as a placeholder — the rest of the page still renders.
//
// React server components don't run client-side error boundaries on
// the server pass; this is a client component intentionally, so a
// hydration-time throw is also caught. The server pass falls back to
// rendering the children directly (no boundary), but the schema
// validation upstream (safeParseBlockProps in BlocksRenderer) already
// catches the bad-props class of failure server-side. This boundary
// catches the remainder: runtime throws inside the adapter component
// or its render tree.

interface BlockErrorBoundaryProps {
  children: ReactNode;
  preview?: boolean;
}

interface BlockErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class BlockErrorBoundary extends Component<
  BlockErrorBoundaryProps,
  BlockErrorBoundaryState
> {
  state: BlockErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): BlockErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown): void {
    // Don't propagate — boundary catches. Log so observability still sees it.
    // Production logging hooks (Sentry, etc.) are out of scope for Phase 2.
    console.error("[BlockErrorBoundary] block render threw:", error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (!this.props.preview) {
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
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-6 text-sm text-red-800 dark:text-red-200">
            <p className="font-semibold">Block crashed at render time</p>
            <p className="mt-1 break-words font-mono text-[12px]">
              {this.state.message}
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
