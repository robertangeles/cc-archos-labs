import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/real-image-prompts.json";
import {
  ILLUSTRATION_COMPOSITION,
  ILLUSTRATION_PLACES,
  ILLUSTRATION_STYLE,
  buildImagePrompt,
  parseImagePrompt,
  pickPlace,
} from "./parse-image-prompt";

// Every fixture is a real `image_prompt` pulled from workflow_execution_run in
// the DEV database, all 13 of them written by the original Midjourney-shaped
// skill. They are the defensive case: the workflow step now points at a new
// skill, but the old one is kept for manual use and someone may repoint it.

describe("parseImagePrompt against the 13 real historical outputs", () => {
  it("has fixtures to test against", () => {
    expect(fixtures.length).toBe(13);
  });

  for (const fx of fixtures) {
    describe(fx.id, () => {
      const parsed = parseImagePrompt(fx.imagePrompt);

      it("parses", () => {
        expect(parsed).not.toBeNull();
        expect(parsed!.scene.length).toBeGreaterThan(50);
      });

      it("strips the Midjourney flags Gemini would read as prose", () => {
        // The raw fixture definitely has them, or this assertion proves nothing.
        expect(fx.imagePrompt).toMatch(/--ar\s+289:100/);
        expect(parsed!.scene).not.toMatch(/--/);
        expect(parsed!.scene).not.toContain("289:100");
        expect(parsed!.scene).not.toContain("`");
      });

      it("strips the artist attribution", () => {
        expect(fx.imagePrompt).toMatch(/in the style of/i);
        expect(parsed!.scene).not.toMatch(/in the style of/i);
        expect(parsed!.scene).not.toMatch(/schmitz/i);
      });

      it("extracts alt text within the 125-char limit", () => {
        expect(parsed!.altText.length).toBeGreaterThan(0);
        expect(parsed!.altText.length).toBeLessThanOrEqual(125);
        expect(parsed!.altText).not.toMatch(/^\*+/);
      });

      it("leaves no orphaned punctuation where text was removed", () => {
        expect(parsed!.scene).not.toMatch(/\s[.,;]/);
        expect(parsed!.scene).not.toMatch(/[.,;]{2,}/);
      });
    });
  }
});

describe("parseImagePrompt on the new skill's SCENE/ALT shape", () => {
  const raw = `SCENE: A figure in silhouette stands alone in the centre of a vast empty hotel lobby at night. Three identical doorways recede into the far wall, and the wedge of warm light each one throws falls at a different angle across the polished floor.
ALT: Solitary figure in an empty lobby facing three identical doorways lit at conflicting angles.`;

  it("takes the labelled scene and drops the label", () => {
    const p = parseImagePrompt(raw)!;
    expect(p.scene).toMatch(/^A figure in silhouette/);
    expect(p.scene).not.toMatch(/SCENE:/);
    expect(p.scene).not.toMatch(/ALT:/);
  });

  it("takes the alt from the ALT line", () => {
    expect(parseImagePrompt(raw)!.altText).toBe(
      "Solitary figure in an empty lobby facing three identical doorways lit at conflicting angles.",
    );
  });

  it("caps an over-long alt rather than trusting the prompt", () => {
    // Measured: real runs came back at 147, 214 and 144 chars against a stated
    // 125 limit, three times out of three. The instruction does not hold.
    const long = `SCENE: A bare rooftop at dusk.\nALT: ${"word ".repeat(60)}`;
    const alt = parseImagePrompt(long)!.altText;
    expect(alt.length).toBeLessThanOrEqual(125);
    expect(alt.endsWith(" ")).toBe(false);
  });

  it("still parses when the skill omits alt text entirely", () => {
    const p = parseImagePrompt("SCENE: A bare rooftop at dusk, one figure.")!;
    expect(p.scene).toBe("A bare rooftop at dusk, one figure.");
    expect(p.altText).toBe("");
  });
});

