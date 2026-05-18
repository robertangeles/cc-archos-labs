import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, isReservedSlug } from "./reserved-slugs";
import {
  listAppTopLevelRoutes,
  assertReservedSlugsMatchFilesystem,
} from "./reserved-slugs-fs";

describe("isReservedSlug", () => {
  it("flags every entry in the curated set", () => {
    for (const slug of RESERVED_SLUGS) {
      expect(isReservedSlug(slug)).toBe(true);
    }
  });

  it("flags case variants of reserved slugs", () => {
    expect(isReservedSlug("ADMIN")).toBe(true);
    expect(isReservedSlug("Api")).toBe(true);
    expect(isReservedSlug(" admin ")).toBe(true);
  });

  it("treats empty + whitespace-only slugs as reserved (would shadow /)", () => {
    expect(isReservedSlug("")).toBe(true);
    expect(isReservedSlug("   ")).toBe(true);
    expect(isReservedSlug("\t")).toBe(true);
  });

  it("passes legitimate slugs", () => {
    expect(isReservedSlug("privacy")).toBe(false);
    expect(isReservedSlug("terms")).toBe(false);
    expect(isReservedSlug("services")).toBe(false);
    expect(isReservedSlug("modelling-room")).toBe(false);
    expect(isReservedSlug("case-study-acme")).toBe(false);
  });
});

describe("listAppTopLevelRoutes (filesystem reflection)", () => {
  it("includes the existing public routes", () => {
    const routes = listAppTopLevelRoutes();
    // Sanity: these directories exist as of Phase 1 and must be in
    // RESERVED_SLUGS. If a future PR moves them, this list moves too.
    expect(routes).toContain("admin");
    expect(routes).toContain("api");
    expect(routes).toContain("about");
    expect(routes).toContain("contact");
  });

  it("excludes internal underscore directories", () => {
    const routes = listAppTopLevelRoutes();
    for (const r of routes) {
      expect(r.startsWith("_")).toBe(false);
    }
  });

  it("excludes route groups (parens) and dynamic segments (brackets)", () => {
    const routes = listAppTopLevelRoutes();
    for (const r of routes) {
      expect(r.startsWith("(")).toBe(false);
      expect(r.startsWith("[")).toBe(false);
    }
  });
});

describe("assertReservedSlugsMatchFilesystem", () => {
  it("passes when every disk route is reserved", () => {
    // Inject the fixture to make this deterministic regardless of the
    // working tree's current cutover state.
    expect(() =>
      assertReservedSlugsMatchFilesystem({
        routes: ["admin", "api", "about", "contact"],
      }),
    ).not.toThrow();
  });

  it("throws when a disk route is missing from RESERVED_SLUGS", () => {
    expect(() =>
      assertReservedSlugsMatchFilesystem({
        routes: ["admin", "services"], // 'services' not in set
      }),
    ).toThrow(/services/);
  });

  it("does NOT throw for CMS-managed slugs (passed via opts.cmsSlugs)", () => {
    // During cutover or after — the CMS owns these slugs, so it's fine
    // for them to be on disk OR not. The assertion only fires when a
    // route exists on disk but is neither reserved nor CMS-managed.
    expect(() =>
      assertReservedSlugsMatchFilesystem({
        routes: ["admin", "api", "privacy"],
        cmsSlugs: new Set(["privacy", "terms"]),
      }),
    ).not.toThrow();
  });

  it("flags a multi-slug drift in the error message", () => {
    expect(() =>
      assertReservedSlugsMatchFilesystem({
        routes: ["admin", "services", "products"],
      }),
    ).toThrow(/services.*products|products.*services/);
  });
});
