import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

const generateImageMock = vi.fn();
vi.mock("../image-gen/service", () => ({
  generateImage: (...args: unknown[]) => generateImageMock(...args),
  ImageGenError: class ImageGenError extends Error {},
}));

const { cropToRatio, generatePostImage } = await import("./image");

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 40, b: 70 },
    },
  })
    .png()
    .toBuffer();
}

async function dataUri(width: number, height: number): Promise<string> {
  return `data:image/png;base64,${(await png(width, height)).toString("base64")}`;
}

async function dims(buffer: Buffer): Promise<{ width: number; height: number }> {
  const m = await sharp(buffer).metadata();
  return { width: m.width!, height: m.height! };
}

afterEach(() => {
  vi.clearAllMocks();
});

const PROMPT = `SCENE: A figure stands alone in a vast empty lobby at night, three identical doorways in the far wall each throwing a wedge of warm light at a different angle.
ALT: Figure in an empty lobby facing three doorways lit at conflicting angles.`;

describe("cropToRatio", () => {
  it("crops a 21:9 source to the 29:10 the template renders", async () => {
    // 2016x864 is what 21:9 at 2K comes back as.
    const { width, height } = await dims(await cropToRatio(await png(2016, 864), 2.9));
    expect(width / height).toBeCloseTo(2.9, 2);
    // Width is preserved and height is trimmed, because 2.9 is wider than 2.33.
    expect(width).toBe(2016);
    expect(height).toBe(695);
  });

  it("crops the width instead when the source is wider than the target", async () => {
    // The model honours the requested ratio approximately. A fixed
    // "always trim the height" would extract past the edge here and Sharp
    // would throw rather than degrade.
    const { width, height } = await dims(await cropToRatio(await png(4000, 800), 2.9));
    expect(width / height).toBeCloseTo(2.9, 2);
    expect(height).toBe(800);
    expect(width).toBe(2320);
  });

  it("handles a square source without throwing", async () => {
    const { width, height } = await dims(await cropToRatio(await png(1024, 1024), 2.9));
    expect(width / height).toBeCloseTo(2.9, 2);
    expect(width).toBe(1024);
  });

  it("is a no-op in shape when the source is already 29:10", async () => {
    const { width, height } = await dims(await cropToRatio(await png(2900, 1000), 2.9));
    expect(width).toBe(2900);
    expect(height).toBe(1000);
  });

  it("rejects bytes that are not an image", async () => {
    await expect(cropToRatio(Buffer.from("nope"), 2.9)).rejects.toThrow();
  });
});

describe("generatePostImage", () => {
  it("returns cropped bytes and the alt text", async () => {
    generateImageMock.mockResolvedValue({
      imageUrl: await dataUri(2016, 864),
      text: null,
      model: "test",
    });

    const out = await generatePostImage(PROMPT);
    expect(out).not.toBeNull();
    expect(out!.alt).toBe(
      "Figure in an empty lobby facing three doorways lit at conflicting angles.",
    );
    const { width, height } = await dims(out!.buffer);
    expect(width / height).toBeCloseTo(2.9, 2);
  });

  it("asks for 21:9, the widest ratio the model offers", async () => {
    generateImageMock.mockResolvedValue({
      imageUrl: await dataUri(2016, 864),
      text: null,
      model: "test",
    });
    await generatePostImage(PROMPT);
    expect(generateImageMock).toHaveBeenCalledWith(
      expect.any(String),
      { aspectRatio: "21:9", imageSize: "2K" },
    );
  });

  it("sends the locked style and the concept, never the Midjourney flags", async () => {
    generateImageMock.mockResolvedValue({
      imageUrl: await dataUri(2016, 864),
      text: null,
      model: "test",
    });
    await generatePostImage(
      "An editorial illustration in the style of Stephan Schmitz. A lone figure on a bare rooftop at dusk. `--ar 289:100 --stylize 500 --raw --v 7.0 --q 2`\n\nAlt Text: A figure on a rooftop.",
    );
    const sent = generateImageMock.mock.calls[0][0] as string;
    expect(sent).toContain("bare rooftop at dusk");
    expect(sent).toContain("conceptual editorial illustration");
    expect(sent).not.toMatch(/--ar|289:100|schmitz/i);
  });
});

