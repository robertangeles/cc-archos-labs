import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A share link is PUBLIC — token-only, no auth, no audience check. The citation
// strip names works from the practice library, so a shared conversation must
// never carry `sources`.
//
// Asserted at source level because the realistic regression is someone
// replacing the explicit column list with a bare `.select()` while touching
// something else, which reads as a harmless tidy-up and silently publishes the
// shelf to anyone holding a link.

const src = readFileSync(new URL("./service.ts", import.meta.url), "utf8");

describe("share snapshot never carries citation sources", () => {
  const snapshot = src.slice(
    src.indexOf("export async function createShareSnapshot"),
    src.indexOf("export async function getShareByToken"),
  );

  it("isolates the createShareSnapshot body", () => {
    expect(snapshot.length).toBeGreaterThan(200);
  });

  it("selects an explicit column list, not the whole row", () => {
    // `.select()` with no argument returns every column, including sources.
    expect(snapshot).toMatch(/\.select\(\{/);
    expect(snapshot).not.toMatch(/\.select\(\)\s*\n?\s*\.from\(message\)/);
  });

  it("does not include sources in the snapshot", () => {
    expect(snapshot).not.toMatch(/sources:\s*message\.sources/);
  });

  it("still captures the fields a shared transcript needs", () => {
    for (const field of ["role", "content", "contentType", "model", "createdAt"]) {
      expect(snapshot).toMatch(new RegExp(`${field}: message\\.${field}`));
    }
  });
});
