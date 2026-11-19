import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DRAFT_CONFIG } from "./config";
import { LlmError, type ChatRequest, type ChatResult, type Llm } from "./llm";
import { checkBrief, parsePhotoBrief, PHOTO_BANNED, recentAlts, repeatsRecent, runPhoto, type PhotoDeps } from "./photo";
import type { SkillPrompt } from "./skills";

// Three facts shaped this module. The brief writer picked "a stopwatch and a sprinter"
// twice in a row, and it printed "9.87" on the stopwatch face, so a brief that contains
// numerals is sent back. A fixed rotation of 12 scenes fixed the first problem and made
// readers notice the second thing: 26 posts showed 12 pictures, each twice. So the subject
// now comes from the article, and a brief whose subject repeats a recent one is sent back.

const SCENE =
  "A weathered surveyor's tripod stands at the edge of an empty gravel road at dawn, a measuring staff leaning against it, the road vanishing into low flat fog. " +
  "Shot low with a 35mm lens at f/2.8, soft overcast light from the east, desaturated blues and greys, the tripod in the left third with generous empty space to the right for a wide 21:9 frame.";
const ALT = "A surveyor's tripod and measuring staff on an empty road at dawn.";
const BRIEF = `${SCENE}\n\nAlt Text: ${ALT}`;

