import type { Metadata } from "next";
import { buildPageMetadata } from "../../../lib/site-config";
import { getDiagnosticContent } from "../../../lib/diagnostic/content-config";
import { loadLeadPortalData } from "../../../lib/diagnostic/report";
import { getLeadFromCookies } from "../../../lib/auth-server";
import { Assessment } from "./assessment";
import { PortalView } from "./portal-view";

export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "AI Readiness Assessment",
    description:
      "Twelve questions. About eight minutes. A practitioner-written report on where your data foundation sits and what will catch you at scale.",
    path: "/tools/ai-readiness",
  });
}

// Two-mode page:
//   - Signed-in lead → return-visitor portal (reports list + retake CTA)
//   - Anyone else (or signed-in lead hitting ?retake=1) → assessment SPA
//
// The ?retake=1 escape hatch lets a returning lead start a new run when
// the cooldown has passed; the portal's "Start a new assessment" link
// routes through it so the SPA's localStorage clearing logic kicks in.

export default async function AIReadinessAssessmentPage({
  searchParams,
}: {
  searchParams: Promise<{ retake?: string }>;
}) {
  const { retake } = await searchParams;
  const content = await getDiagnosticContent();

  const session = await getLeadFromCookies();
  if (session && retake !== "1") {
    const portal = await loadLeadPortalData(session.leadId);
    if (portal) {
      return <PortalView data={portal} />;
    }
    // Cookie present but lead row gone (rare — DB wipe / lead deleted).
    // Fall through to the assessment so the visitor can re-register.
  }

  return <Assessment content={content} />;
}