describe("the white matte Gemini sometimes adds", () => {
  /** An illustration inset in a white border, as the model intermittently renders. */
  async function matted(inner: number, border: number): Promise<Buffer> {
    return sharp({
      create: {
        width: inner + border * 2,
        height: Math.round(inner / 2.33) + border * 2,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([{ input: await png(inner, Math.round(inner / 2.33)), top: border, left: border }])
      .png()
      .toBuffer();
  }

  it("is removed, so the crop is not full of white", async () => {
    generateImageMock.mockResolvedValue({
      imageUrl: `data:image/png;base64,${(await matted(1400, 60)).toString("base64")}`,
      text: null,
      model: "test",
    });

    const out = await generatePostImage(PROMPT);
    expect(out).not.toBeNull();

    // The prompt already says "full bleed, no border, no mat"; the model
    // ignored it on the house fallback image, so this is checked, not asked for.
    const { data, info } = await sharp(out!.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const corner = [data[0], data[1], data[2]];
    expect(corner, `corner was ${corner} in a ${info.width}x${info.height} crop`)
      .not.toEqual([255, 255, 255]);
  });

  it("leaves a borderless image untouched", async () => {
    const clean = await png(2016, 864);
    generateImageMock.mockResolvedValue({
      imageUrl: `data:image/png;base64,${clean.toString("base64")}`,
      text: null,
      model: "test",
    });
    const out = await generatePostImage(PROMPT);
    // Width survives: only the height is trimmed, by the ratio crop alone.
    expect((await dims(out!.buffer)).width).toBe(2016);
  });

  it("keeps the full frame when trimming would leave a thumbnail", async () => {
    // A tiny illustration marooned in a huge white field. Trimming here is not
    // tidying a matte, it is throwing the picture away: 2016px would become
    // 200px, and a 200px-wide featured image looks broken at any size. Better
    // to ship the white than to ship a thumbnail.
    const marooned = await sharp({
      create: { width: 2016, height: 864, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([{ input: await png(200, 100), top: 382, left: 908 }])
      .png()
      .toBuffer();
    generateImageMock.mockResolvedValue({
      imageUrl: `data:image/png;base64,${marooned.toString("base64")}`,
      text: null,
      model: "test",
    });
    const out = await generatePostImage(PROMPT);
    expect(out).not.toBeNull();
    expect((await dims(out!.buffer)).width).toBe(2016);
  });

  it("survives an entirely uniform image, which Sharp refuses to trim", async () => {
    const blank = await sharp({
      create: { width: 2016, height: 864, channels: 3, background: { r: 252, g: 252, b: 252 } },
    })
      .png()
      .toBuffer();
    generateImageMock.mockResolvedValue({
      imageUrl: `data:image/png;base64,${blank.toString("base64")}`,
      text: null,
      model: "test",
    });
    const out = await generatePostImage(PROMPT);
    expect(out).not.toBeNull();
    expect((await dims(out!.buffer)).width).toBe(2016);
  });
});

describe("generatePostImage never throws — it degrades to null", () => {
  it("on an unusable prompt", async () => {
    expect(await generatePostImage("")).toBeNull();
    expect(await generatePostImage("`--ar 289:100 --raw`")).toBeNull();
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it("when the model errors or times out", async () => {
    generateImageMock.mockRejectedValue(new Error("504 timed out"));
    expect(await generatePostImage(PROMPT)).toBeNull();
  });

  it("when the response carries no readable image", async () => {
    generateImageMock.mockResolvedValue({
      imageUrl: "data:image/png;base64,bm90YW5pbWFnZQ==",
      text: null,
      model: "test",
    });
    expect(await generatePostImage(PROMPT)).toBeNull();
  });

  it("when the data URI is malformed", async () => {
    generateImageMock.mockResolvedValue({
      imageUrl: "data:image/png;base64",
      text: null,
      model: "test",
    });
    expect(await generatePostImage(PROMPT)).toBeNull();
  });

  it("when a remote image URL cannot be downloaded", async () => {
    generateImageMock.mockResolvedValue({
      imageUrl: "https://example.invalid/i.png",
      text: null,
      model: "test",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 500 }));
    expect(await generatePostImage(PROMPT)).toBeNull();
    fetchSpy.mockRestore();
  });

  it("returns an empty alt rather than failing when the skill omits it", async () => {
    generateImageMock.mockResolvedValue({
      imageUrl: await dataUri(2016, 864),
      text: null,
      model: "test",
    });
    const out = await generatePostImage("SCENE: A bare rooftop at dusk, one figure.");
    expect(out).not.toBeNull();
    expect(out!.alt).toBe("");
  });
});
