"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Finding } from "@/lib/watermark-finding";
import { FINDING_EXPLANATIONS } from "./explanations";

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function FindingRow({ finding }: { finding: Finding }) {
  const [expanded, setExpanded] = useState(false);
  const explainId = useId();
  const explanation = FINDING_EXPLANATIONS[finding.id];

  return (
    <li className="border-b border-hairline py-3 last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={explainId}
        className="flex w-full items-center justify-between gap-x-3 text-left"
      >
        <span className="flex min-w-0 items-baseline gap-x-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="text-body-sm font-medium text-ink">{finding.label}</span>
          {finding.detail ? (
            <span className="text-body-sm text-ink-subtle">— {finding.detail}</span>
          ) : null}
        </span>
        {explanation ? (
          <span className="shrink-0 text-caption text-ink-subtle">
            {expanded ? "Hide" : "What's this?"}
          </span>
        ) : null}
      </button>
      {expanded && explanation ? (
        <p id={explainId} className="mt-2 pl-3.5 text-body-sm text-ink-subtle">
          {explanation}
        </p>
      ) : null}
    </li>
  );
}

export interface ResultsPanelProps {
  headline: string;
  subtext: string;
  findings: Finding[];
  partial: boolean;
  partialReason?: string;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  removalLog: unknown;
  removalLogFilename: string;
  imagePreviewUrl?: string;
}

// Primary = this findings list. Explain panel is on-demand per finding.
// Removal log download is one secondary link, not a competing block
// (Eng Review Findings: results-screen hierarchy).
export function ResultsPanel({
  headline,
  subtext,
  findings,
  partial,
  partialReason,
  primaryActionLabel,
  onPrimaryAction,
  removalLog,
  removalLogFilename,
  imagePreviewUrl,
}: ResultsPanelProps) {
  return (
    <div
      className="rounded-lg border border-hairline bg-surface-1 p-6"
      aria-live="polite"
      role="status"
    >
      {imagePreviewUrl ? (
        // Also the mobile long-press-save fallback — iOS Safari's download
        // attribute can silently fail, so the result stays visible and
        // directly saveable (Eng Review Findings: copy/download handlers).
        // Plain <img>, not next/image: this is a client-generated blob: URL,
        // not a static/remote asset — there's nothing for the image
        // optimizer to do with it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imagePreviewUrl}
          alt="Cleaned photo"
          className="mb-4 max-h-64 rounded-md border border-hairline object-contain"
        />
      ) : null}

      <h2 className="text-card-title text-ink">{headline}</h2>
      <p className="mt-1 text-body-sm text-ink-subtle">{subtext}</p>

      {partial && partialReason ? (
        <p className="mt-3 rounded-md border border-semantic-warning/40 bg-semantic-warning/10 px-3 py-2 text-body-sm text-semantic-warning">
          {partialReason}
        </p>
      ) : null}

      {findings.length > 0 ? (
        <ul className="mt-4 border-t border-hairline">
          {findings.map((f) => (
            <FindingRow key={f.id} finding={f} />
          ))}
        </ul>
      ) : null}

      {findings.length > 0 ? (
        <button
          type="button"
          onClick={() => downloadJson(removalLog, removalLogFilename)}
          className="mt-4 text-body-sm text-primary underline underline-offset-2 transition-colors duration-150 hover:text-primary-hover"
        >
          Download removal log (.json)
        </button>
      ) : null}

      <div className="mt-5">
        <Button onClick={onPrimaryAction}>{primaryActionLabel}</Button>
      </div>
    </div>
  );
}
