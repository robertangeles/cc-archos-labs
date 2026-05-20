import "server-only";

// Shared OG image generation. Used by:
//   - scripts/migrate-wp/og-generate.ts (migration pipeline)
//   - admin Posts editor regenerate-og button (Phase D)
//
// STATUS: The actual rendering pipeline (satori + Geist font buffer +
// @resvg/resvg-js + R2 upload) is still deferred — see the TODO in
// scripts/migrate-wp/og-generate.ts for the design context. Until it
// lands, this function returns the empty-path sentinel and posts emit
// their featured image as the OG fallback via JSON-LD. The admin button
// + cron path wire through this same function so the moment the real
// renderer lands, both surfaces light up without API changes.
//
// Contract (once real):
//   - Renders a 1200x630 PNG matching DES-3 of the Translation Layer
//     design (dark canvas, lavender 'ARCHOS LABS · THE TRANSLATION
//     LAYER' eyebrow, display-lg title, product mark bottom-right)
//   - Uploads to R2 at `blog/{slug}/og.png`
//   - Returns the public URL + the generation timestamp

export interface GenerateOgInput {
  /** URL-safe slug — used as the R2 key + public path. */
  slug: string;
  /** Post title — rendered as the primary headline on the OG image. */
  title: string;
  /** Optional excerpt — rendered as the sub-headline. Falls back to "" if absent. */
  excerpt?: string | null;
}

export interface GenerateOgResult {
  /** Public path to the rendered image, or empty string when the
   *  renderer is still stubbed. Callers persist this verbatim to
   *  `post.og_image_path`. */
  ogImagePath: string;
  /** Generation timestamp. The sentinel `new Date(0)` ("epoch") signals
   *  the stub path — useful so the manifest can flag posts that need a
   *  re-render once the real pipeline lands. */
  ogImageGeneratedAt: Date;
}

/**
 * Generate an OG image for a post. Today: stub — returns the empty-path
 * sentinel. Tomorrow: satori + Geist + R2.
 *
 * Idempotent at the contract level: callers can re-run this without
 * worrying about double-renders. Once the real renderer lands, it will
 * overwrite the prior image at the same R2 key.
 */
export async function generateOgImage(
  _input: GenerateOgInput,
): Promise<GenerateOgResult> {
  return {
    ogImagePath: "",
    ogImageGeneratedAt: new Date(0),
  };
}

/**
 * Helper used by the manifest and the admin UI to surface "this OG
 * image is the placeholder, not a real render." Pure: takes the
 * persisted path + timestamp and returns whether they came from the
 * stub.
 */
export function isOgImageStubbed(
  ogImagePath: string | null,
  ogImageGeneratedAt: Date | null,
): boolean {
  if (!ogImagePath) return true;
  if (!ogImageGeneratedAt) return true;
  return ogImageGeneratedAt.getTime() === 0;
}
