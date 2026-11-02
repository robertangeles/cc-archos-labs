// Turning the checked essay into a scheduled draft post.
//
// Three things are added by CODE, never written by the model: the Sources section
// (only pages that were really fetched), the Related reading section (only posts that
// exist on the site, from the embeddings) and the schedule (the next free publish slot).
// The model never writes a link, which is why the gates forbid one in the essay.
//
// The post is created SCHEDULED with needs_review and is_agent_generated set. The
// scheduled publisher already refuses to publish an agent post that needs review, so
// the slot only goes live once Rob has cleared it. Nothing here can publish.

import type { PostCreateInput } from "../../posts-admin/schema";
import type { DraftConfig } from "./config";
import type { ParsedEssay } from "./essay";
import type { PhotoResult } from "./photo";
import type { FetchedPage, StoryItem } from "./research";
import { stop, type Stop } from "./types";

export interface PostRefs {
  categoryId: string;
  authorId: string;
}

export interface RelatedPost {
  title: string;
  slug: string;
}

export interface AssembleDeps {
  /** Category by slug and author by name; null if either is missing. */
  refs: () => Promise<PostRefs | null>;
  /** The next free publish slot at or after `now`. */
  nextSlot: (now: Date) => Promise<Date>;
  related: (essay: ParsedEssay) => Promise<RelatedPost[]>;
  slugTaken: (slug: string) => Promise<boolean>;
  createDraftPost: (input: PostCreateInput) => Promise<{ postId: string; slug: string }>;
  attachImage: (postId: string, slug: string, buffer: Buffer, alt: string) => Promise<void>;
}

export type AssembleResult =
  | { ok: true; postId: string; slug: string; slot: Date; imageAttached: boolean; notes: string[] }
  | Stop;

const MAX_TITLE = 140;
const MAX_RELATED = 3;

/** Text that goes inside a markdown link label: no brackets, no line breaks, no length. */
const label = (s: string) => s.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
/** A URL that cannot close the link early. */
const safeUrl = (u: string) => u.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
const hostOf = (u: string) => new URL(u).hostname.replace(/^www\./, "");

export function sourcesSection(pages: FetchedPage[], item: StoryItem): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const p of pages) {
    if (seen.has(p.finalUrl)) continue;
    seen.add(p.finalUrl);
    lines.push(`- [${label(p.title) || hostOf(p.finalUrl)}](${safeUrl(p.finalUrl)}). ${hostOf(p.finalUrl)}.`);
  }
  // The story's own date as Rob reads it, in Melbourne.
  const when = item.publishedAt.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Melbourne" });
  lines.push(`- [${label(item.title)}](${safeUrl(item.sourceUrl)}). HuggingNews, ${when}. The headline this piece checks.`);
  return `## Sources\n\n${lines.join("\n")}`;
}

export function relatedSection(related: RelatedPost[]): string {
  if (related.length === 0) return "";
  return `## Related reading\n\n${related
    .slice(0, MAX_RELATED)
    .map((r) => `- [${label(r.title)}](/blog/${r.slug})`)
    .join("\n")}`;
}

export async function assembleDraft(
  deps: AssembleDeps,
  cfg: DraftConfig,
  input: { parsed: ParsedEssay; pages: FetchedPage[]; item: StoryItem; photo: PhotoResult; now: Date },
): Promise<AssembleResult> {
  const { parsed, pages, item, photo, now } = input;
  const notes: string[] = [];

  const refs = await deps.refs();
  if (!refs) return stop("missing_setup", `category "${cfg.categorySlug}" or author "${cfg.authorName}" is not set up`);

  let related: RelatedPost[] = [];
  try {
    related = await deps.related(parsed);
  } catch {
    notes.push("related reading was skipped");
  }

  const slot = await deps.nextSlot(now);
  if (slot.getTime() <= now.getTime()) return stop("crashed", "the publish slot is not in the future");

  const base = parsed.seo.slug!;
  let slug = base;
  for (let n = 2; n < 30 && (await deps.slugTaken(slug)); n++) slug = `${base}-${n}`;

  const body = [parsed.body, relatedSection(related), sourcesSection(pages, item)].filter(Boolean).join("\n\n");
  const created = await deps.createDraftPost({
    slug,
    title: parsed.title,
    excerpt: parsed.meta,
    contentMd: body,
    seoTitle: parsed.seo.seoTitle!,
    seoDescription: parsed.seo.metaDescription!,
    authorId: refs.authorId,
    categoryId: refs.categoryId,
    tags: parsed.seo.tags,
    status: "scheduled",
    scheduledPublishAt: slot,
    visibility: "listed",
    needsReview: true,
    isAgentGenerated: true,
  });

  let imageAttached = false;
  if (photo.ok) {
    try {
      await deps.attachImage(created.postId, created.slug, photo.buffer, photo.alt);
      imageAttached = true;
    } catch {
      notes.push("the picture could not be attached");
    }
  } else {
    notes.push(photo.note);
  }
  return { ok: true, postId: created.postId, slug: created.slug, slot, imageAttached, notes };
}
