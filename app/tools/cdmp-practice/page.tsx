import type { Metadata } from "next";
import { buildPageMetadata, getSiteSettings, getSiteUrl } from "@/lib/site-config";
import { buildCdmpPracticeExamLd } from "@/lib/schema-org";
import { jsonLdScript } from "@/lib/structured-data";
import { getSpecialistAreas, getSpecialistArea } from "@/lib/cdmp/specialist";
import { isSpecialistAreaSlug } from "@/lib/cdmp/config-shared";
import { Exam } from "./exam";
import type { SpecialistAreaOption } from "./exam-config";

export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "CDMP Practice Exam",
    description:
      "Free practice exams for the CDMP certification. Questions follow the same format, depth, and chapter weightings as the official exam. Find out where your knowledge holds and where it doesn't.",
    path: "/tools/cdmp-practice",
  });
}

export default async function CdmpPracticePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; area?: string }>;
}) {
  const sp = await searchParams;
  const settings = await getSiteSettings();
  const siteUrl = getSiteUrl();
  const schemas = buildCdmpPracticeExamLd({
    orgName: settings.siteName,
    siteUrl,
  });
  const specialistAreas = (await getSpecialistAreas()).map((a) => ({
    slug: a.slug,
    label: a.label,
    maxQuestions: a.maxQuestions,
  }));

  // Deep-link from a specialist landing poster: pre-lock the subject.
  let lockedArea: SpecialistAreaOption | null = null;
  if (sp.mode === "specialist" && sp.area && isSpecialistAreaSlug(sp.area)) {
    const info = await getSpecialistArea(sp.area);
    if (info && info.maxQuestions >= 20) {
      lockedArea = {
        slug: info.slug,
        label: info.label,
        maxQuestions: info.maxQuestions,
      };
    }
  }

  return (
    <>
      {/* JSON-LD: WebApplication + FAQPage. The question/answer copy is
          static, but `orgName` and `siteUrl` are threaded in from the
          admin-editable site_setting row — so this is NOT user-input-free
          and must go through jsonLdScript(). */}
      {schemas.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(schema) }}
        />
      ))}
      <Exam specialistAreas={specialistAreas} lockedArea={lockedArea} />
    </>
  );
}
