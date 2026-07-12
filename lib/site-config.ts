import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getDb } from "./db";
import { siteSetting } from "./db/schema";
import {
  SITE_DEFAULTS,
  SiteSettingsSchema,
  type SiteSettings,
} from "./site-config-shared";

// Server-only site config — DB reads + Next.js Metadata builder. Client
// components import types/defaults from lib/site-config-shared.ts
// instead, which has no server-only imports.

export { SITE_DEFAULTS, SiteSettingsSchema };
export type { SiteSettings };

// React `cache()` dedupes per-request: every layout/page in the same
// request sees the same DB read, but a new request re-fetches. Avoids
// stale config across page edits in /admin/site.
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  try {
    const db = getDb();
    const rows = await db
      .select({ value: siteSetting.value })
      .from(siteSetting)
      .where(eq(siteSetting.key, "site"))
      .limit(1);

    if (rows.length === 0) {
      return SITE_DEFAULTS;
    }

    const stored = rows[0].value as Record<string, unknown>;
    const merged = { ...SITE_DEFAULTS, ...stored };
    const result = SiteSettingsSchema.safeParse(merged);
    return result.success ? result.data : SITE_DEFAULTS;
  } catch (err) {
    // DB unreachable / env missing — never block page render on config
    // load. Log and serve defaults; admin will surface the real error
    // separately.
    console.error("getSiteSettings failed, falling back to defaults:", err);
    return SITE_DEFAULTS;
  }
});

// Public site URL — environment-specific, lives in env vars not DB.
export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://archoslabs.xyz";
}

// Normalises whatever the admin pasted into the twitter handle field
// down to the bare handle — no `@`, no URL prefix, no path/query. The
// admin field is a single text input, so historically it has held a
// mix of "@handle", "handle", and full profile URLs. Without this,
// `@${stored}` produced strings like "@https://x.com/handle" which X
// silently ignored for attribution. Returns "" if nothing usable
// remains so the caller can branch on truthiness.
export function normalizeTwitterHandle(input: string): string {
  let handle = input.trim();
  handle = handle.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "");
  handle = handle.replace(/^@+/, "");
  handle = handle.replace(/[/?#].*$/, "");
  return handle;
}

// Centralised metadata builder used by every page.tsx so the site_setting
// admin row is the single source of truth for OG / Twitter / canonical
// URLs. Page passes only what's specific to that page (title, description,
// path); brand / image / handles come from settings.
//
// Returns a Next.js Metadata object. Page metadata REPLACES (not merges
// with) layout metadata in Next.js's metadata model — that's why we
// build the full openGraph + twitter blocks per page rather than
// expecting layout values to propagate.
//
// `ogType` and `lastUpdatedISO` were added in the Pages CMS Phase 1 to
// support per-page metadata overrides (legal pages publish as
// og:type=article with a dateModified signal). Existing call sites that
// don't pass them fall back to og:type=website with no dateModified.
export async function buildPageMetadata({
  title,
  description,
  path,
  ogType,
  lastUpdatedISO,
  articleSection,
  image,
  imageAlt,
  imageWidth,
  imageHeight,
}: {
  title?: string;
  description?: string;
  path?: string;
  /** OG type override. Default 'website'. Legal/long-form pages use 'article'. */
  ogType?: "website" | "article";
  /** ISO datetime of the most recent material update. Powers og:updated_time. */
  lastUpdatedISO?: string;
  /** Schema.org article section (e.g. 'Legal', 'Marketing'). Optional. */
  articleSection?: string;
  /**
   * Per-page OG image override. When provided, this URL becomes og:image
   * and twitter:image instead of the site-wide settings.ogImageUrl. Used
   * by blog posts so each share card carries the post's featured image.
   * Accepts absolute URLs (R2 / CDN) or site-relative paths.
   */
  image?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
}): Promise<Metadata> {
  const settings = await getSiteSettings();
  const siteUrl = getSiteUrl();
  const fullUrl = path
    ? `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`
    : siteUrl;
  // Pass a BRAND-FREE `title` (e.g. "Contact", not "Contact — Archos Labs").
  // The site name is appended once here for OG/Twitter, and once by the root
  // layout's title template for <title>. Embedding the brand doubles it.
  const effectiveTitle = title
    ? `${title} — ${settings.siteName}`
    : `${settings.siteName} — ${settings.tagline}`;
  const effectiveDescription = description ?? settings.description;

  // Resolve the OG image: prefer the per-page override, fall back to the
  // site default. Either may be absolute or site-relative; normalise to
  // absolute so Open Graph scrapers (X, LinkedIn, Slack) get a fetchable URL.
  const rawImage = image ?? settings.ogImageUrl;
  const ogImageUrl = rawImage.startsWith("http")
    ? rawImage
    : `${siteUrl}${rawImage.startsWith("/") ? rawImage : `/${rawImage}`}`;

  const resolvedOgType = ogType ?? "website";

  // Width / height: the site default is 1200x630. When a per-page image is
  // provided without explicit dimensions, omit them so scrapers infer from
  // the file rather than rendering a stretched 1200x630 placeholder.
  const usingPageImage = image != null;
  const ogImage: { url: string; width?: number; height?: number; alt?: string } =
    {
      url: ogImageUrl,
      ...(usingPageImage
        ? {
            ...(imageWidth ? { width: imageWidth } : {}),
            ...(imageHeight ? { height: imageHeight } : {}),
          }
        : { width: 1200, height: 630 }),
      ...(imageAlt ? { alt: imageAlt } : {}),
    };

  return {
    metadataBase: new URL(siteUrl),
    title: title
      ? title
      : { default: effectiveTitle, template: `%s — ${settings.siteName}` },
    description: effectiveDescription,
    alternates: { canonical: fullUrl },
    openGraph: {
      type: resolvedOgType,
      siteName: settings.siteName,
      title: effectiveTitle,
      description: effectiveDescription,
      url: fullUrl,
      images: [ogImage],
      ...(resolvedOgType === "article" && lastUpdatedISO
        ? {
            modifiedTime: lastUpdatedISO,
            ...(articleSection ? { section: articleSection } : {}),
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: effectiveTitle,
      description: effectiveDescription,
      images: [ogImageUrl],
      ...(() => {
        const handle = normalizeTwitterHandle(settings.twitterHandle);
        return handle
          ? { creator: `@${handle}`, site: `@${handle}` }
          : {};
      })(),
    },
  };
}
