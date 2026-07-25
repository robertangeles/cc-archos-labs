// /blog/[slug] — single article. Renders PostHeader + PostBody + Toc +
// AuthorBio + ReadNext. Emits JSON-LD (Article + Person + Breadcrumb)
// in <head> via dangerouslySetInnerHTML. Feature-flagged at the route
// level — returns notFound() when blog_enabled is false.
//
// Visibility-permissive: unlisted posts ARE rendered when accessed by
// direct URL (preserves SEO equity for old links). The unlisted filter
// only excludes them from /blog index + sitemap + read-next pool.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isBlogEnabled } from "../../../lib/blog/feature-flag";
import { getPostBySlug, getReadNext } from "../../../lib/posts";
import { SOCIAL_LINKS } from "../../../lib/social-links";
import { generateToc } from "../../../lib/post-rendering";
import {
  articleSchema,
  breadcrumbSchema,
  jsonLdScript,
  personSchema,
} from "../../../lib/structured-data";
import {
  buildPageMetadata,
  getSiteSettings,
  getSiteUrl,
} from "../../../lib/site-config";
import Image from "next/image";
import { PostHeader } from "../../../components/blog/post-header";
import { PostBody } from "../../../components/blog/post-body";
import { Toc } from "../../../components/blog/toc";
import { AuthorBio } from "../../../components/blog/author-bio";
import { ReadNext } from "../../../components/blog/read-next";
import { SocialShare } from "../../../components/blog/social-share";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) {
    return buildPageMetadata({ title: "Post not found", path: `/blog/${slug}` });
  }
  // Per-post OG image: use the featured image from post.og_image_path when
  // present + not soft-deleted. Falls through to the site-wide default
  // inside buildPageMetadata when undefined. Width/height come from the
  // image-pipeline upload metadata (NULL on rows uploaded before that
  // pipeline backfilled — omit so scrapers infer).
  const usePostImage = post.ogImagePath && !post.ogImageDeletedAt;
  return buildPageMetadata({
    title: post.seoTitle ?? post.title,
    description: post.seoDescription ?? post.excerpt ?? undefined,
    path: `/blog/${post.slug}`,
    ogType: "article",
    lastUpdatedISO: (post.lastReviewedAt ?? post.publishedAt).toISOString(),
    articleSection: post.categoryName ?? undefined,
    image: usePostImage ? post.ogImagePath ?? undefined : undefined,
    imageAlt: usePostImage ? post.ogImageAlt ?? undefined : undefined,
    imageWidth: usePostImage ? post.ogImageWidth ?? undefined : undefined,
    imageHeight: usePostImage ? post.ogImageHeight ?? undefined : undefined,
  });
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const enabled = await isBlogEnabled();
  if (!enabled) notFound();

  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const [settings, readNext] = await Promise.all([
    getSiteSettings(),
    getReadNext(post.id, 3),
  ]);
  const siteUrl = getSiteUrl();
  const headings = generateToc(post.contentMd);
  const authorName = post.authorName ?? settings.siteName;

  const articleLd = articleSchema(post, siteUrl, settings);
  const personLd = personSchema(
    authorName,
    post.authorLinkedinUrl,
    post.authorPhotoUrl,
    siteUrl,
    settings,
  );
  const breadcrumbLd = breadcrumbSchema(post, siteUrl);

  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(articleLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(personLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbLd) }}
      />

      <article className="mx-auto w-full max-w-[1200px] px-6 pt-24 pb-32 md:px-12">
        <div className="grid gap-12 lg:grid-cols-[760px_minmax(0,1fr)]">
          <div className="min-w-0">
            <PostHeader
              title={post.title}
              authorName={authorName}
              categorySlug={post.categorySlug}
              categoryName={post.categoryName}
              readingTimeMin={post.readingTimeMin}
              publishedAt={post.publishedAt}
              lastReviewedAt={post.lastReviewedAt}
            />

            <SocialShare
              url={`${siteUrl}/blog/${post.slug}`}
              title={post.title}
              variant="top"
            />

            {post.ogImagePath && !post.ogImageDeletedAt ? (
              <figure className="mt-12 overflow-hidden rounded-lg border border-hairline bg-surface-1">
                <div className="relative aspect-[29/10] w-full">
                  <Image
                    src={post.ogImagePath}
                    // Alt from post.og_image_alt (backfilled + enforced
                    // on new uploads); falls back to title for legacy
                    // rows. Hero image — `priority` keeps LCP fast.
                    alt={post.ogImageAlt ?? post.title}
                    fill
                    priority
                    sizes="(min-width: 1024px) 760px, 100vw"
                    className="object-cover"
                  />
                </div>
              </figure>
            ) : null}

            <div className="mt-12">
              <PostBody contentMd={post.contentMd} />
            </div>

            <SocialShare
              url={`${siteUrl}/blog/${post.slug}`}
              title={post.title}
              variant="post-body"
            />

            <AuthorBio
              name={authorName}
              bioMd={post.authorBioMd ?? ""}
              photoUrl={post.authorPhotoUrl}
              socialLinks={SOCIAL_LINKS}
            />

            <ReadNext items={readNext} />
          </div>

          <div>
            <Toc headings={headings} />
          </div>
        </div>
      </article>
    </main>
  );
}
