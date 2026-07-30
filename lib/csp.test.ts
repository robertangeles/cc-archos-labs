import { describe, expect, it } from "vitest";
import { buildCsp, makeNonce } from "./csp";

// These tests exist because a CSP fails SILENTLY in both directions. Too loose
// and the protection is theatre; too tight and a third-party tag stops working
// while every page still renders perfectly. Neither shows up in a screenshot,
// and three real defects in this policy were found only by driving a browser.
//
// So the assertions below are deliberately about the exact strings that were
// wrong at some point, not about the general shape of a policy.

function directive(csp: string, name: string): string {
  const found = csp
    .split("; ")
    .find((part) => part === name || part.startsWith(`${name} `));
  if (!found) throw new Error(`no ${name} directive in: ${csp}`);
  return found;
}

describe("makeNonce", () => {
  it("returns a different value every call", () => {
    // A nonce reused across requests is not a nonce — an attacker who can read
    // one response can then inline whatever they like into the next.
    const seen = new Set(Array.from({ length: 200 }, () => makeNonce()));
    expect(seen.size).toBe(200);
  });

  it("carries at least 128 bits of entropy, base64-encoded", () => {
    const nonce = makeNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    // 16 raw bytes -> 24 base64 chars including padding.
    expect(nonce.length).toBeGreaterThanOrEqual(24);
  });

  it("never emits a quote or semicolon that would break out of the header", () => {
    // The nonce is interpolated into 'nonce-...' inside a header value. Base64's
    // alphabet is safe, but assert it rather than trust it.
    for (let i = 0; i < 100; i++) {
      expect(makeNonce()).not.toMatch(/['";\s]/);
    }
  });
});

describe("buildCsp", () => {
  const csp = buildCsp("TESTNONCE==");

  it("puts the nonce in script-src", () => {
    expect(directive(csp, "script-src")).toContain("'nonce-TESTNONCE=='");
  });

  it("does NOT allow 'unsafe-inline' in script-src", () => {
    // The whole point of the nonce. If this assertion ever fails, inline script
    // injection is executable again and the nonce is decoration.
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("does NOT use 'strict-dynamic'", () => {
    // Deliberate: 'strict-dynamic' makes browsers ignore the host allowlist,
    // and Cloudflare injects a bot-management script into our pages at the edge
    // that we never see and cannot nonce. See the note in csp.ts.
    expect(csp).not.toContain("'strict-dynamic'");
  });

  it("KEEPS 'unsafe-inline' in style-src", () => {
    // Not an oversight. Next.js and the font loader emit inline styles that are
    // not nonce-able without a much larger change. Asserted so that removing it
    // has to be a deliberate act with a failing test attached.
    expect(directive(csp, "style-src")).toContain("'unsafe-inline'");
  });

  // Each of the three hosts below was missing at some point today, and each
  // failure was invisible: the page rendered, and a beacon silently died.
  it.each([
    [
      "www.google.com",
      "connect-src",
      "gtag.js builds this transport host at runtime; GA4 posts page_view/scroll/user_engagement here",
    ],
    [
      "www.facebook.com",
      "connect-src",
      "fbevents.js falls back from its img beacon to sendBeacon/fetch on /tr/",
    ],
    [
      "challenges.cloudflare.com",
      "connect-src",
      "Cloudflare's edge-injected bot-management beacon, live even with Turnstile off",
    ],
  ])("allows %s in %s (%s)", (host, name) => {
    expect(directive(csp, name)).toContain(`https://${host}`);
  });

  it("allows GA4's regional endpoints, not just www.google-analytics.com", () => {
    // GA4 routes some traffic to region1.google-analytics.com and friends. A
    // www.-only entry blocks those for the visitors it applies to.
    const connect = directive(csp, "connect-src");
    expect(connect).toContain("https://*.google-analytics.com");
    expect(connect).toContain("https://*.analytics.google.com");
  });

  it("keeps the non-script hardening directives", () => {
    // These are what make the policy worth enforcing even with inline styles
    // still open.
    expect(csp).toContain("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'self'");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
  });

  it("keeps BOTH reporting mechanisms wired", () => {
    // No browser supports both: report-uri is all Firefox and Safari ever
    // implemented, report-to is Chrome's Reporting API. Reporting has to survive
    // the move to enforcing, because GTM can inject a tag from a host this
    // allowlist does not cover and nothing else would tell us.
    expect(csp).toContain("report-uri /api/csp-report");
    expect(csp).toContain("report-to csp-endpoint");
  });

  it("emits each directive exactly once", () => {
    // A duplicated directive is not merged — the browser takes the first and
    // ignores the rest, so a typo'd duplicate silently drops hosts.
    const names = csp.split("; ").map((part) => part.split(" ")[0]);
    expect(names.length).toBe(new Set(names).size);
  });
});
