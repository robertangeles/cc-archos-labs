// The photo step: a brief for one editorial photograph, then the picture.
//
// Four problems shaped it, each seen in real runs:
//   - The brief writer converged: it picked a stopwatch and a sprinter twice in a
//     row. So the clichés are banned by name.
//   - A fixed rotation of 12 scenes fixed that and then repeated: 26 posts showed 12
//     pictures, each twice, and readers noticed. The subject now comes from the
//     article, and the writer is shown the pictures already on the site. Asking a
//     model to vary does not work on its own, so a brief whose subject repeats one of
//     them is sent back, like a brief with numerals.
//   - It printed "9.87" on a stopwatch face. So a brief that contains numerals (other
//     than lens, aperture and ISO figures) is sent back once.
//   - Image models take 60 to 110 s. So the render waits up to 3 minutes.
//
// An image is never worth losing a post over. Every failure here is a note and the
// draft is made without a picture, which Rob adds in the editor.

import type { DraftConfig } from "./config";
import { LlmError } from "./llm";
import { runSkill, type StageDeps } from "./stage";
import type { StepLog } from "./types";

export const PHOTO_SKILL = "archos-editorial-photo";

export const PHOTO_BANNED = [
  "stopwatch", "sprinter", "runner", "finish line", "chess", "light bulb", "lightbulb", "handshake",
  "magnifying glass", "robot", "circuit board", "question mark", "hourglass", "glowing",
] as const;

const PHOTO_TAIL = " A photograph, not an illustration. No text, lettering, numerals or logos anywhere in the frame. No recognisable faces.";

export function parsePhotoBrief(text: string): { scene: string; alt: string } | null {
  const m = /\n\s*(?:alt text|alt)\s*:\s*([^\n]+)/i.exec(`\n${text}`);
  if (!m) return null;
  const alt = m[1].replace(/[`"]/g, "").trim();
  const before = `\n${text}`.slice(0, m.index).trim();
  const scene = before
    .replace(/^\s*scene\s*:\s*/i, "")
    .replace(/\n\s*alt\s*:[^\n]*$/i, "")
    .replace(/^[`"]+|[`"]+$/g, "")
    .trim();
  if (!scene || !alt) return null;
  return { scene, alt };
}

// How many pictures the writer is shown: about ten days at three posts a day.
export const RECENT_PICTURES = 30;

// Two alt texts show the same subject when they share this many content words. Measured on
// the 26 pictures the pipeline published: every same-subject pair but one shares 3 or more,
// no different-subject pair shares more than 2.
// shortcut: a word-overlap heuristic, not meaning; a repeat in different words gets
// through, so the prompt still lists the recent pictures. Upgrade to embeddings if repeats come back.
const SAME_SUBJECT_WORDS = 3;

// Words every scene shares (light, sky, "empty") and function words; they say nothing about the subject.
const GENERIC = new Set(
  ("with from that this into onto over under above below toward across along while where which their there than then them they have been being " +
    "empty single grey gray overcast light dawn dusk morning afternoon late wide bare blank identical open long standing sky shadow cast casting tone cool low angle").split(" "),
);

