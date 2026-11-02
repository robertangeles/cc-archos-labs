// The photo step: a brief for one editorial photograph, then the picture.
//
// Three problems shaped it, each seen in real runs:
//   - The brief writer converged: it picked a stopwatch and a sprinter twice in a
//     row. So the SUBJECT is assigned by code from a rotation, and the clichés are
//     banned by name. Asking a model to vary does not work.
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

// Physical, plausible, face-free, number-free. Rotated by code; the brief writer does
// not choose and cannot converge on one.
export const PHOTO_SUBJECTS = [
  "a surveyor's tripod and measuring staff on an empty road",
  "a long archive corridor of identical filing boxes with one box pulled halfway out",
  "a single open door in a long blank wall at dusk",
  "a harbour at dawn with rows of identical shipping containers and one standing open",
  "a weather station on a bare hilltop under flat grey cloud",
  "an old beam balance on a plain wooden bench, its two pans at different heights",
  "an empty control-room desk with a bank of unlit monitors",
  "a thick cable bundle running into a bare concrete wall",
  "an empty lecture hall with one chair turned to face the back wall",
  "a footbridge that ends in mid-air over still water at dawn",
  "a row of identical mailboxes on a country road with one hanging open",
  "a drawing table with a ruler laid across blank paper and a pencil resting mid-line",
] as const;

export const PHOTO_BANNED = [
  "stopwatch", "sprinter", "runner", "finish line", "chess", "light bulb", "lightbulb", "handshake",
  "magnifying glass", "robot", "circuit board", "question mark", "hourglass", "glowing",
] as const;

/** Stride 5 against 12 subjects visits all of them before repeating. */
export function pickSubject(seed: number): string {
  const n = PHOTO_SUBJECTS.length;
  const i = ((Math.trunc(seed) * 5) % n + n) % n;
  return PHOTO_SUBJECTS[i];
}

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

// Camera settings and the frame's aspect ratio are numbers that belong in a brief and
// never reach the picture.
const CAMERA = /\b\d+(?:\.\d+)?\s?mm\b|\bf\/\d+(?:\.\d+)?\b|\bISO\s?\d+\b|\b\d{1,2}:\d{1,2}\b/gi;

export function checkBrief(scene: string, alt: string): string[] {
  const problems: string[] = [];
  if (scene.length < 250 || scene.length > 1800) problems.push(`length is ${scene.length} characters, it must be 250 to 1800`);
  if (/\d/.test(scene.replace(CAMERA, " "))) problems.push("it contains numerals (only lens, aperture, ISO and aspect-ratio figures are allowed); describe the scene without any number");
  const lower = scene.toLowerCase();
  const banned = PHOTO_BANNED.filter((w) => new RegExp(`\\b${w.replace(/\s+/g, "\\s+")}`).test(lower));
  if (banned.length) problems.push(`it uses banned clichés: ${banned.join(", ")}`);
  if (alt.trim().length === 0) problems.push("the alt text is empty");
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

export async function runPhoto(
  deps: PhotoDeps,
  cfg: DraftConfig,
  input: { article: string; seed: number },
): Promise<PhotoResult> {
  const steps: StepLog[] = [];
  const fail = (note: string): PhotoResult => ({ ok: false, note, steps });
  const subject = pickSubject(input.seed);

  let brief: { scene: string; alt: string } | null = null;
  let problems: string[] = [];
  for (const label of ["photo_brief", "photo_brief_retry"] as const) {
    try {
      const { res, step } = await runSkill(deps, {
        slug: PHOTO_SKILL,
        label,
        model: cfg.models.photoBrief,
        inputs: {
          plain: { subject_family: subject, banned: PHOTO_BANNED.join(", ") },
          untrusted: { article: input.article },
          ...(problems.length ? { appendix: { heading: "PROBLEMS WITH YOUR PREVIOUS BRIEF. Write it again and fix every one:", text: problems.map((p) => `- ${p}`).join("\n") } } : {}),
        },
        maxTokens: 4000,
      });
      steps.push(step);
      brief = parsePhotoBrief(res.text);
      problems = brief ? checkBrief(brief.scene, brief.alt) : ["the answer must be one paragraph followed by a line starting 'Alt Text:'"];
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
