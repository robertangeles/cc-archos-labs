import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DRAFT_CONFIG } from "./config";
import { LlmError, type ChatRequest, type ChatResult, type Llm } from "./llm";
import { checkBrief, parsePhotoBrief, pickSubject, PHOTO_BANNED, PHOTO_SUBJECTS, runPhoto, type PhotoDeps } from "./photo";
import type { SkillPrompt } from "./skills";

// Two facts shaped this module. The brief writer picked "a stopwatch and a sprinter"
// twice in a row, so the subject is assigned by code. And it printed "9.87" on the
// stopwatch face, so a brief that contains numerals is sent back.

const SCENE =
  "A weathered surveyor's tripod stands at the edge of an empty gravel road at dawn, a measuring staff leaning against it, the road vanishing into low flat fog. " +
  "Shot low with a 35mm lens at f/2.8, soft overcast light from the east, desaturated blues and greys, the tripod in the left third with generous empty space to the right for a wide 21:9 frame.";
const ALT = "A surveyor's tripod and measuring staff on an empty road at dawn.";
const BRIEF = `${SCENE}\n\nAlt Text: ${ALT}`;

const chat = (text: string): ChatResult => ({ text, model: "m", inputTokens: 5, outputTokens: 9, costUsd: 0.003, citations: [], durationMs: 4 });
const PHOTO_SKILL_ROW: SkillPrompt = {
  slug: "archos-editorial-photo",
  system: "You are a photo editor.",
  template: "Subject: {{subject_family}}\nNever: {{banned}}\nArticle:\n{{article}}",
  temperature: null,
  maxTokens: null,
};

const PNG = `data:image/png;base64,${Buffer.alloc(60_000, 7).toString("base64")}`;
const build = (briefs: (string | Error)[], image: (() => Promise<{ imageUrl: string }>) | null = async () => ({ imageUrl: PNG })) => {
  const calls: ChatRequest[] = [];
  const queue = [...briefs];
  const llm: Llm = async (req) => {
    calls.push(req);
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected brief call");
    if (next instanceof Error) throw next;
    return chat(next);
  };
  const impl = image ?? (async () => ({ imageUrl: PNG }));
  const generateImage = vi.fn<PhotoDeps["generateImage"]>(async () => impl());
  const deps: PhotoDeps = { llm, skill: async () => PHOTO_SKILL_ROW, generateImage };
  return { deps, calls, generateImage };
};
const ARTICLE = "A fact-check of a headline about Qwen and Cohere.";
const run = (deps: PhotoDeps, seed = 0) => runPhoto(deps, DEFAULT_DRAFT_CONFIG, { article: ARTICLE, seed });

describe("pickSubject", () => {
  it("rotates through every subject before it repeats", () => {
    const seen = new Set(Array.from({ length: PHOTO_SUBJECTS.length }, (_, i) => pickSubject(i)));
    expect(seen.size).toBe(PHOTO_SUBJECTS.length);
  });

  it("is deterministic and survives negative and huge seeds", () => {
    expect(pickSubject(7)).toBe(pickSubject(7));
    expect(PHOTO_SUBJECTS).toContain(pickSubject(-3));
    expect(PHOTO_SUBJECTS).toContain(pickSubject(10 ** 9 + 7));
  });

  it("no subject contains a banned cliché, a person or a number", () => {
    for (const s of PHOTO_SUBJECTS) {
      expect(s).not.toMatch(/\d/);
      expect(s.toLowerCase()).not.toMatch(new RegExp(PHOTO_BANNED.map((w) => w.replace(/\s+/g, "\\s+")).join("|")));
    }
  });
});

describe("parsePhotoBrief", () => {
  it("splits the scene from the alt text", () => {
    expect(parsePhotoBrief(BRIEF)).toEqual({ scene: SCENE, alt: ALT });
  });

  it("strips a SCENE: label and wrapping backticks or quotes", () => {
    expect(parsePhotoBrief(`SCENE: ${SCENE}\nALT: x\nAlt Text: ${ALT}`)!.scene.startsWith("A weathered")).toBe(true);
  });

  it("accepts ALT: as well", () => {
    expect(parsePhotoBrief(`${SCENE}\nALT: ${ALT}`)!.alt).toBe(ALT);
  });

  it("returns null with no alt text or no scene", () => {
    expect(parsePhotoBrief(SCENE)).toBeNull();
    expect(parsePhotoBrief(`Alt Text: ${ALT}`)).toBeNull();
  });
});

