import { describe, expect, it } from "vitest";
import { normalizeTwitterHandle } from "./site-config";

describe("normalizeTwitterHandle", () => {
  it("returns a bare handle unchanged", () => {
    expect(normalizeTwitterHandle("archoslabsxyz")).toBe("archoslabsxyz");
  });

  it("strips a leading @", () => {
    expect(normalizeTwitterHandle("@archoslabsxyz")).toBe("archoslabsxyz");
  });

  it("strips an https://x.com/ profile URL", () => {
    // The exact stored value that caused the production bug — site_setting
    // held the full profile URL, so `@${stored}` rendered as
    // `@https://x.com/archoslabsxyz` and X ignored it.
    expect(normalizeTwitterHandle("https://x.com/archoslabsxyz")).toBe(
      "archoslabsxyz",
    );
  });

  it("strips an https://twitter.com/ profile URL", () => {
    expect(normalizeTwitterHandle("https://twitter.com/archoslabsxyz")).toBe(
      "archoslabsxyz",
    );
  });

  it("strips http:// and www. prefixes", () => {
    expect(normalizeTwitterHandle("http://www.x.com/archoslabsxyz")).toBe(
      "archoslabsxyz",
    );
  });

  it("strips a trailing slash on a profile URL", () => {
    expect(normalizeTwitterHandle("https://x.com/archoslabsxyz/")).toBe(
      "archoslabsxyz",
    );
  });

  it("drops a query string on a profile URL", () => {
    expect(
      normalizeTwitterHandle("https://x.com/archoslabsxyz?utm_source=foo"),
    ).toBe("archoslabsxyz");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeTwitterHandle("  archoslabsxyz  ")).toBe("archoslabsxyz");
  });

  it("returns empty string when input is empty", () => {
    expect(normalizeTwitterHandle("")).toBe("");
  });

  it("returns empty string when input is whitespace only", () => {
    expect(normalizeTwitterHandle("   ")).toBe("");
  });

  it("collapses repeated leading @", () => {
    expect(normalizeTwitterHandle("@@archoslabsxyz")).toBe("archoslabsxyz");
  });
});
