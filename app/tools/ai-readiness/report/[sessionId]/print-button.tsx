"use client";

import { useState } from "react";

// "Download PDF" call-to-action on the report.
//
// Owner sessions hit the server-side Puppeteer endpoint
// (/api/diagnostic/report/[sessionId]/pdf) — branded, no browser chrome,
// guaranteed identical across Chrome/Safari/Firefox. 5-10 second wait.
//
// Shared-view recipients (sessionId not threaded through) fall back to
// window.print() which uses the CSS print stylesheet in globals.css.
// Same on-screen-when-printing layout, but they pick "Save as PDF" from
// their browser's print dialog.

type Status = "idle" | "generating" | "error";

export function PrintButton({ sessionId }: { sessionId?: string }) {
  const [status, setStatus] = useState<Status>("idle");

  async function downloadServerPdf() {
    if (!sessionId || status === "generating") return;
    setStatus("generating");
    try {
      const res = await fetch(
        `/api/diagnostic/report/${sessionId}/pdf`,
      );
      if (!res.ok) {
        throw new Error(`PDF endpoint returned ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-readiness-report-${sessionId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the browser a tick before revoking the URL or some
      // browsers cancel the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("idle");
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  }

  // Shared view doesn't have a sessionId (recipient isn't authed for
  // the PDF endpoint). Fall back to the browser print dialog — the CSS
  // print stylesheet handles the rest.
  if (!sessionId) {
    return (
      <button
        type="button"
        onClick={() => window.print()}
        className={baseClass}
        aria-label="Print or save as PDF"
      >
        <PrinterIcon />
        Print or save as PDF
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-y-1.5 print:hidden">
      <button
        type="button"
        onClick={downloadServerPdf}
        disabled={status === "generating"}
        className={baseClass}
        aria-label="Download branded PDF"
      >
        <PrinterIcon />
        {status === "generating" ? "Generating PDF…" : "Download PDF"}
      </button>
      {status === "error" ? (
        <p role="alert" className="text-xs leading-[1.5] text-semantic-error">
          Couldn&rsquo;t generate the PDF.{" "}
          <button
            type="button"
            onClick={() => window.print()}
            className="underline decoration-semantic-error/40 underline-offset-2 hover:decoration-semantic-error"
          >
            Use the browser print dialog instead
          </button>
          .
        </p>
      ) : null}
    </div>
  );
}

const baseClass =
  "inline-flex items-center gap-x-2 rounded-md border border-hairline bg-surface-1 px-4 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:border-primary/60 hover:text-primary disabled:cursor-default disabled:opacity-70 print:hidden";

function PrinterIcon() {
  return (
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
  );
}
