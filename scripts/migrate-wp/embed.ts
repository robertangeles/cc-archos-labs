// embed.ts — migration pipeline wrapper around lib/embeddings.ts.
//
// The actual API call + retry loop lives in lib/embeddings.ts so it can
// be reused by the admin Posts editor (save side-effect when content
// shifts >5%) and the "Suggest internal links" button (embeds the
// current draft to find similar published posts).
//
// See lib/embeddings.ts for the model choice + cost rationale + the
// EmbeddingError contract.

import {
  embedPostContent,
  EmbeddingError,
  type EmbeddingOptions,
} from "../../lib/embeddings";
import type { EmbeddedPost, PolishedPost } from "./types";

export type EmbedOptions = EmbeddingOptions;

export async function embedPost(
  post: PolishedPost,
  opts: EmbedOptions = {},
): Promise<EmbeddedPost> {
  try {
    const embedding = await embedPostContent(
      {
        title: post.title,
        excerpt: post.excerpt,
        contentMd: post.contentMd,
      },
      opts,
    );
    return { ...post, embedding };
  } catch (err) {
    // Preserve the per-post source ID in the error message so the
    // manifest can report which post failed to embed.
    const message =
      err instanceof EmbeddingError ? err.message : String(err);
    throw new EmbedError(post.sourceWpId, message);
  }
}

/**
 * Per-post error class preserved for the migration pipeline manifest.
 * lib/embeddings.ts throws EmbeddingError (post-agnostic); we wrap it
 * here with the sourceWpId so the pipeline manifest can pinpoint the
 * row that failed.
 */
export class EmbedError extends Error {
  constructor(
    public readonly sourceWpId: number,
    message: string,
  ) {
    super(`[post #${sourceWpId}] ${message}`);
    this.name = "EmbedError";
  }
}
