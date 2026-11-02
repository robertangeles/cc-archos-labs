import { describe, expect, it } from "vitest";
import { fenceValue, newFenceMarker, untrustedFenceInstruction } from "./fence";

describe("untrusted-input fencing", () => {
  it("mints a different marker on every call, so fenced text cannot predict a closing marker", () => {
    expect(newFenceMarker()).not.toBe(newFenceMarker());
    expect(newFenceMarker()).toMatch(/^UNTRUSTED_[0-9a-f-]{36}$/);
  });

  it("wraps the value between the marker on both sides", () => {
    expect(fenceValue("hello", "UNTRUSTED_x")).toBe("<<<UNTRUSTED_x\nhello\nUNTRUSTED_x>>>");
  });

  it("tells the model the fenced text is data, and names the marker it must not repeat", () => {
    const text = untrustedFenceInstruction("UNTRUSTED_x");
    expect(text).toContain("UNTRUSTED_x");
    expect(text).toMatch(/not instructions/);
    expect(text).toMatch(/never reproduce the markers/);
  });
});
