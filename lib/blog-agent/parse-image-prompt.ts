// Pure normaliser for the illustration step's output. No DB, no network.
//
// Two jobs, and the split matters:
//
//  - The SKILL decides the *concept* — where the figure stands, where the light
//    comes from, what is impossible about the scene. That lives in the DB so it
//    can be tuned in the Workflows UI without a deploy.
//  - This module supplies the *style*, which must NOT drift across ninety
//    posts, and cleans up whatever the skill actually emitted.
//
// The parser accepts two shapes on purpose. The new skill emits `SCENE:`/`ALT:`.
// The original `archos-stephan-schmitz-image` skill (kept for manual use) emits
// prose ending in Midjourney flags plus an `Alt Text:` line. Gemini reads
// `--ar 289:100 --stylize 500 --raw --v 7.0 --q 2` as prose, and naming a living
// artist is both unreliable and something Google's guidance discourages, so both
// are stripped here rather than trusted to a prompt.
//
// Derived from the 3 real `image_prompt` outputs in workflow_execution_run
// (lib/blog-agent/__fixtures__/real-image-prompts.json).

import { capMeta } from "./parse-draft";

/**
 * The house illustration style. Locked, and deliberately not configurable.
 *
 * Every clause is something visible in the reference set the style was chosen
 * from, described as a production fact rather than as an adjective — Gemini
 * defaults hard to photorealism and loses "flat" to "realistic" every time,
 * but it holds a described light source and a described viewpoint reliably.
 *
 * Validated by generating candidates and looking at them, not by argument.
 */
export const ILLUSTRATION_STYLE = `A contemporary conceptual editorial illustration of the kind that opens a serious magazine feature. Clean flat vector shapes with crisp geometric edges and no outlines. Smooth, restrained gradients used only for atmosphere and depth — never texture, never grain, never halftone, never visible brushwork, never paper.

The scene is dim and cool, and a single hard-edged beam or wedge of warm light cuts across it at a diagonal. That light is the drama: it has sharp straight boundaries like a spotlight through darkness, and it decides what the eye reads first.

Deep, sophisticated, slightly desaturated palette — navy, deep teal, dusty rose, muted purple, ochre — against one warm light source. Elevated three-quarter viewpoint looking down into the space, with real perspective and receding depth.

A single small anonymous human figure, simplified, no facial detail, usually seen from behind, dwarfed by the space around them. The mood is quiet and slightly unsettling. Never comic, never satirical, never caricatured, never cute. No photorealism, no 3D render, no glow effects.`;

/**
 * Framing note appended to every prompt.
 *
 * The full-bleed clause is not decoration: one test render came back matted
 * inside a white border like a framed print, which would read as broken in a
 * 29:10 featured-image slot. The no-text clause is belt-and-braces — the skill
 * is also told not to describe anything readable, because Gemini renders
 * legible text when a scene implies it.
 */
export const ILLUSTRATION_COMPOSITION = `Composed as an ultra-wide cinematic banner, full bleed: the illustration fills the entire frame edge to edge, with no border, no margin, no mat and no frame around it. The figure sits small and off-centre with generous empty space around them; the important shapes stay within the central horizontal band, clear of the top and bottom edges which will be trimmed. No text, lettering or numerals anywhere. No sparkles, stars or decorative flourishes.`;

/**
 * Settings the illustration can be staged in, supplied to the skill rather than
 * chosen by it.
 *
 * Asking a model for variety does not work: told to consider three settings and
 * discard the obvious one, three independent runs still picked a warehouse, and
 * an earlier revision picked a ruler three times out of three. Rotating
 * deterministically is free, testable, and cannot converge.
 *
 * Every entry is explicitly bare. Clutter beat the concept in testing — the
 * clearest images were an almost-empty room where one repeated element is
 * lit wrongly, and the muddiest was a warehouse full of beams and railings.
 */
