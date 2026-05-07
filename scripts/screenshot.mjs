import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const url = process.argv[2] ?? "http://localhost:3007";
const out = process.argv[3] ?? "screenshots/page.png";
const width = Number(process.argv[4] ?? 1280);
const height = Number(process.argv[5] ?? 800);

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 2,
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

await page.screenshot({ path: out, fullPage: true });
await browser.close();

console.log(`saved ${out} at ${width}x${height}`);
console.log(JSON.stringify(computed, null, 2));
