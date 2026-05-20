// /llms-full.txt — full corpus dump for AI crawlers. Every listed post
// with its full markdown body. Cached for an hour at the edge — change
// cadence is days, not minutes.

import { isBlogEnabled } from "../../lib/blog/feature-flag";
import { buildLlmsFullTxt } from "../../lib/llms-txt";
import { listAllPostsForLlmsFull } from "../../lib/posts";
import { getSiteSettings, getSiteUrl } from "../../lib/site-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = await isBlogEnabled();
  if (!enabled) {
    return new Response("Not found", { status: 404 });
  }
  const [settings, posts] = await Promise.all([
    getSiteSettings(),
    listAllPostsForLlmsFull(),
  ]);
  const body = buildLlmsFullTxt({
    settings,
    siteUrl: getSiteUrl(),
    posts,
  });
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600",
    },
  });
}
