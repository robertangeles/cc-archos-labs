import type { Metadata } from "next";
import { buildPageMetadata } from "../../../lib/site-config";
import { Assessment } from "./assessment";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "AI Readiness Assessment",
    description:
      "Twelve questions. About eight minutes. A practitioner-written report on where your data foundation sits and what will catch you at scale.",
    path: "/tools/ai-readiness",
  });
}

export default function AIReadinessAssessmentPage() {
  return <Assessment />;
}
