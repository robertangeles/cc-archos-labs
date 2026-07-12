import "server-only";
import type { PublishedPostView } from "./posts";
import type { SiteSettings } from "./site-config-shared";

// JSON-LD emitters for the public /blog surface. Emit one Article + one
// Person + one BreadcrumbList per post page; one Organization per layout.
// The page renders them via:
//   <script type="application/ld+json" dangerouslySetInnerHTML={...} />
//
// Stringification escapes `</script>` defensively in case any field
// contains the literal substring (very rare but easy to defuse).

export type JsonLd = Record<string, unknown>;

export function organizationSchema(
  settings: SiteSettings,
  siteUrl: string,
): JsonLd {
  const sameAs: string[] = [];
  if (settings.linkedinUrl) sameAs.push(settings.linkedinUrl);
  if (settings.modellingRoomUrl) sameAs.push(settings.modellingRoomUrl);
  if (settings.twitterHandle) {
    sameAs.push(`https://twitter.com/${settings.twitterHandle}`);
  }
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: settings.siteName,
    url: siteUrl,
    description: settings.description,
    ...(settings.ogImageUrl
      ? {
          logo: settings.ogImageUrl.startsWith("http")
            ? settings.ogImageUrl
            : `${siteUrl}${settings.ogImageUrl}`,
        }
      : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

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
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: authorName,
    url: `${siteUrl}/about`,
    ...(authorPhotoUrl ? { image: authorPhotoUrl } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    worksFor: {
      "@type": "Organization",
      name: settings.siteName,
      url: siteUrl,
    },
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
    author: {
      "@type": "Person",
      name: authorName,
      url: post.authorLinkedinUrl ?? `${siteUrl}/about`,
    },
    publisher: {
      "@type": "Organization",
      name: settings.siteName,
      url: siteUrl,
      ...(settings.ogImageUrl
        ? {
            logo: {
              "@type": "ImageObject",
              url: settings.ogImageUrl.startsWith("http")
                ? settings.ogImageUrl
                : `${siteUrl}${settings.ogImageUrl}`,
            },
          }
        : {}),
    },
    ...(post.categoryName ? { articleSection: post.categoryName } : {}),
    ...(post.tags && post.tags.length > 0 ? { keywords: post.tags.join(", ") } : {}),
  };
}

/** Serialise a JSON-LD object for embedding in a <script> tag. */
export function jsonLdScript(data: JsonLd): string {
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
