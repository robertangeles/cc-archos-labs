import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteUrl } from "@/lib/site-config";
import { JsonLd } from "@/components/json-ld";
import {
  SPECIALIST_AREA_SLUGS,
  isSpecialistAreaSlug,
} from "@/lib/cdmp/config-shared";
import { getSpecialistArea } from "@/lib/cdmp/specialist";

export const runtime = "nodejs";

// One short, subject-specific value line per exam — written, not templated, so
// the 7 pages read as distinct (the subject name is the hero; this is the
// supporting sentence). NOT generic filler.
const VALUE_LINE: Record<string, string> = {
  data_governance:
    "Test your grip on governance operating models, stewardship, and policy — the backbone of every data program.",
  data_modelling_design:
    "Conceptual, logical, physical — work modelling and design decisions the way the exam frames them.",
  data_integration_interoperability:
    "ETL, ELT, replication, and the patterns that move data between systems without losing its meaning.",
  master_reference_data:
    "Golden records, match-and-merge, and the reference data that keeps an organisation speaking one language.",
  data_warehousing_bi:
    "Dimensional models, the warehouse, and the BI layer that turns stored data into decisions.",
  metadata_management:
    "Business, technical, and operational metadata — the data about data that makes everything else findable.",
  data_quality:
    "Dimensions, rules, and remediation — measure and defend the quality your decisions depend on.",
};

// Public URLs are hyphenated (SEO-friendly); the underscore slug is internal.
export function generateStaticParams() {
  return SPECIALIST_AREA_SLUGS.map((slug) => ({ area: slug.replaceAll("_", "-") }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ area: string }>;
}): Promise<Metadata> {
  const { area } = await params;
  const slug = area.replaceAll("-", "_");
  if (!isSpecialistAreaSlug(slug)) return {};
  const info = await getSpecialistArea(slug);
  const label = info?.label ?? slug;
  return {
    title: `CDMP ${label} Practice Exam`,
    description: `A focused CDMP practice exam scoped to ${label}. Fresh AI-generated questions each attempt, tiered Associate / Practitioner / Master, timed like the real exam.`,
    alternates: { canonical: `/tools/cdmp-practice/specialist/${area}` },
  };
}

export default async function SpecialistLandingPage({
  params,
}: {
  params: Promise<{ area: string }>;
}) {
  const { area } = await params;
  const slug = area.replaceAll("-", "_");
  if (!isSpecialistAreaSlug(slug)) notFound();
  const info = await getSpecialistArea(slug);
  if (!info || info.maxQuestions < 20) notFound();

  const siteUrl = getSiteUrl();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: `CDMP ${info.label} Practice Exam`,
    educationalLevel: "Professional certification",
    learningResourceType: "Practice exam",
    about: info.label,
    url: `${siteUrl}/tools/cdmp-practice/specialist/${area}`,
    isPartOf: {
      "@type": "WebApplication",
      name: "CDMP Practice Exam",
      url: `${siteUrl}/tools/cdmp-practice`,
    },
  };

  return (
    <>
      <JsonLd data={jsonLd} />
      <section className="flex flex-1 flex-col justify-center bg-canvas px-6 py-24 md:px-12 md:py-32">
        <div className="mx-auto w-full max-w-[760px]">
          <p className="uppercase text-eyebrow text-ink-subtle">
            CDMP Specialist
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight text-ink md:text-6xl">
            {info.label}
          </h1>
          <p className="mt-1 text-2xl font-medium text-ink-subtle md:text-3xl">
            practice exam
          </p>

          <p className="mt-8 max-w-[560px] text-lg leading-[1.6] text-ink-muted">
            {VALUE_LINE[slug]}
          </p>

          <div className="mt-10">
            <Link
              href={`/tools/cdmp-practice?mode=specialist&area=${slug}`}
              className="inline-flex items-center rounded-md bg-primary px-8 py-3.5 text-base font-medium text-white transition-colors duration-150 hover:bg-primary-hover"
            >
              Start practice exam
            </Link>
          </div>

          <p className="mt-8 text-sm text-ink-subtle">
            From the DMBOK · up to {info.maxQuestions} questions · Associate /
            Practitioner / Master
          </p>
        </div>
      </section>
    </>
  );
}
