"use client";

import Link from "next/link";

// Persistent top banner for the draft preview route. Client component
// so the Reload affordance can call window.location.reload() — the
// preview tab's HTML is cached from when the author first opened it,
// and after saving in the editor tab they need an explicit reload to
// see fresh content. Without this affordance, authors think their
// saves aren't landing.
//
// Plain monospace text, hard amber border, no animation. Matches the
// practitioner-led brand voice — direct, no flair.

interface PreviewBannerProps {
  postId: string;
  statusLabel: string;
}

export function PreviewBanner({ postId, statusLabel }: PreviewBannerProps) {
  return (
    <div className="sticky top-0 z-50 border-b-2 border-amber-500/60 bg-amber-500/10 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-2 md:px-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">
          Draft preview · {statusLabel}
        </p>
        <div className="flex items-center gap-x-4">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="font-mono text-[11px] text-amber-700 underline hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
            title="Fetch the latest saved state from the server"
          >
            ↻ Reload
          </button>
          <Link
            href={`/admin/blog/posts/${postId}`}
            className="font-mono text-[11px] text-amber-700 underline hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
          >
            ← Back to editor
          </Link>
        </div>
      </div>
    </div>
  );
}