function subjectWords(alt: string): Set<string> {
  const words = (alt.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
  return new Set(words.filter((w) => !GENERIC.has(w)));
}

/** The recent alt text that shows the same subject as this one, or null. */
export function repeatsRecent(alt: string, recent: string[]): string | null {
  const mine = subjectWords(alt);
  return recent.find((r) => [...subjectWords(r)].filter((w) => mine.has(w)).length >= SAME_SUBJECT_WORDS) ?? null;
}

/** The alt text of each stored brief (a photo_brief step's output), in the order given. */
export function recentAlts(briefs: string[]): string[] {
  return briefs.flatMap((b) => parsePhotoBrief(b)?.alt ?? []);
}

// Camera settings and the frame's aspect ratio are numbers that belong in a brief and
// never reach the picture.
const CAMERA = /\b\d+(?:\.\d+)?\s?mm\b|\bf\/\d+(?:\.\d+)?\b|\bISO\s?\d+\b|\b\d{1,2}:\d{1,2}\b/gi;

export function checkBrief(scene: string, alt: string, recent: string[] = []): string[] {
  const problems: string[] = [];
  if (scene.length < 250 || scene.length > 1800) problems.push(`length is ${scene.length} characters, it must be 250 to 1800`);
  if (/\d/.test(scene.replace(CAMERA, " "))) problems.push("it contains numerals (only lens, aperture, ISO and aspect-ratio figures are allowed); describe the scene without any number");
  const lower = scene.toLowerCase();
  const banned = PHOTO_BANNED.filter((w) => new RegExp(`\\b${w.replace(/\s+/g, "\\s+")}`).test(lower));
  if (banned.length) problems.push(`it uses banned clichés: ${banned.join(", ")}`);
  if (alt.trim().length === 0) problems.push("the alt text is empty");
  const same = repeatsRecent(alt, recent);
  if (same) problems.push(`its subject repeats a picture already on the site ("${same}"); choose a different physical subject from the article, not the same one lit or framed differently`);
  return problems;
}

export interface PhotoDeps extends StageDeps {
  generateImage: (
    prompt: string,
    opts: { model: string; aspectRatio: "21:9"; imageSize: "2K"; timeoutMs: number },
  ) => Promise<{ imageUrl: string }>;
}

export type PhotoResult =
  | { ok: true; buffer: Buffer; alt: string; scene: string; steps: StepLog[] }
  | { ok: false; note: string; steps: StepLog[] };

const MIN_IMAGE_BYTES = 20_000;
const RENDER_TIMEOUT_MS = 180_000;

// The recent pictures are in every request's appendix, so the skill's own text does not
// have to name them; on a retry the problems come first.
const RECENT_HEADING = "PICTURES ALREADY ON THE SITE (alt texts). Yours must show a different subject from every one of these:";
function appendixFor(problems: string[], recentList: string): { appendix?: { heading: string; text: string } } {
  if (problems.length > 0) {
    const list = problems.map((p) => `- ${p}`).join("\n");
    return { appendix: { heading: "PROBLEMS WITH YOUR PREVIOUS BRIEF. Write it again and fix every one:", text: recentList ? `${list}\n\nPictures already on the site, which yours must not repeat:\n${recentList}` : list } };
  }
  return recentList ? { appendix: { heading: RECENT_HEADING, text: recentList } } : {};
}

export async function runPhoto(
  deps: PhotoDeps,
  cfg: DraftConfig,
  input: { article: string; /** The stored output of recent photo_brief steps, newest first. */ recentBriefs: string[] },
): Promise<PhotoResult> {
  const steps: StepLog[] = [];
  const fail = (note: string): PhotoResult => ({ ok: false, note, steps });
  const recent = recentAlts(input.recentBriefs).slice(0, RECENT_PICTURES);
  const recentList = recent.map((a) => `- ${a}`).join("\n");

  let brief: { scene: string; alt: string } | null = null;
  let problems: string[] = [];
  for (const label of ["photo_brief", "photo_brief_retry"] as const) {
    try {
      const { res, step } = await runSkill(deps, {
        slug: PHOTO_SKILL,
        label,
        model: cfg.models.photoBrief,
        inputs: {
          plain: { banned: PHOTO_BANNED.join(", ") },
          untrusted: { article: input.article },
          ...(appendixFor(problems, recentList)),
        },
        maxTokens: 4000,
      });
      steps.push(step);
      brief = parsePhotoBrief(res.text);
      problems = brief ? checkBrief(brief.scene, brief.alt, recent) : ["the answer must be one paragraph followed by a line starting 'Alt Text:'"];
      if (problems.length === 0) break;
    } catch (err) {
      if (err instanceof LlmError) return fail(`photo brief failed: ${err.message}`);
      throw err;
    }
  }
  if (!brief || problems.length > 0) return fail(`photo brief rejected: ${problems.join("; ")}`);

  const t0 = Date.now();
  try {
    const { imageUrl } = await deps.generateImage(`${brief.scene}${PHOTO_TAIL}`, {
      model: cfg.models.image,
      aspectRatio: "21:9",
      imageSize: "2K",
      timeoutMs: RENDER_TIMEOUT_MS,
    });
    const m = /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(imageUrl);
    if (!m) throw new Error("the image model did not return image data");
    const buffer = Buffer.from(m[1], "base64");
    if (buffer.length < MIN_IMAGE_BYTES) throw new Error(`the image is only ${buffer.length} bytes`);
    steps.push({ stepKey: "image", status: "ok", output: JSON.stringify({ bytes: buffer.length }), model: cfg.models.image, inputTokens: null, outputTokens: null, costUsd: null, durationMs: Date.now() - t0 });
    return { ok: true, buffer, alt: brief.alt, scene: brief.scene, steps };
  } catch (err) {
    const note = `image failed: ${err instanceof Error ? err.message : "unknown error"}`.slice(0, 200);
    steps.push({ stepKey: "image", status: "failed", output: note, model: cfg.models.image, inputTokens: null, outputTokens: null, costUsd: null, durationMs: Date.now() - t0 });
    return fail(note);
  }
}
