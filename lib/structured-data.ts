import "server-only";
import type { PublishedPostView } from "./posts";
import { showsDualByline } from "./blog/byline";
import { personIdForAuthor, ref, SCHEMA_IDS } from "./schema-graph";
import type { SiteSettings } from "./site-config-shared";

// JSON-LD emitters for the public /blog surface: one Article, one Person and
// one BreadcrumbList per post page. The page renders them via:
//   <script type="application/ld+json" dangerouslySetInnerHTML={...} />
//
// These no longer DECLARE the Organization or the founder. Those nodes live in
// app/layout.tsx's @graph with stable @ids from lib/schema-graph.ts, and the
// emitters here reference them — re-declaring an Organization on every article
// is what made Google resolve one per page instead of one per business.
//
// The Person a post emits is its AUTHOR, which for the agent pipeline is Metis,
// not the founder. See personIdForAuthor: an author the graph cannot vouch for
// stays anonymous rather than being handed someone else's identity.
//
// Stringification escapes `</script>` defensively in case any field
// contains the literal substring (very rare but easy to defuse).

export type JsonLd = Record<string, unknown>;

export function personSchema(
  authorName: string,
  authorLinkedinUrl: string | null,
  authorPhotoUrl: string | null,
  siteUrl: string,
  settings: SiteSettings,
): JsonLd {
  const sameAs: string[] = [];
  if (authorLinkedinUrl) sameAs.push(authorLinkedinUrl);
  if (settings.modellingRoomUrl) sameAs.push(settings.modellingRoomUrl);
  // An @id only when we can actually vouch for the identity. An author this
  // cannot place stays anonymous rather than being assigned someone else's
  // identity — see personIdForAuthor for why the founder is not a case here.
  const id = personIdForAuthor(authorName);
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    ...(id ? { "@id": id } : {}),
    name: authorName,
    url: `${siteUrl}/about`,
    ...(authorPhotoUrl ? { image: authorPhotoUrl } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    worksFor: ref(SCHEMA_IDS.org),
  };
}

export function breadcrumbSchema(
  post: Pick<PublishedPostView, "title" | "slug" | "categorySlug" | "categoryName">,
  siteUrl: string,
): JsonLd {
  const items: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item: string;
  }> = [
    { "@type": "ListItem", position: 1, name: "Blog", item: `${siteUrl}/blog` },
  ];
  if (post.categorySlug && post.categoryName) {
    items.push({
      "@type": "ListItem",
      position: 2,
      name: post.categoryName,
      item: `${siteUrl}/blog/category/${post.categorySlug}`,
    });
  }
  items.push({
    "@type": "ListItem",
    position: items.length + 1,
    name: post.title,
    item: `${siteUrl}/blog/${post.slug}`,
  });
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

export function articleSchema(
  post: PublishedPostView,
  siteUrl: string,
  settings: SiteSettings,
): JsonLd {
  const url = `${siteUrl}/blog/${post.slug}`;
  const authorName = post.authorName ?? settings.siteName;
  const authorId = personIdForAuthor(authorName);
  const datePublished = post.publishedAt.toISOString();
  const dateModified = (post.lastReviewedAt ?? post.publishedAt).toISOString();
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt ?? settings.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished,
    dateModified,
    inLanguage: "en-AU",
    wordCount: post.wordCount,
    ...(post.ogImagePath && !post.ogImageDeletedAt
      ? {
          image: post.ogImagePath.startsWith("http")
            ? post.ogImagePath
            : `${siteUrl}${post.ogImagePath}`,
        }
      : {}),
    // Reference the graph node when the author is one we can name, so the
    // Article attaches to the same entity the Person node declares. Otherwise
    // keep the inline shape — an Article still needs SOME author.
    //
    // A human-reviewed agent post promotes the founder to author AND editor,
    // with the agent demoted to contributor. That is the E-E-A-T signal: Google
    // anchors expertise to named humans, and `editor` is the vocabulary for
    // "this person vouched for the content". Metis stays visible as
    // contributor rather than being erased — the research is genuinely its
    // work, and hiding an AI's involvement would be the dishonest version of
    // this change.
    //
    // MUST agree with the on-page byline. Both read showsDualByline().
    ...(showsDualByline(post)
      ? {
          author: ref(SCHEMA_IDS.person),
          editor: ref(SCHEMA_IDS.person),
          contributor: ref(SCHEMA_IDS.metis),
        }
      : {
          author: authorId
            ? ref(authorId)
            : {
                "@type": "Person",
                name: authorName,
                url: post.authorLinkedinUrl ?? `${siteUrl}/about`,
              },
        }),
    // The Organization is declared once in the layout graph; repeating its
    // name, url and logo here is what made Google see two of them.
    publisher: ref(SCHEMA_IDS.org),
    ...(post.categoryName ? { articleSection: post.categoryName } : {}),
    ...(post.tags && post.tags.length > 0 ? { keywords: post.tags.join(", ") } : {}),
  };
}

/**
 * Serialise a JSON-LD payload for embedding in a <script> tag.
 *
 * Accepts a single node or an array of them — `app/page.tsx` emits three
 * Service entities in one block, so the array form is a real caller, not
 * speculative generality.
 */
export function jsonLdScript(data: JsonLd | JsonLd[]): string {
  // `</script>` inside a JSON string would close the surrounding script
  // tag prematurely. Escape it. Also escape U+2028 / U+2029 which are
  // valid JSON but invalid JS string literals. Built via the RegExp
  // constructor with String.fromCharCode so this source file stays plain
  // ASCII (literal U+2028/U+2029 in a regex literal is a parse error in TS).
  const U2028 = new RegExp(String.fromCharCode(0x2028), "g");
  const U2029 = new RegExp(String.fromCharCode(0x2029), "g");
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(U2028, "\\u2028")
    .replace(U2029, "\\u2029");
}
