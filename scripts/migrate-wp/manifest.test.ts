// manifest.ts — unit tests

import { describe, expect, it } from "vitest";
import {
  addEntry,
  buildEntry,
  emptyManifest,
  formatSummary,
} from "./manifest";
import type { MigrationConfig } from "./types";

const config: MigrationConfig = {
  mode: "apply",
  limit: null,
  slug: null,
  skipMedia: false,
  skipOg: false,
  skipEmbed: false,
  manifestPath: null,
  prod: false,
  confirmProd: false,
};
const source = {
  databaseHost: "127.0.0.1:3306",
  databaseName: "test_db",
  tablePrefix: "uhiz_",
};

describe("emptyManifest", () => {
  it("initialises totals to zero", () => {
    const m = emptyManifest(config, source);
    expect(m.totals.extracted).toBe(0);
    expect(m.totals.inserted).toBe(0);
    expect(m.totals.failed).toBe(0);
    expect(m.posts).toEqual([]);
  });

  it("captures mode + filters", () => {
    const m = emptyManifest({ ...config, limit: 5 }, source);
    expect(m.mode).toBe("apply");
    expect(m.filters.limit).toBe(5);
  });
});

describe("buildEntry", () => {
  it("creates an entry with sane defaults", () => {
    const e = buildEntry({ sourceWpId: 42, slug: "test", title: "Test" });
    expect(e.sourceWpId).toBe(42);
    expect(e.slug).toBe("test");
    expect(e.status).toBe("extracted");
    expect(e.errors).toEqual([]);
    expect(e.decisions.needsReview).toBe(false);
  });
});

describe("addEntry — totals rollup", () => {
  it("counts every reached stage when entry reaches 'inserted'", () => {
    const m = emptyManifest(config, source);
    const e = buildEntry({ sourceWpId: 1, slug: "a", title: "A" });
    e.status = "inserted";
    addEntry(m, e);
    expect(m.totals.extracted).toBe(1);
    expect(m.totals.transformed).toBe(1);
    expect(m.totals.polished).toBe(1);
    expect(m.totals.embedded).toBe(1);
    expect(m.totals.mediaRehosted).toBe(1);
    expect(m.totals.ogGenerated).toBe(1);
    expect(m.totals.inserted).toBe(1);
    expect(m.totals.failed).toBe(0);
  });

  it("counts partial stages when entry stops at 'polished'", () => {
    const m = emptyManifest(config, source);
    const e = buildEntry({ sourceWpId: 1, slug: "a", title: "A" });
    e.status = "polished";
    addEntry(m, e);
    expect(m.totals.transformed).toBe(1);
    expect(m.totals.polished).toBe(1);
    expect(m.totals.embedded).toBe(0);
    expect(m.totals.inserted).toBe(0);
  });

  it("counts failed entries in the failed bucket", () => {
    const m = emptyManifest(config, source);
    const e = buildEntry({ sourceWpId: 1, slug: "a", title: "A" });
    e.status = "failed";
    e.errors.push("boom");
    addEntry(m, e);
    expect(m.totals.failed).toBe(1);
  });

  it("counts dry_run as having reached the transformed stage", () => {
    // Regression: dry_run was originally treated as a separate stage
    // with no rollup branch, so every total stayed at zero even when
    // posts were successfully extracted + transformed (the first
    // pnpm migrate-wp:dry-run run showed Extracted=0 / Transformed=0
    // despite "[extract] 1 posts pulled" in stderr).
    const m = emptyManifest(config, source);
    const e = buildEntry({ sourceWpId: 1, slug: "a", title: "A" });
    e.status = "dry_run";
    addEntry(m, e);
    expect(m.totals.extracted).toBe(1);
    expect(m.totals.transformed).toBe(1);
    expect(m.totals.polished).toBe(0);
    expect(m.totals.embedded).toBe(0);
    expect(m.totals.inserted).toBe(0);
    expect(m.totals.failed).toBe(0);
  });

  it("rolls up needsReview separately from status", () => {
    const m = emptyManifest(config, source);
    const e = buildEntry({ sourceWpId: 1, slug: "a", title: "A" });
    e.status = "inserted";
    e.decisions.needsReview = true;
    addEntry(m, e);
    expect(m.totals.inserted).toBe(1);
    expect(m.totals.needsReview).toBe(1);
  });
});

describe("formatSummary", () => {
  it("contains the totals table", () => {
    const m = emptyManifest(config, source);
    const e = buildEntry({ sourceWpId: 1, slug: "test", title: "Test" });
    e.status = "inserted";
    addEntry(m, e);
    const out = formatSummary(m);
    expect(out).toContain("# Migration manifest");
    expect(out).toContain("## Totals");
    expect(out).toContain("| Inserted (Postgres) | 1 |");
  });

  it("renders the Needs review section only when there are flagged posts", () => {
    const m = emptyManifest(config, source);
    expect(formatSummary(m)).not.toContain("## Needs review");

    const e = buildEntry({ sourceWpId: 1, slug: "test", title: "Test" });
    e.status = "inserted";
    e.decisions.needsReview = true;
    e.decisions.currencyConcerns = ["mentions retired model"];
    addEntry(m, e);
    expect(formatSummary(m)).toContain("## Needs review queue");
    expect(formatSummary(m)).toContain("mentions retired model");
  });

  it("renders the Failures section only when there are failures", () => {
    const m = emptyManifest(config, source);
    const e = buildEntry({ sourceWpId: 1, slug: "test", title: "Test" });
    e.status = "failed";
    e.errors.push("boom");
    addEntry(m, e);
    expect(formatSummary(m)).toContain("## Failures");
    expect(formatSummary(m)).toContain("boom");
  });
});
