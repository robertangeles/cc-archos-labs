import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/auth";
import { buildCsp, makeNonce } from "./lib/csp";

// Two jobs, deliberately in one place because both need to run before the app:
//
//   1. Mint a per-request CSP nonce and set the Content-Security-Policy header.
//      This runs on EVERY document request, which is why the matcher below is
//      broad. A static headers() block in next.config.ts cannot do this — a
//      nonce that is the same on every response is not a nonce.
//
//   2. Gate /admin/** UI routes and /api/admin/** API routes behind a valid
//      session JWT. The login pages/routes are explicitly excluded so users can
//      reach them. UI routes redirect to /admin/login on failure; API routes
//      return 401 JSON.
//
// The auth checks stay path-scoped, so widening the matcher for the CSP does not
// widen what is gated.
//
// File-name convention: Next.js 16 renamed middleware.ts to proxy.ts (and the
// function from `middleware` to `proxy`). Same Edge runtime, same matcher
// config — only the names changed.

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const nonce = makeNonce();
  const csp = buildCsp(nonce);

  // Every return path gets the header, including the redirect and the 401.
  // Missing it on an early return is how a route silently ends up with no
  // policy at all.
  const withCsp = <T extends NextResponse>(response: T): T => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  // The nonce reaches the app through x-nonce, which app/layout.tsx reads.
  //
  // Content-Security-Policy is set on the REQUEST as well, and that is not
  // redundant: it is how Next.js discovers the nonce and applies it to the
  // script tags IT emits — the RSC flight-data blocks and the bootstrap
  // scripts, about two dozen per page. Without this line those get no nonce and
  // every page breaks the moment 'unsafe-inline' is gone.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const forward = () =>
    withCsp(NextResponse.next({ request: { headers: requestHeaders } }));

  // Allow the login page and login API through without auth
  if (path === "/admin/login" || path === "/api/admin/login") {
    return forward();
  }

  // Segment-boundary matching, NOT startsWith("/admin").
  //
  // This used to be a bare startsWith, which was safe only because the matcher
  // fed this function nothing but /admin/* and /api/admin/*. Widening the
  // matcher for the CSP removed that guarantee and turned it into a trap:
  // startsWith("/admin") also matches /administrator-notes, /admin-guide, and
  // any future public route whose name merely begins with those letters, which
  // would have been redirected to the login page. Caught by a test, not by
  // clicking around — there is no such route today, so nothing would have looked
  // broken until someone added one.
  const isAdminUi = path === "/admin" || path.startsWith("/admin/");
  const isAdminApi = path === "/api/admin" || path.startsWith("/api/admin/");

  if (isAdminUi || isAdminApi) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = token ? await verifySession(token) : null;

    if (!session) {
      if (isAdminUi) {
        const url = request.nextUrl.clone();
        url.pathname = "/admin/login";
        url.search = "";
        return withCsp(NextResponse.redirect(url));
      }
      return withCsp(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }
  }

  return forward();
}

export const config = {
  // Everything except Next's own build output.
  //
  // This deliberately does NOT hand-maintain a list of asset extensions to skip.
  // A first pass did, and it silently dropped the CSP from /sitemap.xml and
  // /robots.txt, which the old static header block in next.config.ts had
  // covered — a coverage regression for no real gain. It also meant reasoning
  // about which extensions can execute script (.svg can, when opened as a
  // top-level document), which is exactly the kind of judgement call that goes
  // stale.
  //
  // _next/static and _next/image are safe to skip because they are Next's own
  // compiled output, never a document, and the highest-volume paths by far.
  // Everything else — pages, API routes, /public files, sitemap, robots — gets
  // the header. The cost is one cheap invocation: the auth branch short-circuits
  // on any path outside /admin, and Cloudflare fronts the static files anyway.
  //
  // Note /api IS matched, and must be: excluding it would strip /api/admin's
  // auth gate.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
