import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

// scripts/radar-gate-report.mjs must refuse to run without an explicit rubric
// version (ENG-D9): the gate counts one cohort at a time. The report itself is
// tested in lib/news-radar/gate-report.test.ts.

const run = (args: string[]) =>
  spawnSync(process.execPath, ["--no-warnings", "scripts/radar-gate-report.mjs", ...args], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "postgresql://nobody@127.0.0.1:1/none" },
  });

describe("radar-gate-report requires an explicit version", () => {
  it.each([[[]], [["--version"]], [["--version", "abc"]], [["--version", "0"]], [["--version", "1.5"]], [["--version", "-2"]]])(
    "exits 1 for %j before touching the database",
    (args) => {
      const r = run(args);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("An explicit rubric version is required");
      expect(r.stdout).not.toContain("Database host");
    },
  );
});
