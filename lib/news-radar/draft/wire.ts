import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "../../db";
import { author, category, post } from "../../db/schema";
import { generateImage } from "../../image-gen/service";
import { getIntegrationConfig } from "../../integration-config";
import { findSimilarPosts } from "../../posts/find-similar";
import { createPost } from "../../posts-admin";
import { attachImageToPost } from "../../posts-admin/attach-image";
import { nextPublishSlot } from "../../posts-admin/publish-slots";
import { fetchSource } from "../source";
import type { AssembleDeps } from "./assemble";
import type { DraftConfig } from "./config";
import { countSucceeded } from "./jobs";
import { makeOpenRouterLlm } from "./llm";
import type { RunDeps } from "./run";
import { loadSkill } from "./skills";

// The one place the pipeline touches the real world: the models (key from the
// Integrations panel), the network, post creation, the image pipeline. Everything
// else in lib/news-radar/draft takes these as arguments, which is what makes it
// testable. There is deliberately nothing clever here.

/** How far a post may be from a related one and still be linked; a cosine distance. */
const RELATED_MAX_DISTANCE = 0.6;

export function makeRunDeps(db: DB, cfg: DraftConfig): RunDeps {
  const assemble: AssembleDeps = {
    refs: async () => {
      const [cat] = await db.select({ id: category.id }).from(category).where(eq(category.slug, cfg.categorySlug)).limit(1);
      const [auth] = await db.select({ id: author.id }).from(author).where(eq(author.name, cfg.authorName)).limit(1);
      return cat && auth ? { categoryId: cat.id, authorId: auth.id } : null;
    },
    nextSlot: (now) => nextPublishSlot(db, now),
    related: async (essay) => {
      const rows = await findSimilarPosts({ queryText: { title: essay.title, excerpt: essay.meta }, limit: 3, maxDistance: RELATED_MAX_DISTANCE, visibility: "public" });
      return rows.map((r) => ({ title: r.title, slug: r.slug }));
    },
    slugTaken: async (slug) => (await db.select({ id: post.id }).from(post).where(eq(post.slug, slug)).limit(1)).length > 0,
    createDraftPost: async (input) => {
      const saved = await createPost(input, "agent:news-draft");
      return { postId: saved.post.id, slug: saved.post.slug };
    },
    attachImage: async (postId, slug, buffer, alt) => {
      await attachImageToPost({ postId, slug, buffer, alt });
    },
  };

  return {
    db,
    now: () => new Date(),
    llm: makeOpenRouterLlm({ apiKey: async () => (await getIntegrationConfig()).llmApiKey ?? null }),
    fetchSource,
    skill: (slug) => loadSkill(db, slug),
    generateImage: (prompt, opts) => generateImage(prompt, opts),
    assemble,
    photoSeed: () => countSucceeded(db),
  };
}
