import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadReport } from "../../../../../lib/diagnostic/report";
import { listSessionShareTokens } from "../../../../../lib/share-tokens";
import { getLeadFromCookies } from "../../../../../lib/auth-server";
import { ReportView } from "./report-view";

export const runtime = "nodejs";

// Per spec §6 the report page renders server-side. Session id comes
// from the URL.
//
// W4 Pass 1: owner-only access — the cookie set during registration
// must contain the leadId that owns this session. Mismatch / missing
// cookie returns 404 (not 401) to avoid revealing which session ids
// exist via the response code. Magic-link sign-in for return
// visitors lands in W4 Pass 2; until then, a user without a valid
// cookie can't recover access without re-running the assessment.
//
// Reports generated during W3 (before this commit) had leadId=null
// and become inaccessible after this change — expected since we
// can't establish ownership without lead data.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}): Promise<Metadata> {
  const { sessionId } = await params;
  return {
    title: "AI Readiness Assessment — Report",
    description: "Your AI Readiness Assessment report.",
    // Reports aren't public content; keep them out of search indexes
    // even though the page is server-rendered.
    robots: { index: false, follow: false },
    alternates: { canonical: `/tools/ai-readiness/report/${sessionId}` },
  };
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const report = await loadReport(sessionId);
  if (!report) {
    notFound();
  }

  // Owner-only check: cookie's leadId must match the lead who owns
  // this session. Treat missing-cookie + mismatched-cookie + missing-
  // session-leadId as 404 — silent on whether the report exists for
  // someone else. Magic-link sign-in (W4 Pass 2) gives return
  // visitors a path back; without it they can't view another user's
  // report no matter how they got the URL.
  const session = await getLeadFromCookies();
  if (
    !session ||
    !report.leadId ||
    session.leadId !== report.leadId
  ) {
    notFound();
  }

  // Load the active share tokens so the owner's ShareControls can
  // render existing links. Empty for first-time visitors to the page.
  const shareTokens = await listSessionShareTokens(sessionId);

  return (
    <ReportView
      report={report}
      viewMode="owner"
      shareTokens={shareTokens}
    />
  );
}
