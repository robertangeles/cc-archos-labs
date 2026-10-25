import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// scripts/radar-rubric-set.mjs --dry-run: validates a rubric file with the same
// schema the radar uses and never touches the database (version increments are
// proven in tests/radar-schema.test.ts).

const dir = mkdtempSync(join(tmpdir(), "rubric-"));

const VALID = {
  model: "jev-1.14.0",
  questions: {
    audience_fit: {
      instructions: "How useful is this to a data and AI leader in a regulated industry?",
      criteria: ["Irrelevant", "Passing interest", "Useful context", "Directly affects their program"],
    },
  },
  cutoffs: { audienceFit: 2, confidence: 0.6, minNoveltyDistance: 0.3, dailyCap: 3 },
};

function run(contents: string | null, extra: string[] = ["--dry-run"]) {
  const file = join(dir, `rubric-${Math.random().toString(36).slice(2)}.json`);
  if (contents !== null) writeFileSync(file, contents);
  return spawnSync(
    process.execPath,
    ["--no-warnings", "scripts/radar-rubric-set.mjs", file, ...extra],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } },
  );
}

describe("radar-rubric-set --dry-run", () => {
  it("accepts a valid rubric, prints the cut-offs and writes nothing", () => {
    const r = run(JSON.stringify(VALID));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Rubric valid: model jev-1.14.0");
    expect(r.stdout).toContain("audience fit >= 2");
    expect(r.stdout).toContain("Dry run: nothing written.");
  });

  it("rejects a config with a cut-off above the scale, naming the field", () => {
    const bad = { ...VALID, cutoffs: { ...VALID.cutoffs, audienceFit: 9 } };
    const r = run(JSON.stringify(bad));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("cutoffs.audienceFit");
  });

  it("rejects an unknown key, a bad model pin, and a missing audience_fit", () => {
    expect(run(JSON.stringify({ ...VALID, extra: 1 })).status).toBe(1);
    expect(run(JSON.stringify({ ...VALID, model: "jev-latest" })).status).toBe(1);
    expect(run(JSON.stringify({ ...VALID, questions: {} })).status).toBe(1);
  });

  it("rejects invalid JSON and a missing file with plain messages", () => {
    const bad = run("{ not json");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("is not valid JSON");
    const missing = run(null);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Cannot read");
  });

  it("refuses to write without a database url when not a dry run", () => {
    const r = run(JSON.stringify(VALID), []);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("DATABASE_URL not set");
  });
});
