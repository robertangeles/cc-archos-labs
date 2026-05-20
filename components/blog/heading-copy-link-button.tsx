"use client";

import { useState } from "react";

// Heading copy-link button. Renders next to h2/h3 inside a post body so
// readers can grab a deep-link to a section. Uses the Web Clipboard API
// with a graceful fallback when the API is unavailable (older browsers,
// non-HTTPS contexts).

export interface HeadingCopyLinkButtonProps {
  /** The anchor ID (e.g. "the-archos-labs-framework"). */
  id: string;
}

export function HeadingCopyLinkButton({ id }: HeadingCopyLinkButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function onClick() {
    try {
      const url = new URL(window.location.href);
      url.hash = id;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url.toString());
        setState("copied");
        setTimeout(() => setState("idle"), 1600);
        return;
      }
      // Older-browser fallback: still update the URL hash so the user
      // can copy from the address bar.
      window.history.replaceState(null, "", `#${id}`);
      setState("copied");
      setTimeout(() => setState("idle"), 1600);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 1600);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Copy link to ${id.replace(/-/g, " ")}`}
      className="ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-tertiary opacity-0 transition-opacity duration-150 hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
    >
      {state === "copied" ? (
        <svg
          className="h-4 w-4 text-semantic-success"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.4 7.4a1 1 0 0 1-1.4 0L3.3 9.5a1 1 0 1 1 1.4-1.4l3.9 3.9 6.7-6.7a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg
          className="h-4 w-4"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden
        >
          <path d="M9 11a3 3 0 0 1 0-4l3-3a3 3 0 0 1 4 4l-1 1" strokeLinecap="round" />
          <path d="M11 9a3 3 0 0 1 0 4l-3 3a3 3 0 0 1-4-4l1-1" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
