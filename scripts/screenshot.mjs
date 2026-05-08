import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Defaults are tuned to stay under the 2000px many-image attachment limit
// when screenshots are shared back into a Claude conversation.
//   - deviceScaleFactor: 1  (was 2 — 1280px viewport stayed 1280px output)
//   - fullPage: false       (was true — long pages doubled height past 2000)
//
// Override via CLI:
//   node scripts/screenshot.mjs <url> <out> <width> <height> [--full] [--dpi=N]
//
// --full  : capture the full scrollable page (height may exceed 2000px)
// --dpi=N : set deviceScaleFactor (default 1; image dimensions multiply by N)

const flags = process.argv.filter((a) => a.startsWith("--"));
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const url = positional[0] ?? "http://localhost:3007";
const out = positional[1] ?? "screenshots/page.png";
const width = Number(positional[2] ?? 1280);
const height = Number(positional[3] ?? 800);

const fullPage = flags.includes("--full");
const dpiFlag = flags.find((f) => f.startsWith("--dpi="));
const deviceScaleFactor = dpiFlag ? Number(dpiFlag.split("=")[1]) : 1;

const widthPx = width * deviceScaleFactor;
const heightPx = height * deviceScaleFactor;

if (!fullPage && Math.max(widthPx, heightPx) > 2000) {
  console.warn(
    `warning: output ${widthPx}x${heightPx} exceeds the 2000px many-image limit`,
  );
}
if (fullPage) {
  console.warn(
    "warning: --full enabled; output height may exceed 2000px on tall pages",
  );
}

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor,
});
const page = await context.newPage();
await page.goto(url, { waitUntil: "networkidle" });

const computed = await page.evaluate(() => {
  const pick = (sel, props) => {
    const el = document.querySelector(sel);
    if (!el) return { error: `no element matched ${sel}` };
    const cs = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
  };
  return {
    body: pick("body", ["background-color", "color", "font-family"]),
    h1: pick("h1", ["color", "font-family", "font-size"]),
    link: pick("a", ["color", "text-decoration-color"]),
  };
});

await page.screenshot({ path: out, fullPage });
await browser.close();

console.log(
  `saved ${out} at ${width}x${height} (dpi=${deviceScaleFactor}, fullPage=${fullPage})`,
);
console.log(JSON.stringify(computed, null, 2));
