import type { Metadata } from "next";
import { buildPageMetadata } from "../../../lib/site-config";
import { getDiagnosticContent } from "../../../lib/diagnostic/content-config";
import { loadUserPortalData } from "../../../lib/diagnostic/report";
import { getCurrentUser } from "../../../lib/auth/current-user";
import { Assessment } from "./assessment";
import { PortalView } from "./portal-view";

export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  // Title distinct from the /ai-readiness-assessment landing page (which owns
  // the "AI Readiness Assessment" head term) so the two don't compete as
  // duplicates — this is the transactional "start the tool" surface.
  return buildPageMetadata({
    title: "Start the AI Readiness Assessment",
    description:
      "Twelve questions. About eight minutes. A practitioner-written report on where your data foundation sits and what will catch you at scale.",
    path: "/tools/ai-readiness",
  });
}

export default async function AIReadinessAssessmentPage({
  searchParams,
}: {
  searchParams: Promise<{ retake?: string }>;
}) {
  const { retake } = await searchParams;
  const content = await getDiagnosticContent();

  const auth = await getCurrentUser();
  if (auth && retake !== "1") {
    const portal = await loadUserPortalData(auth.user.id);
    if (portal && portal.reports.length > 0) {
      return <PortalView data={portal} />;
    }
  }

  const user = auth
    ? { email: auth.user.email, displayName: auth.user.displayName }
    : null;

  return <Assessment content={content} authenticatedUser={user} />;
}