describe("parseImagePrompt rejects unusable input", () => {
  it("returns null on empty input", () => {
    expect(parseImagePrompt("")).toBeNull();
    expect(parseImagePrompt("   \n ")).toBeNull();
  });

  it("returns null when stripping leaves no scene", () => {
    // A caller that sent this on would pay a paid image model to render nothing.
    expect(parseImagePrompt("`--ar 289:100 --stylize 500 --raw --v 7.0`")).toBeNull();
    expect(parseImagePrompt("Alt Text: just alt, no scene at all")).toBeNull();
  });
});

describe("pickPlace", () => {
  it("visits every setting before repeating any", () => {
    const seen = new Set(
      Array.from({ length: ILLUSTRATION_PLACES.length }, (_, i) => pickPlace(i)),
    );
    expect(seen.size).toBe(ILLUSTRATION_PLACES.length);
  });

  it("never gives two consecutive posts the same setting", () => {
    for (let i = 0; i < 40; i++) {
      expect(pickPlace(i), `seed ${i}`).not.toBe(pickPlace(i + 1));
    }
  });

  it("is deterministic — the same seed always gives the same setting", () => {
    expect(pickPlace(7)).toBe(pickPlace(7));
    expect(pickPlace(19)).toBe(pickPlace(19));
  });

  it("returns a real setting for negative and non-integer seeds", () => {
    for (const seed of [-1, -13, 0, 1.7, 1e6]) {
      const out = pickPlace(seed);
      expect(
        ILLUSTRATION_PLACES.some((p) => out.startsWith(p.place)),
        `seed ${seed} -> ${out}`,
      ).toBe(true);
    }
  });

  it("describes every setting as bare, because clutter beat the concept", () => {
    for (const { place } of ILLUSTRATION_PLACES) {
      expect(place, place).toMatch(/\b(empty|bare|nothing|open)\b/);
    }
  });

  it("names the repeated element too, instead of letting the model choose", () => {
    // Told to pick its own element with "two identical doorways" as the first
    // example, it chose doorways every single time — including in an open
    // field, where it drew three freestanding door frames in the grass.
    const out = pickPlace(0);
    expect(out).toMatch(/The repeated element is /);
  });

  it("varies the element, not just the setting", () => {
    // A run of posts that all share one setting AND one element is the same
    // picture with different furniture.
    const elements = Array.from({ length: 12 }, (_, i) =>
      pickPlace(i).split("The repeated element is ")[1],
    );
    expect(new Set(elements).size).toBeGreaterThan(6);
  });

  it("does not lean on doors — they are what it collapsed to", () => {
    const doorish = Array.from({ length: 36 }, (_, i) => pickPlace(i)).filter((p) =>
      /\bdoors?\b|\bdoorways?\b/i.test(p.split("The repeated element is ")[1] ?? ""),
    );
    expect(doorish.length).toBeLessThanOrEqual(6);
  });

  it("pairs an element that could exist in its setting", () => {
    // Three identical staircases do not belong in a field. Each element list
    // is written against its own place for exactly this reason.
    const field = ILLUSTRATION_PLACES.find((p) => p.place.includes("field"))!;
    for (const el of field.elements) {
      expect(el, el).not.toMatch(/stair|corridor|ceiling|lobby/i);
    }
  });
});

describe("buildImagePrompt", () => {
  const scene = "A figure stands alone on a bare rooftop at dusk.";

  it("brackets the concept with the locked style and framing", () => {
    const out = buildImagePrompt(scene);
    expect(out.startsWith(ILLUSTRATION_STYLE)).toBe(true);
    expect(out).toContain(scene);
    expect(out.endsWith(ILLUSTRATION_COMPOSITION)).toBe(true);
  });

  it("forbids text and borders in every prompt it builds", () => {
    // A bordered render appeared in testing and would look broken in the
    // 29:10 featured-image slot; legible text appeared in every early test.
    const out = buildImagePrompt(scene);
    expect(out).toMatch(/no border/i);
    expect(out).toMatch(/full bleed/i);
    expect(out).toMatch(/No text, lettering or numerals/i);
  });

  it("never names an artist", () => {
    expect(buildImagePrompt(scene)).not.toMatch(/schmitz|in the style of/i);
  });

  it("stays inside the 16k prompt cap generateImage enforces", () => {
    expect(buildImagePrompt("x".repeat(2000)).length).toBeLessThan(16_000);
  });
});
