// redirect-rules.ts — unit tests

import { describe, expect, it } from "vitest";
import { buildRedirectConfig } from "./redirect-rules";

describe("buildRedirectConfig", () => {
  describe("htaccess", () => {
    const out = buildRedirectConfig("htaccess");

    it("turns RewriteEngine on", () => {
      expect(out).toContain("RewriteEngine On");
    });

    it("matches both apex + www host variants", () => {
      expect(out).toContain("^(?:www\\.)?robertangeles\\.com$");
    });

    it("redirects with 301 to /blog", () => {
      expect(out).toContain("https://archoslabs.xyz/blog");
      expect(out).toContain("[R=301,L]");
    });

    it("includes header comment", () => {
      expect(out).toMatch(/^# Translation Layer migration/);
    });
  });

  describe("nginx", () => {
    const out = buildRedirectConfig("nginx");

    it("emits a server block", () => {
      expect(out).toContain("server {");
      expect(out).toContain("}");
    });

    it("matches both apex + www server names", () => {
      expect(out).toContain("server_name robertangeles.com www.robertangeles.com");
    });

    it("returns 301 to /blog", () => {
      expect(out).toContain("return 301 https://archoslabs.xyz/blog");
    });

    it("listens on 80 and 443", () => {
      expect(out).toContain("listen 80");
      expect(out).toContain("listen 443 ssl");
    });
  });
});
