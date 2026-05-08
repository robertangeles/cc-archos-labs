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
// --full          : capture the full scrollable page (height may exceed 2000px)
// --dpi=N         : set deviceScaleFactor (default 1; image dimensions multiply by N)
// --click=<sel>   : click the given CSS selector after page load, before capture
//                   (use to expose hover/menu state before screenshotting)
// --cookie=k=v    : set a cookie before navigation. Use multiple --cookie flags
//                   to set more than one. (Use to capture authenticated routes.)

const flags = process.argv.filter((a) => a.startsWith("--"));
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const url = positional[0] ?? "http://localhost:3007";
const out = positional[1] ?? "screenshots/page.png";
const width = Number(positional[2] ?? 1280);
const height = Number(positional[3] ?? 800);

const fullPage = flags.includes("--full");
const dpiFlag = flags.find((f) => f.startsWith("--dpi="));
const deviceScaleFactor = dpiFlag ? Number(dpiFlag.split("=")[1]) : 1;
const clickFlag = flags.find((f) => f.startsWith("--click="));
const clickSelector = clickFlag ? clickFlag.slice("--click=".length) : null;
const cookieFlags = flags.filter((f) => f.startsWith("--cookie="));
const cookies = cookieFlags
  .map((f) => f.slice("--cookie=".length))
  .map((kv) => {
    const eq = kv.indexOf("=");
    if (eq < 0) return null;
    return { name: kv.slice(0, eq), value: kv.slice(eq + 1) };
  })
  .filter((c) => c !== null);

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
if (cookies.length > 0) {
  const u = new URL(url);
  await context.addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: u.hostname,
      path: "/",
      httpOnly: false,
      secure: u.protocol === "https:",
      sameSite: "Lax",
    })),
  );
}

const page = await context.newPage();
await page.goto(url, { waitUntil: "networkidle" });

if (clickSelector) {
  await page.click(clickSelector);
  // Wait for transitions/animations to settle before capture.
  await page.waitForTimeout(200);
}

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
