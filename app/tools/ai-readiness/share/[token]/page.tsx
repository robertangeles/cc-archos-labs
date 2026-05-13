import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadReport } from "../../../../../lib/diagnostic/report";
import { verifyShareToken } from "../../../../../lib/share-tokens";
import { ReportView } from "../../report/[sessionId]/report-view";

export const runtime = "nodejs";

// Public share view of a report. The raw token in the URL is the
// authorisation — no cookie needed. C-2 design (locked 2026-05-13):
//   - 7-day TTL (enforced in verifyShareToken's WHERE clause)
//   - "One consume, re-views OK": consumed_at stamps on first hit;
//     subsequent visits to the same URL still render until expiry or
//     revocation.
//   - Many tokens per report supported; each independently revocable.
//
// noindex + nofollow set via metadata so even if the link leaks to a
// crawler, it doesn't end up in a search index.

export const metadata: Metadata = {
  title: "AI Readiness Assessment — Shared report",
  description: "A shared AI Readiness Assessment report.",
  robots: { index: false, follow: false },
};

export default async function SharedReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const verified = await verifyShareToken(token);
  if (!verified) {
    // Generic 404 for any failure mode (not found / expired / revoked).
    // Silent — don't tell the visitor which path they failed on.
    notFound();
  }

  const report = await loadReport(verified.assessmentSessionId);
  if (!report) {
    // Edge: token row exists but session is gone (cascade delete races).
    notFound();
  }

  return <ReportView report={report} viewMode="shared" />;
}
