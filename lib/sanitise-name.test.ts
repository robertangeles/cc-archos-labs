import { describe, expect, it } from "vitest";
import { sanitiseName } from "./sanitise-name";

// Contract: the home page print-personalisation header uses this output
// directly inside React's auto-escaping JSX. The sanitiser is the only
// trust boundary between the ?name= URL param and the rendered DOM —
// anything that gets past it will appear verbatim to a board reader.

describe("sanitiseName", () => {
  it("accepts a plain first name", () => {
    expect(sanitiseName("Jane")).toBe("Jane");
  });

  it("accepts a first and last name with a space", () => {
    expect(sanitiseName("Jane Smith")).toBe("Jane Smith");
  });

  it("accepts hyphenated names", () => {
    expect(sanitiseName("Mary-Jane")).toBe("Mary-Jane");
  });

  it("accepts names with apostrophes", () => {
    expect(sanitiseName("O'Brien")).toBe("O'Brien");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitiseName("   Jane   ")).toBe("Jane");
  });

  it("rejects null", () => {
    expect(sanitiseName(null)).toBeNull();
  });

  it("rejects undefined", () => {
    expect(sanitiseName(undefined)).toBeNull();
  });

  it("rejects empty string", () => {
    expect(sanitiseName("")).toBeNull();
  });

  it("rejects whitespace-only input", () => {
    expect(sanitiseName("   ")).toBeNull();
  });

  it("rejects HTML/script injection attempts", () => {
    expect(sanitiseName("<script>alert(1)</script>")).toBeNull();
  });

  it("rejects names that start with a non-letter", () => {
    expect(sanitiseName("1Jane")).toBeNull();
    expect(sanitiseName("-Jane")).toBeNull();
    expect(sanitiseName("'Jane")).toBeNull();
  });

  it("rejects strings containing digits", () => {
    expect(sanitiseName("Jane2")).toBeNull();
  });

  it("rejects strings containing special characters", () => {
    expect(sanitiseName("Jane@Doe")).toBeNull();
    expect(sanitiseName("Jane.Doe")).toBeNull();
    expect(sanitiseName("Jane_Doe")).toBeNull();
  });

  it("rejects strings over 50 characters", () => {
    const tooLong = "A".repeat(51);
    expect(sanitiseName(tooLong)).toBeNull();
  });

  it("accepts strings exactly 50 characters", () => {
    const exactly50 = "A".repeat(50);
    expect(sanitiseName(exactly50)).toBe(exactly50);
  });

  it("accepts accented characters? no — V1 is ASCII-only", () => {
    // Documents the V1 trade-off: real ASCII-name false positives are
    // extremely rare; broadening the pattern can wait for evidence.
    expect(sanitiseName("José")).toBeNull();
  });
});
