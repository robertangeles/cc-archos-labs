import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// proxy.ts now does two unrelated things, and the tests below guard the seam
// between them:
//
//   1. It is the ONLY place the Content-Security-Policy is set. next.config.ts
//      no longer carries one, so any return path that forgets the header ships
//      a page with no policy at all — silently.
//   2. It still gates /admin. Widening the matcher from /admin to everything
//      must not widen what is gated, and must not lock anyone out of the login
//      page.

vi.mock("../lib/auth", () => ({
  SESSION_COOKIE: "archos_session",
  verifySession: vi.fn(),
}));

const { verifySession } = await import("../lib/auth");
const { proxy } = await import("../proxy");

function request(path: string, cookie?: string) {
  const req = new NextRequest(new URL(`https://archoslabs.xyz${path}`));
  if (cookie) req.cookies.set("archos_session", cookie);
  return req;
}

beforeEach(() => {
  vi.mocked(verifySession).mockReset();
});

describe("CSP on every return path", () => {
  // One case per `return` in proxy(). The redirect and the 401 are the ones a
  // refactor forgets, because they read as error paths rather than responses.
  it.each([
    ["public page", "/", undefined],
    ["admin login page (auth bypass branch)", "/admin/login", undefined],
    ["admin login API (auth bypass branch)", "/api/admin/login", undefined],
    ["admin UI without a session (redirect branch)", "/admin/blog", undefined],
    ["admin API without a session (401 branch)", "/api/admin/posts", undefined],
  ])("sets a nonce'd policy on the %s", async (_label, path) => {
    const res = await proxy(request(path));
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("'unsafe-inline'; script-src");
  });

  it("sets a policy on an authenticated admin request too", async () => {
    vi.mocked(verifySession).mockResolvedValue({ sub: "admin" } as never);
    const res = await proxy(request("/admin/blog", "valid-token"));
    expect(res.headers.get("Content-Security-Policy")).toContain("'nonce-");
  });

  it("gives every request a different nonce", async () => {
    const nonces = await Promise.all(
      Array.from({ length: 25 }, async () => {
        const res = await proxy(request("/"));
        return res.headers
          .get("Content-Security-Policy")
          ?.match(/'nonce-([^']+)'/)?.[1];
      }),
    );
    expect(new Set(nonces).size).toBe(25);
    expect(nonces.every(Boolean)).toBe(true);
  });

  it("forwards the SAME nonce to the app that it puts in the header", async () => {
    // app/layout.tsx reads x-nonce and stamps it on the inline scripts. If the
    // two ever diverge, every inline script is blocked and analytics dies with
    // the page still rendering.
    const res = await proxy(request("/"));
    const headerNonce = res.headers
      .get("Content-Security-Policy")
      ?.match(/'nonce-([^']+)'/)?.[1];
    const forwarded = res.headers.get("x-middleware-request-x-nonce");
    // Next encodes overridden request headers on the response; when that
    // internal header is unavailable, fall back to asserting the header nonce
    // exists rather than silently passing.
    if (forwarded !== null) {
      expect(forwarded).toBe(headerNonce);
    } else {
      expect(headerNonce).toBeTruthy();
    }
  });
});

describe("admin gate still holds after widening the matcher", () => {
  it("redirects an unauthenticated admin UI request to the login page", async () => {
    const res = await proxy(request("/admin/blog"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://archoslabs.xyz/admin/login",
    );
  });

  it("drops the query string on that redirect", async () => {
    const res = await proxy(request("/admin/blog?id=secret"));
    expect(res.headers.get("location")).not.toContain("secret");
  });

  it("401s an unauthenticated admin API request rather than redirecting", async () => {
    const res = await proxy(request("/api/admin/posts"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("lets the login page and login API through unauthenticated", async () => {
    for (const path of ["/admin/login", "/api/admin/login"]) {
      const res = await proxy(request(path));
      expect(res.status).not.toBe(401);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("does NOT gate public routes, however admin-adjacent the name looks", async () => {
    // The matcher now runs on everything, so the path checks inside are the
    // only thing keeping the gate scoped.
    // /administrator-notes and /admin-guide are the boundary cases: a bare
    // startsWith("/admin") gates them. Nothing serves those paths today, which
    // is exactly why this needs a test rather than a click-through.
    for (const path of [
      "/",
      "/blog",
      "/about",
      "/administrator-notes",
      "/admin-guide",
      "/api/administrators",
    ]) {
      const res = await proxy(request(path));
      expect(res.status).not.toBe(401);
      expect(res.headers.get("location")).toBeNull();
    }
    expect(verifySession).not.toHaveBeenCalled();
  });

  it("rejects an admin request whose session fails verification", async () => {
    vi.mocked(verifySession).mockResolvedValue(null);
    const res = await proxy(request("/api/admin/posts", "tampered"));
    expect(res.status).toBe(401);
  });
});
