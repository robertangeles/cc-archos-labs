import type { Metadata } from "next";
import { buildPageMetadata, getSiteSettings, getSiteUrl } from "@/lib/site-config";
import { buildCdmpPracticeExamLd } from "@/lib/schema-org";
import { Exam } from "./exam";

export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "CDMP Practice Exam",
    description:
      "Free practice exams for the CDMP certification. Questions follow the same format, depth, and chapter weightings as the official exam. Find out where your knowledge holds and where it doesn't.",
    path: "/tools/cdmp-practice",
  });
}

export default async function CdmpPracticePage() {
  const settings = await getSiteSettings();
  const siteUrl = getSiteUrl();
  const schemas = buildCdmpPracticeExamLd({
    orgName: settings.siteName,
    siteUrl,
  });

  return (
    <>
      {/* JSON-LD: WebApplication + FAQPage. All values are static
          string literals from lib/schema-org.ts — no user input. */}
      {schemas.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
      <Exam />
    </>
  );
}
