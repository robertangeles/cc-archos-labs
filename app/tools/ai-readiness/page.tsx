import type { Metadata } from "next";
import { buildPageMetadata } from "../../../lib/site-config";
import { getDiagnosticContent } from "../../../lib/diagnostic/content-config";
import { Assessment } from "./assessment";

export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "AI Readiness Assessment",
    description:
      "Twelve questions. About eight minutes. A practitioner-written report on where your data foundation sits and what will catch you at scale.",
    path: "/tools/ai-readiness",
  });
}

export default async function AIReadinessAssessmentPage() {
  // Load admin-editable diagnostic content server-side and pass it
  // through to the client SPA. Real content lives in the site_setting
  // row; source has a placeholder fallback only (D-27).
  const content = await getDiagnosticContent();
  return <Assessment content={content} />;
}
