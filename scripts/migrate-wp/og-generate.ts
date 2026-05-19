// og-generate.ts — branded OG image generation.
//
// STATUS: stub. Returns a null path with a TODO comment so the pipeline
// can wire through cleanly. Real implementation deferred to a follow-up
// PR because:
//
// 1. The pre-build font-loading dance (Geist Sans buffer, satori or
//    @vercel/og setup) needs interactive verification — easy to get
//    wrong without eyes on the rendered PNG.
// 2. The OG template visual design (DES-3: dark canvas, lavender eyebrow
//    'ARCHOS LABS · THE TRANSLATION LAYER', display-lg title, small
//    product mark bottom-right) is specced in the design review but
//    needs a real PNG render to confirm spacing + truncation behaviour.
// 3. Posts without an og_image_path render their featured image as
//    Open Graph fallback via JSON-LD `image`, so we degrade gracefully.
//
// When this gets built out, replace the stub return with:
//   - satori(jsxTemplate, { fonts: [geistSansBuffer], width: 1200, height: 630 })
//   - @resvg/resvg-js convert SVG -> PNG
//   - upload to R2 at blog/{slug}/og.png
//   - return { ogImagePath: `${publicUrl}/blog/${slug}/og.png`, ... }
//
// Design spec lives in docs/designs/translation-layer.md (DES-3 section).

import type { MediaRehostedPost, OgGeneratedPost } from "./types";

export interface OgGenerateOptions {
  /** Set true to actually render. Currently no-op. */
  enabled?: boolean;
}

export async function generateOgImage(
  post: MediaRehostedPost,
  _opts: OgGenerateOptions = {},
): Promise<OgGeneratedPost> {
  // STUB: skip generation. og_image_path stays empty until a follow-up
  // PR adds satori + Geist font loading.
  //
  // Downstream effect: post pages emit the featured image (rehosted on
  // R2) as og:image fallback. Social previews still work, just with the
  // post's lead image instead of a branded poster.
  return {
    ...post,
    ogImagePath: "",
    ogImageGeneratedAt: new Date(0), // sentinel: "never generated"
  };
}

/**
 * Helper: callers can check whether an OG image was actually rendered
 * vs returned via the stub. Used by the manifest to flag og-generation
 * as a known gap in this commit.
 */
export function wasOgGenerated(post: OgGeneratedPost): boolean {
  return (
    post.ogImagePath !== "" &&
    post.ogImageGeneratedAt.getTime() > 0
  );
}
