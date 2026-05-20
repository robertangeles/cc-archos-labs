// og-generate.ts — migration pipeline wrapper around lib/og.ts.
//
// The actual generation logic (currently a stub, future satori + Geist +
// R2) lives in lib/og.ts so it can be shared between the migration
// pipeline and the admin "Regenerate OG image" button. This file
// remains as the migration-typed adapter.
//
// See lib/og.ts for the rendering contract + the deferred-renderer
// rationale. Design spec lives in docs/designs/translation-layer.md
// (DES-3 section).

import { generateOgImage as generateOgImageCore, isOgImageStubbed } from "../../lib/og";
import type { MediaRehostedPost, OgGeneratedPost } from "./types";

export interface OgGenerateOptions {
  /** Set true to actually render. Currently no-op (lib/og.ts is stubbed). */
  enabled?: boolean;
}

export async function generateOgImage(
  post: MediaRehostedPost,
  _opts: OgGenerateOptions = {},
): Promise<OgGeneratedPost> {
  const result = await generateOgImageCore({
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
  });
  return {
    ...post,
    ogImagePath: result.ogImagePath,
    ogImageGeneratedAt: result.ogImageGeneratedAt,
  };
}

/**
 * Helper: callers can check whether an OG image was actually rendered
 * vs returned via the stub. Used by the manifest to flag og-generation
 * as a known gap in this commit. Delegates to lib/og.isOgImageStubbed
 * for the source-of-truth definition.
 */
export function wasOgGenerated(post: OgGeneratedPost): boolean {
  return !isOgImageStubbed(post.ogImagePath, post.ogImageGeneratedAt);
}