const chat = (text: string): ChatResult => ({ text, model: "m", inputTokens: 5, outputTokens: 9, costUsd: 0.003, citations: [], durationMs: 4 });
const PHOTO_SKILL_ROW: SkillPrompt = {
  slug: "archos-editorial-photo",
  system: "You are a photo editor.",
  template: "Never: {{banned}}\nArticle:\n{{article}}",
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
const run = (deps: PhotoDeps, recentBriefs: string[] = []) => runPhoto(deps, DEFAULT_DRAFT_CONFIG, { article: ARTICLE, recentBriefs });

// The alt texts of the 26 pictures the pipeline really published, with the subject each one
// shows (labelled by looking at the pictures). Twelve subjects, each used two or three times.
const LIVE: [string, string][] = [
  ["bridge", "A wooden footbridge stretches across still water at dawn, its planks ending abruptly in mid-air with no continuation"],
  ["hall", "Empty lecture hall with single chair turned to face blank back wall, late afternoon light casting shadows across"],
  ["weather", "Solitary weather station on exposed hilltop under flat grey cloud, single support cable, barren landscape, overcast sky"],
  ["hall", "Empty lecture hall with single chair facing away from podium toward blank back wall, morning light through high windows"],
  ["control", "Empty control-room desk with single lit paper and dark monitors behind, emphasizing incomplete information and silent"],
  ["control", "Empty control-room desk and unlit monitor bank in gray institutional setting, office chair pushed back, fluorescent light on"],
  ["cable", "Industrial cable bundle terminated against bare concrete wall at dusk, low angle, cool grey tones, tension between"],
  ["tripod", "A surveyor's tripod and measuring staff stand abandoned on an empty, straight road beneath overcast sky, receding to an"],
  ["balance", "Old beam balance on wooden bench, left pan weighted down with stone, right pan tilted high and empty, spare stone resting"],
  ["weather", "Isolated weather station on bare hilltop under uniform grey cloud, its instruments reaching skyward into featureless"],
  ["ruler", "Overhead view of a ruler and pencil on blank paper, with a sharp shadow dividing the composition, suggesting measurement"],
  ["bridge", "A wooden footbridge extending across still water disappears into fog at dawn, its end obscured and unreachable."],
  ["door", "Open door in blank concrete wall at dusk, casting a displaced shadow from a work light, interior darkness framed but empty."],
  ["cable", "Industrial cables bundled and terminating at a bare concrete wall, worker's gloved hands reaching toward the incomplete"],
  ["ruler", "Metal ruler and pencil on blank paper at a drawing table, casting shadows in natural window light. A parallel line implied"],
  ["balance", "Antique beam balance on wooden bench with empty left pan and right pan weighted down by stones, morning light, empty"],
  ["mailbox", "Rural mailbox row with one door hanging open, revealing nothing inside while others remain closed, overcast morning light."],
  ["containers", "Dawn at a shipping container terminal; hundreds of identical stacked containers in neat rows, one standing open with doors"],
  ["archive", "Filing corridor with identical boxes; one pulled halfway out, its interior dark and unreadable, disrupting perfect rows"],
  ["runner", "A gloved hand stops a stopwatch as a runner's foot crosses a finish line on an indoor track."],
  ["containers", "Dawn at a shipping container harbour; hundreds of identical sealed containers in neat rows, one standing open, a small"],
  ["tripod", "Surveyor's tripod and measuring staff on empty asphalt road under grey sky, casting long shadow toward receding horizon."],
  ["archive", "Long archive corridor of identical grey filing boxes with one box pulled halfway out, fluorescent light, symmetry broken by"],
  ["mailbox", "Row of identical mailboxes along rural road, one hanging open in foreground while others remain closed, stretching into"],
  ["door", "Open doorway in blank concrete wall at dusk, fluorescent light spilling outward, architectural geometry emphasizing"],
  ["tripod", "Surveyor's tripod and staff on empty wet asphalt road under grey sky, positioned where perspective lines converge, casting"],
];

const TRIPOD_ALT = LIVE.find(([k]) => k === "tripod")![1];
const RECENT_TRIPOD = `${SCENE}\nAlt Text: ${TRIPOD_ALT}`;

describe("repeatsRecent", () => {
  it("flags every live pair that shows the same subject, bar one the check is allowed to miss", () => {
    let same = 0;
    let caught = 0;
    for (let i = 0; i < LIVE.length; i++) {
      for (let j = i + 1; j < LIVE.length; j++) {
        if (LIVE[i][0] !== LIVE[j][0]) continue;
        same++;
        if (repeatsRecent(LIVE[i][1], [LIVE[j][1]])) caught++;
      }
    }
    expect(same).toBe(14);
    expect(caught).toBeGreaterThanOrEqual(13);
  });

  it("never flags two live pictures that show different subjects", () => {
    for (let i = 0; i < LIVE.length; i++) {
      for (let j = i + 1; j < LIVE.length; j++) {
        if (LIVE[i][0] === LIVE[j][0]) continue;
        expect(repeatsRecent(LIVE[i][1], [LIVE[j][1]]), `${LIVE[i][0]} vs ${LIVE[j][0]}`).toBeNull();
      }
    }
  });

  it("returns the recent alt text it matched, so the writer can be told which", () => {
    const tripod = LIVE.filter(([k]) => k === "tripod").map(([, a]) => a);
    expect(repeatsRecent(tripod[0], [LIVE[0][1], tripod[1]])).toBe(tripod[1]);
  });

  it("is null with nothing recent", () => {
    expect(repeatsRecent(ALT, [])).toBeNull();
  });
});

describe("recentAlts", () => {
  it("reads the alt text from each stored brief, newest first, and skips what has none", () => {
    expect(recentAlts([BRIEF, "no alt text in this one", `${SCENE}\nAlt Text: A harbour at dawn.`])).toEqual([ALT, "A harbour at dawn."]);
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

  it("leaves the subject to the article, bans the clichés, and fences the article", async () => {
    const { deps, calls } = build([BRIEF]);
    await run(deps);
    expect(calls[0].user).not.toMatch(/assigned/i);
    expect(calls[0].user).toContain("stopwatch");
    expect(calls[0].user).toMatch(/<<<UNTRUSTED_[0-9a-f-]+\nA fact-check of a headline/);
    expect(calls[0].model).toBe(DEFAULT_DRAFT_CONFIG.models.photoBrief);
  });

  it("shows the model the pictures already on the site, as fenced data, and nothing when there are none", async () => {
    const harbour = `${SCENE}\nAlt Text: A harbour at dawn with rows of shipping containers, one standing open.`;
    const { deps, calls } = build([harbour, BRIEF]);
    await run(deps, [RECENT_TRIPOD]);
    expect(calls[0].user).toMatch(/already on the site/i);
    expect(calls[0].user).toMatch(/<<<UNTRUSTED_[0-9a-f-]+\n- .*[Tt]ripod/);
    await run(deps, []);
    expect(calls[1].user).not.toMatch(/already on the site/i);
  });

  it("sends a brief whose subject repeats a recent picture back once, naming the picture, then uses the new one", async () => {
    const other = `${SCENE}\nAlt Text: A harbour at dawn with rows of shipping containers, one standing open.`;
    const { deps, calls } = build([BRIEF, other]);
    const r = await run(deps, [RECENT_TRIPOD]);
    expect(r).toMatchObject({ ok: true, alt: "A harbour at dawn with rows of shipping containers, one standing open." });
    expect(calls.map((c) => c.label)).toEqual(["photo_brief", "photo_brief_retry"]);
    expect(calls[1].user).toMatch(/repeats a picture already on the site/);
    expect(calls[1].user).toContain(TRIPOD_ALT); // says which one
    expect(calls[1].user).toMatch(/already on the site[^]*Tripod/i); // and the list is still there
  });

  it("makes the draft without a picture, not a repeat, when the subject keeps repeating", async () => {
    const { deps, generateImage } = build([BRIEF, BRIEF]);
    const r = await run(deps, [RECENT_TRIPOD]);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.note).toMatch(/repeats/);
    expect(generateImage).not.toHaveBeenCalled();
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
