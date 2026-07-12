// /llms.txt — AI-crawler index (top 20 listed posts). Emits when the
// blog feature flag is on; returns 404 otherwise so AI bots get a clear
// signal that no LLM corpus is published yet.
//
// Format follows the emerging llms.txt convention: H1 site name, blockquote
// tagline, then sections with bullet entries.

import { isBlogEnabled } from "../../lib/blog/feature-flag";
import { buildLlmsTxt } from "../../lib/llms-txt";
import { listAllPostsForFeeds } from "../../lib/posts";
import { getSiteSettings, getSiteUrl } from "../../lib/site-config";

// ISR, not force-dynamic: the corpus changes on a days cadence, so serve a
// cached copy and rebuild hourly instead of hitting the DB on every AI-bot
// fetch. Mirrors app/blog/feed.xml. isBlogEnabled() fails closed, so a
// DB-less CI build prerenders the 404 branch without crashing.
export const revalidate = 3600;

export async function GET() {
  const enabled = await isBlogEnabled();
  if (!enabled) {
    return new Response("Not found", { status: 404 });
  }
  const [settings, posts] = await Promise.all([
    getSiteSettings(),
    listAllPostsForFeeds(),
  ]);
  const body = buildLlmsTxt({
    settings,
    siteUrl: getSiteUrl(),
    posts,
    topN: 20,
  });
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600",
    },
  });
}