export const ILLUSTRATION_PLACES = [
  "a vast empty hotel lobby at night, bare polished floor, no furniture",
  "an empty underground car park, bare concrete, no cars",
  "an empty theatre auditorium seen from the stage, rows of identical seats",
  "a bare municipal swimming pool hall at night, still water",
  "an empty open-plan floor of an office tower, bare carpet, floor-to-ceiling glass",
  "a wide bare stairwell landing in a concrete building",
  "an empty airport gate lounge at night, identical seats, dark glass wall",
  "a flat open field at dusk under a wide sky, nothing but grass",
  "a bare rooftop at dusk, low parapet, open sky",
  "an empty warehouse floor, bare concrete, nothing stored in it",
  "a long empty corridor with identical closed doors down one side",
  "an empty gallery room with bare white walls and a polished floor",
] as const;

/**
 * Pick a setting for a given queue position.
 *
 * A stride coprime with the list length walks the whole list before repeating,
 * so consecutive posts never share a setting and post 1 and post 13 do not
 * collide either — 12 and 5 share no factors, so the cycle is the full 12.
 */
export function pickPlace(seed: number): string {
  const n = ILLUSTRATION_PLACES.length;
  const i = (((Math.trunc(seed) * 5) % n) + n) % n;
  return ILLUSTRATION_PLACES[i];
}

export interface ParsedImagePrompt {
  /** The concept, stripped of style words, tool flags and artist names. */
  scene: string;
  /** Capped at 125 chars — the limit the image upload path expects. */
  altText: string;
}

/** `--ar 289:100`, `--stylize 500`, `--raw`, `--v 7.0`, `--q 2`. */
const MIDJOURNEY_FLAG = /\s*--[a-z]+(?:\s+[\w.:/]+)?/gi;

/** Leading "An editorial illustration in the style of <artist>." sentence. */
const STYLE_PREAMBLE = /^\s*an?\s+editorial illustration[^.]*\.\s*/i;

/** Any remaining "in the style of X" attribution, wherever it appears. */
const ARTIST_ATTRIBUTION = /\s*,?\s*\bin the style of\s+[^.,;]+/gi;

/** Both alt-text forms observed in real output, plus the new skill's `ALT:`. */
const ALT_MARKERS = [
  /^[^\S\n]*ALT:[^\S\n]*(.+)$/im,
  /\*\*\s*Alt Text:?\s*\*\*[^\S\n]*(.+)/i,
  /\bAlt Text:[^\S\n]*(.+)/i,
];

/**
 * Normalise one `image_prompt` into a scene and alt text.
 *
 * Returns `null` when there is no usable scene. The caller must treat that as
 * "no image" and fall back rather than sending an empty prompt to a paid image
 * model, which would bill for and return something arbitrary.
 */
export function parseImagePrompt(raw: string): ParsedImagePrompt | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  // --- Alt text, and where the scene ends ----------------------------------
  let altText = "";
  let sceneEnd = text.length;
  for (const re of ALT_MARKERS) {
    const m = text.match(re);
    if (m && m.index !== undefined) {
      altText = m[1].trim();
      sceneEnd = Math.min(sceneEnd, m.index);
      break;
    }
  }

  // --- Scene ---------------------------------------------------------------
  let scene = text.slice(0, sceneEnd);

  // The new skill labels it; the old one does not.
  const labelled = scene.match(/^[^\S\n]*SCENE:[^\S\n]*([\s\S]*)$/im);
  if (labelled) scene = labelled[1];

  scene = scene
    .replace(MIDJOURNEY_FLAG, "")
    .replace(STYLE_PREAMBLE, "")
    .replace(ARTIST_ATTRIBUTION, "")
    // Backticks that wrapped the stripped flags, now empty.
    .replace(/`+/g, "")
    // Tidy the punctuation the removals left behind: " ." and doubled commas.
    .replace(/\s+([.,;])/g, "$1")
    .replace(/([.,;])\1+/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!scene) return null;

  return {
    scene,
    // Never trusted to the prompt: real output came back at 147, 214 and 144
    // characters against a stated 125 limit, in three runs out of three.
    altText: altText ? capMeta(altText, 125) : "",
  };
}

/**
 * Assemble the full prompt sent to the image model: locked style, the skill's
 * concept, then framing. The concept sits in the middle because that is the
 * part that changes; the two constants bracket it identically every time.
 */
export function buildImagePrompt(scene: string): string {
  return `${ILLUSTRATION_STYLE}\n\n${scene.trim()}\n\n${ILLUSTRATION_COMPOSITION}`;
}
