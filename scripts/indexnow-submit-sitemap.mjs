#!/usr/bin/env node
// One-shot bulk IndexNow submission. Reads the live sitemap and submits
// every archoslabs.xyz URL to api.indexnow.org so participating engines
// (Bing/Yandex/Naver/Seznam.cz/Yep/Amazon) can backfill discovery rather
// than waiting for organic crawl. After this runs, ongoing freshness is
// handled by lib/indexnow.ts on every admin save — this script is for
// the one-time catch-up against the existing corpus.
//
// Usage:
//   INDEXNOW_KEY=<prod-key> pnpm indexnow:submit-sitemap --dry-run
//   INDEXNOW_KEY=<prod-key> pnpm indexnow:submit-sitemap
//
// The key MUST match the value Render serves at https://archoslabs.xyz/{key}.txt
// otherwise engines respond 422 and the submission is wasted.

import process from "node:process";

const HOST = "archoslabs.xyz";
const SITEMAP_URL = `https://${HOST}/sitemap.xml`;
const ENDPOINT = "https://api.indexnow.org/indexnow";
const BATCH_SIZE = 10_000;

const dryRun = process.argv.includes("--dry-run");

const key = process.env.INDEXNOW_KEY?.trim();
if (!key) {
  console.error(
    "INDEXNOW_KEY env var is required. Example:\n" +
      "  INDEXNOW_KEY=<value> pnpm indexnow:submit-sitemap --dry-run",
  );
  process.exit(1);
}
if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) {
  console.error(
    `INDEXNOW_KEY format invalid (len=${key.length}). Must be 8-128 chars [a-zA-Z0-9-].`,
  );
  process.exit(1);
}

console.log(`Fetching ${SITEMAP_URL}...`);
const sitemapRes = await fetch(SITEMAP_URL);
if (!sitemapRes.ok) {
  console.error(`Sitemap fetch failed: HTTP ${sitemapRes.status}`);
  process.exit(1);
}
const xml = await sitemapRes.text();

// Match only <url><loc>...</loc> blocks (page URLs). Skips <image:loc>
// which holds R2 image asset URLs — those aren't pages and would be
// rejected by IndexNow as off-host.
const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
const urls = new Set();
for (const block of urlBlocks) {
  const m = block.match(/<loc>([^<]+)<\/loc>/);
  if (!m) continue;
  const candidate = m[1].trim();
  try {
    const parsed = new URL(candidate);
    if (parsed.host === HOST) urls.add(candidate);
  } catch {
    // ignore non-URL noise
  }
}

const urlList = [...urls];
console.log(`Found ${urlList.length} ${HOST} URLs in sitemap.`);

if (urlList.length === 0) {
  console.error("No URLs to submit. Sitemap may be malformed.");
  process.exit(1);
}

if (dryRun) {
  console.log("\n--- DRY RUN: first 10 URLs ---");
  urlList.slice(0, 10).forEach((u) => console.log(`  ${u}`));
  if (urlList.length > 10) console.log(`  ... and ${urlList.length - 10} more`);
  console.log("\nNo submission sent. Re-run without --dry-run to submit.");
  process.exit(0);
}

let submitted = 0;
for (let i = 0; i < urlList.length; i += BATCH_SIZE) {
  const batch = urlList.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key, urlList: batch }),
  });
  const ok = res.status === 200 || res.status === 202;
  console.log(
    `Batch ${batchNum}: ${batch.length} URLs -> HTTP ${res.status} ${ok ? "OK" : "FAILED"}`,
  );
  if (!ok) {
    const body = await res.text().catch(() => "");
    console.error(`Response body: ${body.slice(0, 500)}`);
    process.exit(1);
  }
  submitted += batch.length;
}

console.log(
  `\nSubmitted ${submitted} URLs to IndexNow. Engines will fetch the ` +
    `keyfile to verify ownership, then process. Bing Webmaster -> ` +
    `Configure My Site -> IndexNow should show activity within ~1 hour.`,
);