describe("checkBrief", () => {
  it("accepts a good brief, camera numbers included", () => {
    expect(checkBrief(SCENE, ALT)).toEqual([]);
  });

  it("rejects numerals that would be printed in the picture", () => {
    expect(checkBrief(SCENE.replace("empty gravel road", "empty road with a sign reading 9.87"), ALT).join()).toMatch(/numerals/);
  });

  it("allows lens, aperture, ISO and aspect-ratio figures but not other numbers", () => {
    expect(checkBrief(`${SCENE} ISO 400, an 85mm lens, f/1.8, framed 16:9.`, ALT)).toEqual([]);
    expect(checkBrief(`${SCENE} There are 3 doors.`, ALT).join()).toMatch(/numerals/);
  });

  it.each(PHOTO_BANNED)("rejects the cliché %s", (word) => {
    expect(checkBrief(`${SCENE} A ${word} sits in the foreground.`, ALT).join()).toMatch(/cliché|banned/i);
  });

  it("rejects a brief that is too short or far too long", () => {
    expect(checkBrief("A room.", ALT).join()).toMatch(/length/);
    expect(checkBrief("x ".repeat(1500), ALT).join()).toMatch(/length/);
  });

  it("rejects empty alt text", () => {
    expect(checkBrief(SCENE, "  ").join()).toMatch(/alt/i);
  });
});

describe("runPhoto", () => {
  it("writes a brief, renders it and returns the picture with its alt text", async () => {
    const { deps } = build([BRIEF]);
    const r = await run(deps);
    expect(r).toMatchObject({ ok: true, alt: ALT, scene: SCENE });
    if (r.ok) {
      expect(r.buffer.length).toBe(60_000);
      expect(r.steps.map((s) => s.stepKey)).toEqual(["photo_brief", "image"]);
    }
  });

  it("assigns the subject and bans the clichés in the prompt, and fences the article", async () => {
    const { deps, calls } = build([BRIEF]);
    await run(deps, 3);
    expect(calls[0].user).toContain(pickSubject(3));
    expect(calls[0].user).toContain("stopwatch");
    expect(calls[0].user).toMatch(/<<<UNTRUSTED_[0-9a-f-]+\nA fact-check of a headline/);
    expect(calls[0].model).toBe(DEFAULT_DRAFT_CONFIG.models.photoBrief);
  });

  it("renders with the configured image model, wide, at 2K, allowing 3 minutes", async () => {
    const { deps, generateImage } = build([BRIEF]);
    await run(deps);
    const [prompt, opts] = generateImage.mock.calls[0];
    expect(opts).toEqual({ model: DEFAULT_DRAFT_CONFIG.models.image, aspectRatio: "21:9", imageSize: "2K", timeoutMs: 180_000 });
    expect(prompt).toContain("surveyor's tripod");
    expect(prompt).toMatch(/no (text|lettering)[^.]*numerals/i); // the picture itself must carry no writing
  });

  it("sends a brief that prints numbers back once, then uses the fixed one", async () => {
    const bad = `${SCENE.replace("empty gravel road", "empty road beside a board reading 9.87")}\nAlt Text: ${ALT}`;
    const { deps, calls } = build([bad, BRIEF]);
    const r = await run(deps);
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.label)).toEqual(["photo_brief", "photo_brief_retry"]);
    expect(calls[1].user).toMatch(/numerals/);
  });

  it("gives up without an image, not with an error, when the brief stays wrong", async () => {
    const bad = `${SCENE.replace("empty gravel road", "empty road beside a board reading 9.87")}\nAlt Text: ${ALT}`;
    const { deps, generateImage } = build([bad, bad]);
    const r = await run(deps);
    expect(r).toMatchObject({ ok: false });
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("an image failure is a note, not a crash", async () => {
    const { deps } = build([BRIEF], async () => {
      throw new Error("Image generation timed out.");
    });
    const r = await run(deps);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.note).toMatch(/image/i);
  });

  it("a model failure writing the brief is a note, not a crash", async () => {
    const { deps } = build([new LlmError("photo_brief: model service returned 402", "client", 402)]);
    expect(await run(deps)).toMatchObject({ ok: false });
  });

  it.each([
    ["not an image at all", "data:text/plain;base64,AAAA"],
    ["a URL, not data", "https://example.com/x.png"],
    ["a tiny image (a failed render)", `data:image/png;base64,${Buffer.alloc(500).toString("base64")}`],
  ])("rejects %s", async (_l, imageUrl) => {
    const { deps } = build([BRIEF], async () => ({ imageUrl }));
    expect(await run(deps)).toMatchObject({ ok: false });
  });

  it("still returns the steps it completed when the image fails", async () => {
    const { deps } = build([BRIEF], async () => {
      throw new Error("boom");
    });
    const r = await run(deps);
    expect(r.steps.map((s) => s.stepKey)).toEqual(["photo_brief", "image"]);
    expect(r.steps[1].status).toBe("failed");
  });
});
