import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadReport } from "../../../../../lib/diagnostic/report";
import { ReportView } from "./report-view";

export const runtime = "nodejs";

// Per spec §6 the report page renders server-side. session id comes
// from the URL. For W3 there's no auth check yet — anyone with the id
// can view (sessions ids are random UUIDs, not enumerable). W4 adds
// owner-only access via the registration gate.

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
  return <ReportView report={report} />;
}
