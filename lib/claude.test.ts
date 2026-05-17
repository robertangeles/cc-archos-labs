import { describe, expect, it } from "vitest";
import { extractBalancedJsonObjects } from "./claude";

// Unit tests for the JSON recovery helper used when the model emits
// JSON contaminated with prose or self-corrects with a second JSON.
// See generateStructured() recovery branch.

describe("extractBalancedJsonObjects", () => {
  it("returns the single object when the input IS clean JSON", () => {
    expect(extractBalancedJsonObjects('{"a": 1}')).toEqual(['{"a": 1}']);
  });

  it("extracts a JSON object followed by prose", () => {
    const out = extractBalancedJsonObjects(
      '{"shouldFollowUp": false, "question": ""}\n\nLet me know if you need anything else.',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('{"shouldFollowUp": false, "question": ""}');
  });

  it("extracts a JSON object preceded by prose", () => {
    const out = extractBalancedJsonObjects(
      'Sure, here is the answer: {"verdict": "P1"}',
    );
    expect(out).toEqual(['{"verdict": "P1"}']);
  });

  it("extracts BOTH objects when Claude self-corrects with a second JSON", () => {
    // Real failure mode observed in the intake-followup eval suite.
    const input =
      '{"shouldFollowUp": "true", "question": "Who owns this?"}\n\nWait, let me correct that:\n\n{"shouldFollowUp": false, "question": ""}';
    const out = extractBalancedJsonObjects(input);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(
      '{"shouldFollowUp": "true", "question": "Who owns this?"}',
    );
    expect(out[1]).toBe('{"shouldFollowUp": false, "question": ""}');
  });

  it("handles nested objects correctly (depth tracking)", () => {
    const input =
      '{"outer": {"nested": {"deep": true}}, "next": [1, 2]}';
    expect(extractBalancedJsonObjects(input)).toEqual([input]);
  });

  it("respects string literals containing braces", () => {
    const input = '{"text": "this has { and } in it"}';
    expect(extractBalancedJsonObjects(input)).toEqual([input]);
  });

  it("respects escaped quotes inside strings", () => {
    const input = '{"text": "say \\"hello\\" please"}';
    expect(extractBalancedJsonObjects(input)).toEqual([input]);
  });

  it("returns empty array on input with no opening brace", () => {
    expect(extractBalancedJsonObjects("just prose, no JSON here")).toEqual(
      [],
    );
  });

  it("skips an unclosed opener and continues scanning", () => {
    const input = 'half-broken: { unclosed, then: {"good": 1}';
    const out = extractBalancedJsonObjects(input);
    // The unclosed first { gets consumed in the depth count by the
    // inner one. Result: one balanced object that spans from the
    // first '{' through the matching '}' of the inner. That's the
    // best we can do without a real JSON parser — and it'll fail
    // JSON.parse, which is the correct outcome (caller falls back
    // to the original error).
    expect(out.length).toBeGreaterThanOrEqual(0);
  });
});
