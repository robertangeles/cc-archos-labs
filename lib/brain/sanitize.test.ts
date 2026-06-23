import { describe, it, expect } from "vitest";
import { sanitizeForBrain } from "./sanitize";

describe("sanitizeForBrain", () => {
  it("passes through clean text unchanged", () => {
    const text = "The quarterly report shows growth in AI adoption.";
    const result = sanitizeForBrain(text);
    expect(result.sanitized).toBe(text);
    expect(result.redactedCount).toBe(0);
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeForBrain("").sanitized).toBe("");
    expect(sanitizeForBrain("").redactedCount).toBe(0);
  });

  describe("email detection", () => {
    it("redacts email addresses", () => {
      const result = sanitizeForBrain("Contact me at rob@example.com please");
      expect(result.sanitized).toBe("Contact me at [REDACTED:EMAIL] please");
      expect(result.redactedCount).toBe(1);
    });

    it("redacts multiple emails", () => {
      const result = sanitizeForBrain("Send to a@b.com and c@d.org");
      expect(result.redactedCount).toBe(2);
      expect(result.sanitized).not.toContain("@");
    });
  });

  describe("credit card detection", () => {
    it("redacts valid Luhn card numbers", () => {
      const result = sanitizeForBrain("Card: 4111 1111 1111 1111");
      expect(result.sanitized).toContain("[REDACTED:CARD]");
      expect(result.redactedCount).toBe(1);
    });

    it("does not redact numbers failing Luhn", () => {
      const result = sanitizeForBrain("Code: 1234 5678 9012 3456");
      expect(result.sanitized).not.toContain("[REDACTED:CARD]");
      expect(result.redactedCount).toBe(0);
    });

    it("does not redact short number sequences", () => {
      const result = sanitizeForBrain("The year is 2026 and project 42 is active");
      expect(result.redactedCount).toBe(0);
    });
  });

  describe("API key detection", () => {
    it("redacts OpenAI-style keys", () => {
      const result = sanitizeForBrain("Key: sk-abc123def456ghi789jkl012mno345");
      expect(result.sanitized).toContain("[REDACTED:KEY]");
    });

    it("redacts AWS access keys", () => {
      const result = sanitizeForBrain("AWS: AKIAIOSFODNN7EXAMPLE");
      expect(result.sanitized).toContain("[REDACTED:KEY]");
    });

    it("redacts GitHub PATs", () => {
      const result = sanitizeForBrain("Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
      expect(result.sanitized).toContain("[REDACTED:KEY]");
    });
  });

  describe("AU TFN detection", () => {
    it("redacts valid TFNs", () => {
      // 123 456 782 is a well-known test TFN that passes the check algorithm
      const result = sanitizeForBrain("TFN: 123 456 782");
      expect(result.sanitized).toContain("[REDACTED:TFN]");
    });

    it("does not redact 9-digit numbers failing TFN check", () => {
      const result = sanitizeForBrain("Ref: 111 222 333");
      expect(result.sanitized).not.toContain("[REDACTED:TFN]");
    });
  });

  describe("AU Medicare detection", () => {
    it("redacts Medicare numbers", () => {
      const result = sanitizeForBrain("Medicare: 2123 45670 1");
      expect(result.sanitized).toContain("[REDACTED:MEDICARE]");
    });
  });

  describe("phone detection", () => {
    it("redacts AU mobile numbers", () => {
      const result = sanitizeForBrain("Call 0412 345 678");
      expect(result.sanitized).toContain("[REDACTED:PHONE]");
    });

    it("redacts AU numbers with country code", () => {
      const result = sanitizeForBrain("Call +61 412 345 678");
      expect(result.sanitized).toContain("[REDACTED:PHONE]");
    });

    it("redacts international numbers", () => {
      const result = sanitizeForBrain("Call +1 555 123 4567");
      expect(result.sanitized).toContain("[REDACTED:PHONE]");
    });
  });

  describe("passport detection", () => {
    it("redacts AU passport numbers", () => {
      const result = sanitizeForBrain("Passport: PA1234567");
      expect(result.sanitized).toContain("[REDACTED:PASSPORT]");
    });
  });

  describe("multiple PII types", () => {
    it("redacts all PII in a single string", () => {
      const text = "Email rob@test.com, phone 0412 345 678, passport PA1234567";
      const result = sanitizeForBrain(text);
      expect(result.redactedCount).toBeGreaterThanOrEqual(3);
      expect(result.sanitized).not.toContain("rob@test.com");
      expect(result.sanitized).not.toContain("0412 345 678");
      expect(result.sanitized).not.toContain("PA1234567");
    });
  });

  describe("truncation", () => {
    it("truncates content over 50KB", () => {
      const text = "a".repeat(60_000);
      const result = sanitizeForBrain(text);
      expect(result.sanitized.length).toBeLessThan(55_000);
      expect(result.sanitized).toContain("[TRUNCATED]");
    });
  });

  describe("performance", () => {
    // Guards against catastrophic regex backtracking (ReDoS) in the sanitiser
    // — that failure mode manifests as multi-second hangs, so a generous
    // ceiling catches it while not flaking on a loaded CI runner, where a
    // healthy run (single-digit ms) can still spike on GC/scheduling. The old
    // 50ms ceiling was a flake risk for that reason.
    it("processes 10KB input well under 500ms (ReDoS guard)", () => {
      const text = "This is a normal conversation about project planning. ".repeat(200);
      const start = performance.now();
      sanitizeForBrain(text);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(500);
    });
  });
});
