import { describe, expect, it, vi } from "vitest";

// Mock the getSiteUrl import BEFORE importing the module under test —
// vi.mock hoists, so this is safe.
vi.mock("../site-config", () => ({
  getSiteUrl: () => "https://archoslabs.xyz",
}));

import {
  assertSameOriginRequest,
  isSameOriginRequest,
  CsrfOriginError,
} from "./csrf";

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://archoslabs.xyz/api/auth/login", {
    method: "POST",
    headers,
  });
}

describe("assertSameOriginRequest", () => {
  it("accepts a request with matching Origin", () => {
    const r = makeRequest({ origin: "https://archoslabs.xyz" });
    expect(() => assertSameOriginRequest(r)).not.toThrow();
  });

  it("accepts a request with matching Referer when Origin missing", () => {
    const r = makeRequest({ referer: "https://archoslabs.xyz/sign-in" });
    expect(() => assertSameOriginRequest(r)).not.toThrow();
  });

  it("rejects a request with mismatched Origin", () => {
    const r = makeRequest({ origin: "https://evil.example.com" });
    expect(() => assertSameOriginRequest(r)).toThrow(CsrfOriginError);
    expect(() => assertSameOriginRequest(r)).toThrow(/does not match/);
  });

  it("rejects when both Origin and Referer are missing", () => {
    const r = makeRequest({});
    expect(() => assertSameOriginRequest(r)).toThrow(CsrfOriginError);
    expect(() => assertSameOriginRequest(r)).toThrow(/missing both/);
  });

  it("rejects an Origin with a different port (subtle attack vector)", () => {
    const r = makeRequest({ origin: "https://archoslabs.xyz:8443" });
    expect(() => assertSameOriginRequest(r)).toThrow(CsrfOriginError);
  });

  it("rejects an Origin with a different protocol (http vs https)", () => {
    const r = makeRequest({ origin: "http://archoslabs.xyz" });
    expect(() => assertSameOriginRequest(r)).toThrow(CsrfOriginError);
  });

  it("prefers Origin over Referer when both are present", () => {
    // Origin matches, Referer points elsewhere → still allowed.
    const r = makeRequest({
      origin: "https://archoslabs.xyz",
      referer: "https://other-site.example/some-page",
    });
    expect(() => assertSameOriginRequest(r)).not.toThrow();
  });

  it("rejects when Origin is invalid URL", () => {
    const r = makeRequest({ origin: "not a url at all" });
    expect(() => assertSameOriginRequest(r)).toThrow(CsrfOriginError);
  });
});

describe("isSameOriginRequest (boolean wrapper)", () => {
  it("returns true on a same-origin request", () => {
    expect(
      isSameOriginRequest(makeRequest({ origin: "https://archoslabs.xyz" })),
    ).toBe(true);
  });

  it("returns false on a cross-origin request", () => {
    expect(
      isSameOriginRequest(
        makeRequest({ origin: "https://attacker.example.com" }),
      ),
    ).toBe(false);
  });

  it("returns false when both headers missing (no throw)", () => {
    expect(isSameOriginRequest(makeRequest({}))).toBe(false);
  });
});

describe("CsrfOriginError class", () => {
  it("has name=CsrfOriginError for instanceof + name checks", () => {
    try {
      assertSameOriginRequest(makeRequest({}));
    } catch (err) {
      expect(err).toBeInstanceOf(CsrfOriginError);
      expect((err as Error).name).toBe("CsrfOriginError");
    }
  });
});
