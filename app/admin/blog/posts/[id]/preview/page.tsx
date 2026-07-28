// /admin/blog/posts/[id]/preview — full-chrome draft preview.
//
// Renders a post (any status — draft / scheduled / published) the way
// a reader would see it on /blog/[slug], so the author can validate
// hero image crop, typography, TOC anchors, read-next, and author
// byline before publishing. Differs from the inline split-pane
// <PreviewPane> which only renders the markdown body.
//
// What this route deliberately does NOT do:
//   - Emit JSON-LD scripts (Article/Person/Breadcrumb). Drafts have
//     null publishedAt — emitting a schema with null datePublished
//     would either throw or seed invalid structured data into any
//     crawler that ignores the noindex.
//   - Index in search engines. noindex meta + Cache-Control: private,
//     no-store. Auth-gated by proxy.ts (admin cookie required).
//   - Hit the public /blog/[slug] route. Composing here keeps preview
//     completely isolated from the published render path — the only
//     shared surface is the leaf block components, which is what we
//     want (visual parity at the part-level).
//
// Outside the (authed) route group on purpose: admin shell would
// wrap the preview in nav + sidebar + sign-out chrome and defeat the
// "see what readers see" purpose. proxy.ts still enforces auth.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { PreviewBanner } from "./preview-banner";
import { isBlogEnabled } from "../../../../../../lib/blog/feature-flag";
import { showsDualByline } from "../../../../../../lib/blog/byline";
import { getPostByIdForPreview, getReadNext, type ReadNextItem } from "../../../../../../lib/posts";
import { getAdminPostById } from "../../../../../../lib/posts-admin";
import { generateToc } from "../../../../../../lib/post-rendering";
import { getSiteSettings } from "../../../../../../lib/site-config";
import { SOCIAL_LINKS } from "../../../../../../lib/social-links";
import { PostHeader } from "../../../../../../components/blog/post-header";
import { PostBody } from "../../../../../../components/blog/post-body";
import { Toc } from "../../../../../../components/blog/toc";
import { AuthorBio } from "../../../../../../components/blog/author-bio";
import { ReadNext } from "../../../../../../components/blog/read-next";

// Preview is always dynamic — drafts mutate on every save and we want
// the author to see freshest state. Cache headers below double up
// against any intermediate proxy.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Hard noindex/nofollow at the head level. Even if a crawler somehow
  // followed an admin cookie (it can't — proxy.ts gates the route),
  // this would keep it out of search.
  robots: { index: false, follow: false, nocache: true },
  title: "Draft preview",
};

export default async function PostPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const enabled = await isBlogEnabled();
  if (!enabled) notFound();

  const { id } = await params;
  // Two-query lookup: getPostByIdForPreview gives the PublishedPostView
  // shape the leaf components expect; getAdminPostById gives the canonical
  // status (draft/scheduled/published/archived) for the banner label.
  // Same row, two reads — acceptable cost for an admin-only surface,
  // avoids polluting PublishedPostView with admin-only fields.
  const [post, adminPost, settings] = await Promise.all([
    getPostByIdForPreview(id),
    getAdminPostById(id),
    getSiteSettings(),
  ]);
  if (!post || !adminPost) notFound();
  if (adminPost.archivedAt) {
    // Archived posts get a friendlier message than 404 — the editor
    // restore action is one click away.
    return <ArchivedNotice postId={id} />;
  }

  // getReadNext queries the HNSW embedding index. A brand-new draft
  // may not have an embedding yet (regeneration runs as a post-save
  // side effect; auto-create-draft skips it entirely on empty bodies).
  // Empty array is fine — <ReadNext> handles it gracefully.
  let readNext: ReadNextItem[] = [];
  try {
    readNext = await getReadNext(post.id, 3);
  } catch (err) {
    console.warn("[preview] getReadNext failed:", err);
    // Fall through with empty array.
  }

  const headings = generateToc(post.contentMd);
  const authorName = post.authorName ?? settings.siteName;
  const statusLabel = computeStatusLabel(adminPost.status);

  return (
    <main className="flex flex-1 flex-col bg-canvas">
      <PreviewBanner postId={post.id} statusLabel={statusLabel} />

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
              // Preview exists to check the byline before publishing, so it has
              // to show the same one the public page will. Omitting these
              // defaulted the preview to the single-name byline, which meant
              // clicking "Mark human-reviewed" and then previewing showed no
              // change — the exact workflow this feature is for.
              dualByline={showsDualByline(post)}
              reviewerName={settings.founderName}
            />

            {post.ogImagePath && !post.ogImageDeletedAt ? (
              <figure className="mt-12 overflow-hidden rounded-lg border border-hairline bg-surface-1">
                <div className="relative aspect-[29/10] w-full">
                  <Image
                    src={post.ogImagePath}
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

/**
 * Short human-readable status for the banner. Reads the post's
 * canonical status field directly so the label is unambiguous.
 */
function computeStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "unpublished draft";
    case "scheduled":
      return "scheduled — not yet live";
    case "published":
      return "published — previewing latest saved state";
    case "archived":
      return "archived";
    default:
      return status;
  }
}

/**
 * Friendly card shown when an archived post is opened in preview.
 * The author can restore it from the editor; we don't render the
 * archived content because it's a deliberate hidden state.
 */
function ArchivedNotice({ postId }: { postId: string }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-canvas px-6 py-32">
      <div className="max-w-lg rounded-lg border border-hairline bg-surface-1 p-8 text-center">
        <p className="text-eyebrow uppercase tracking-[0.12em] text-ink-subtle">
          Archived
        </p>
        <h1 className="mt-4 text-2xl font-semibold text-ink">
          This draft has been archived
        </h1>
        <p className="mt-3 text-sm text-ink-subtle">
          Restore it from the editor to preview again.
        </p>
        <Link
          href={`/admin/blog/posts/${postId}`}
          className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-canvas hover:opacity-90"
        >
          Back to editor
        </Link>
      </div>
    </main>
  );
}
