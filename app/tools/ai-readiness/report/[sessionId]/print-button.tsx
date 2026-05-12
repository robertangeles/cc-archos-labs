"use client";

// "Download PDF" call-to-action on the report. Uses the browser's native
// print dialog with `window.print()` — the print stylesheet in globals.css
// reshapes the dark report into a light, paged document. The user picks
// "Save as PDF" in their print destination dropdown.
//
// Server-side Puppeteer (spec §8.2 / backlog item 23) is the polish step
// that gives us a branded multi-page PDF the user gets via a one-click
// download. This client-side path is the MVP — ships in minutes and
// covers the 80% case (forward report to CFO/leadership).

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-x-2 rounded-md border border-rule bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-150 hover:border-accent/60 hover:text-accent print:hidden"
      aria-label="Print or save as PDF"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-4 w-4"
      >
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
      Download PDF
    </button>
  );
}
