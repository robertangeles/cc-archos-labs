// Regenerate public/images/blog-fallback.webp — the illustration a post gets
// when its own generation fails.
//
//   node --env-file=.env.local scripts/generate-blog-fallback-image.mjs
//
// Run this only when the house style in lib/blog-agent/parse-image-prompt.ts
// changes. The output is committed, so the fallback never costs a model call at
// runtime and never varies between posts. LOOK AT THE RESULT before committing
// it: this one image stands in for every article whose illustration failed.
//
// The style block below is a copy of ILLUSTRATION_STYLE + ILLUSTRATION_COMPOSITION.
// It is duplicated rather than imported because those live in a TypeScript
// module and this is a plain node script run outside the build.

import { writeFileSync } from "node:fs";
import sharp from "sharp";

const KEY = process.env.OPENROUTER_API_KEY;
const OUT = "public/images/blog-fallback.webp";
const TARGET_RATIO = 2.9;

// Deliberately subject-less. It stands in for ANY article, so a scene that
// implies a topic would be wrong more often than it is right.
const PROMPT = `A contemporary conceptual editorial illustration of the kind that opens a serious magazine feature. Clean flat vector shapes with crisp geometric edges and no outlines. Smooth, restrained gradients used only for atmosphere and depth — never texture, never grain, never halftone, never visible brushwork, never paper.

The scene is dim and cool, and a single hard-edged beam or wedge of warm light cuts across it at a diagonal. That light is the drama: it has sharp straight boundaries like a spotlight through darkness, and it decides what the eye reads first.

Deep, sophisticated, slightly desaturated palette — navy, deep teal, dusty rose, muted purple, ochre — against one warm light source. Elevated three-quarter viewpoint looking down into the space, with real perspective and receding depth.

A single small anonymous human figure, simplified, no facial detail, seen from behind, dwarfed by the space. The mood is quiet and slightly unsettling. Never comic, never satirical, never caricatured, never cute. No photorealism, no 3D render, no glow effects.

A vast empty hall at night with a bare polished floor. The figure stands alone, well off to one side. One tall doorway in the far wall throws a single clean wedge of warm light diagonally across the floor. Nothing else is in the room.

Composed as an ultra-wide cinematic banner, full bleed: the illustration fills the entire frame edge to edge, with no border, no margin, no mat and no frame around it. The figure sits small and off-centre with generous empty space around them; the important shapes stay within the central horizontal band, clear of the top and bottom edges which will be trimmed. No text, lettering or numerals anywhere. No sparkles, stars or decorative flourishes.`;

if (!KEY) {
  console.error("OPENROUTER_API_KEY is not set. Pass --env-file=.env.local");
  process.exit(1);
}

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "google/gemini-3.1-flash-image-preview",
    messages: [{ role: "user", content: PROMPT }],
    modalities: ["image", "text"],
    image_config: { aspect_ratio: "21:9", image_size: "2K" },
  }),
});
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

const json = await res.json();
const url = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
if (!url?.startsWith("data:")) {
  console.error("No image returned.");
  process.exit(1);
}
const raw = Buffer.from(url.split(",")[1], "base64");

// Same white-matte trim lib/blog-agent/image.ts applies, for the same reason:
// this prompt asks for full bleed and the model still added a border once.
let src = raw;
const before = await sharp(raw).metadata();
try {
  const trimmed = await sharp(raw)
    .trim({ background: "#ffffff", threshold: 15 })
    .toBuffer();
  const after = await sharp(trimmed).metadata();
  const keep =
    after.width >= before.width * 0.8 && after.height >= before.height * 0.8;
  if (keep) src = trimmed;
  console.log(
    `trim: ${before.width}x${before.height} -> ${after.width}x${after.height}` +
      (keep ? "" : " (rejected by the 80% guard)"),
  );
} catch {
  console.log("trim: skipped (uniform image)");
}

const meta = await sharp(src).metadata();
const height = Math.round(meta.width / TARGET_RATIO);
const out = await sharp(src)
  .extract({
    left: 0,
    top: Math.floor((meta.height - height) / 2),
    width: meta.width,
    height,
  })
  .webp({ quality: 88 })
  .toBuffer();

writeFileSync(OUT, out);
const final = await sharp(out).metadata();
console.log(
  `${OUT}: ${final.width}x${final.height} ` +
    `(ratio ${(final.width / final.height).toFixed(3)}) ${Math.round(out.length / 1024)}KB`,
);
console.log("\nOpen it and look at it before committing.");
