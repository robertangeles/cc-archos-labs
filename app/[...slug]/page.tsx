import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolvePage } from "../../lib/pages/resolver";
import { runBootCheck } from "../../lib/pages/boot-check";
import { getSessionFromCookies } from "../../lib/auth-server";
import { buildPageMetadata, getSiteSettings, getSiteUrl } from "../../lib/site-config";
import { buildCmsPageWebPageLd } from "../../lib/schema-org";
import { MarkdownArticle } from "../../components/pages/markdown-article";

// Pages CMS catch-all. Sole reader of the `page` table for public
// traffic. Routing precedence in Next.js prefers static segments over
// `[...slug]`, so this only fires for paths NOT served by any static
// route (e.g. /privacy, /terms after their static routes were deleted
// in the Phase 1 cutover commit).
//
// Boot-time guard: `runBootCheck()` asserts every top-level app/
// directory is in RESERVED_SLUGS (or is a known CMS-managed slug). If a
// future PR adds app/services/page.tsx without updating the set, the
// first request hitting this route throws — visible in dev + fails the
// deploy in prod.

export const dynamic = "force-dynamic";

// runBootCheck is imported as a side-effect via module load. The
// `noinline` directive isn't real — we just call it once per render so
// any drift is surfaced immediately during dev / first-request in prod.
function guardOnce() {
  runBootCheck();
}

// Resolves the slug array to a single string. Phase 1 supports only
// top-level slugs (no nesting). Phase 4 will extend this to walk the
// `parent_id` chain.
function joinSlug(slugSegments: string[] | undefined): string {
  if (!slugSegments || slugSegments.length === 0) return "";
  // Reject multi-segment paths in Phase 1 — nested slugs aren't a
  // thing yet, so /foo/bar would have to be a static route or 404.
  if (slugSegments.length > 1) return "__too_deep__";
  return slugSegments[0];
}

async function viewerIsAdmin(): Promise<boolean> {
  try {
    const session = await getSessionFromCookies();
    return session !== null;
  } catch {
    return false;
  }
}

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export async function generateMetadata(
  { params }: PageProps,
): Promise<Metadata> {
  guardOnce();
  const { slug } = await params;
  const joined = joinSlug(slug);
  if (joined === "" || joined === "__too_deep__") {
    return buildPageMetadata({ title: "Page not found", path: `/` });
  }
  const result = await resolvePage(joined, {
    isAdmin: await viewerIsAdmin(),
  });
  if (result.kind === "not_found") {
    return buildPageMetadata({ title: "Page not found", path: `/${joined}` });
  }
  const page = result.page;
  const lastUpdated = (page.lastReviewedAt ?? page.updatedAt).toISOString();
  return buildPageMetadata({
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? page.excerpt ?? undefined,
    path: `/${page.slug}`,
    ogType: page.ogType,
    lastUpdatedISO: lastUpdated,
    articleSection: page.ogType === "article" ? "Legal" : undefined,
  });
}

export default async function CatchAllPage({ params }: PageProps) {
  guardOnce();
  const { slug } = await params;
  const joined = joinSlug(slug);
  if (joined === "" || joined === "__too_deep__") notFound();

  const result = await resolvePage(joined, {
    isAdmin: await viewerIsAdmin(),
  });

  if (result.kind === "not_found") notFound();

  // Schema.org WebPage JSON-LD signals dateModified to LLM citation
  // graphs + search engines. Especially important for legal docs.
  const settings = await getSiteSettings();
  const siteUrl = getSiteUrl();
  const page = result.page;
  const webPageLd = buildCmsPageWebPageLd({
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? page.excerpt ?? settings.description,
    url: `${siteUrl}/${page.slug}`,
    orgName: settings.siteName,
    siteUrl,
    datePublishedISO: page.publishedAt.toISOString(),
    dateModifiedISO: (page.lastReviewedAt ?? page.updatedAt).toISOString(),
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }}
      />
      <MarkdownArticle page={page} preview={result.kind === "preview"} />
    </>
  );
}
