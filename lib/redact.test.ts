import { describe, expect, it } from "vitest";
import { redactEmail, redactReason, sha8 } from "./redact";

// Contract: redaction is deterministic, domain-preserving for emails,
// length-preserving for reasons. These invariants are what makes the
// hash useful for join-by-hash debugging.

describe("sha8", () => {
  it("is deterministic", () => {
    expect(sha8("hello")).toBe(sha8("hello"));
  });

  it("returns 8 hex chars", () => {
    const out = sha8("anything");
    expect(out).toMatch(/^[0-9a-f]{8}$/);
  });

  it("distinguishes near-identical inputs", () => {
    expect(sha8("foo@bar.com")).not.toBe(sha8("foo@bar.co"));
  });
});

describe("redactEmail", () => {
  it("hashes the local part, preserves the domain", () => {
    const out = redactEmail("jane.doe@example.com");
    expect(out).toMatch(/^[0-9a-f]{8}@example\.com$/);
  });

  it("is deterministic for the same email", () => {
    expect(redactEmail("rob@archoslabs.xyz")).toBe(
      redactEmail("rob@archoslabs.xyz"),
    );
  });

  it("distinguishes two emails with the same domain", () => {
    expect(redactEmail("a@x.com")).not.toBe(redactEmail("b@x.com"));
  });

  it("hashes malformed (no @) input without appending a domain", () => {
    const out = redactEmail("not-an-email");
    expect(out).toMatch(/^[0-9a-f]{8}$/);
    expect(out).not.toContain("@");
  });

  it("handles emails with multiple @ by using the last one as the split", () => {
    const out = redactEmail("weird@local@example.com");
    expect(out).toMatch(/^[0-9a-f]{8}@example\.com$/);
  });
});

describe("redactReason", () => {
  it("returns length + sha8 hash", () => {
    const out = redactReason("I want to understand AI readiness");
    expect(out.length).toBe(33);
    expect(out.sha8).toMatch(/^[0-9a-f]{8}$/);
  });

  it("yields zero length for empty input but still hashes it", () => {
    const out = redactReason("");
    expect(out.length).toBe(0);
    expect(out.sha8).toMatch(/^[0-9a-f]{8}$/);
  });

  it("distinguishes different reasons of the same length", () => {
    const a = redactReason("abc");
    const b = redactReason("xyz");
    expect(a.sha8).not.toBe(b.sha8);
  });
});
