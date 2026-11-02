import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeDraftTestDb, type DraftTestDb } from "../../../tests/helpers/draft-test-db";
import {
  DEFAULT_DRAFT_CONFIG,
  DraftConfigError,
  getDraftConfig,
  isDraftEnabled,
  parseDraftConfig,
} from "./config";

describe("parseDraftConfig", () => {
  it("returns the defaults for an empty object", () => {
    expect(parseDraftConfig({})).toEqual(DEFAULT_DRAFT_CONFIG);
  });

  it("defaults are the agreed ones", () => {
    expect(DEFAULT_DRAFT_CONFIG.dailyCap).toBe(3);
    expect(DEFAULT_DRAFT_CONFIG.maxRewrites).toBe(3);
    expect(DEFAULT_DRAFT_CONFIG.contactEmail).toBe("rob.angeles@archoslabs.xyz");
    expect(DEFAULT_DRAFT_CONFIG.categorySlug).toBe("ai-news");
    expect(DEFAULT_DRAFT_CONFIG.models.judge).toBe("deepseek/deepseek-v4-flash-0731");
    expect(DEFAULT_DRAFT_CONFIG.models.image).toBe("bytedance-seed/seedream-5-0-pro");
  });

  it("overrides one field and keeps the rest", () => {
    const c = parseDraftConfig({ dailyCap: 5, models: { writer: "anthropic/claude-opus-5.5" } });
    expect(c.dailyCap).toBe(5);
    expect(c.models.writer).toBe("anthropic/claude-opus-5.5");
    expect(c.models.judge).toBe(DEFAULT_DRAFT_CONFIG.models.judge);
    expect(c.maxRewrites).toBe(3);
  });

  it.each([
    ["an unknown key (a typo must not silently do nothing)", { dailyCapp: 3 }],
    ["an unknown model key", { models: { writter: "x" } }],
    ["a cap of 0", { dailyCap: 0 }],
    ["a cap of 11", { dailyCap: 11 }],
    ["a fractional cap", { dailyCap: 2.5 }],
    ["negative rewrites", { maxRewrites: -1 }],
    ["4 rewrites", { maxRewrites: 4 }],
    ["a tiny word target", { targetWords: 100 }],
    ["a bad contact email", { contactEmail: "not an email" }],
    ["an empty model id", { models: { judge: "" } }],
    ["a string cap", { dailyCap: "3" }],
    ["null", null],
    ["a string", "yes"],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseDraftConfig(raw)).toThrow(DraftConfigError);
  });
});

describe("the flag and the stored config (against a real Postgres engine)", () => {
  let h: DraftTestDb;
  beforeAll(async () => {
    h = await makeDraftTestDb();
  });
  beforeEach(async () => {
    await h.reset();
  });
  afterAll(async () => {
    await h.close();
  });

  it("is OFF when no flag row exists", async () => {
    expect(await isDraftEnabled(h.db)).toBe(false);
  });

  it("is on only for exactly {enabled: true}", async () => {
    await h.setSetting("news_draft_enabled", { enabled: true });
    expect(await isDraftEnabled(h.db)).toBe(true);
  });

  it.each([{ enabled: false }, { enabled: "true" }, { enabled: 1 }, {}, [], "on", null])(
    "is OFF for the malformed value %j (fails closed)",
    async (value) => {
      await h.setSetting("news_draft_enabled", value);
      expect(await isDraftEnabled(h.db)).toBe(false);
    },
  );

  it("uses the defaults when no config row exists", async () => {
    expect(await getDraftConfig(h.db)).toEqual(DEFAULT_DRAFT_CONFIG);
  });

  it("reads a stored config", async () => {
    await h.setSetting("news_draft_config", { dailyCap: 2 });
    expect((await getDraftConfig(h.db)).dailyCap).toBe(2);
  });

  it("throws on a broken stored config instead of quietly using the defaults", async () => {
    await h.setSetting("news_draft_config", { dailyCap: 99 });
    await expect(getDraftConfig(h.db)).rejects.toThrow(DraftConfigError);
  });
});
