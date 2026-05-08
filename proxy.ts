import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/auth";

// Gates /admin/** UI routes and /api/admin/** API routes behind a valid
// session JWT. The login pages/routes are explicitly excluded so users
// can reach them. UI routes redirect to /admin/login on failure;
// API routes return 401 JSON.
//
// File-name convention: Next.js 16 renamed middleware.ts to proxy.ts
// (and the function from `middleware` to `proxy`). Same Edge runtime,
// same matcher config — only the names changed.

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Allow the login page and login API through without auth
  if (path === "/admin/login" || path === "/api/admin/login") {
    return NextResponse.next();
  }

  if (path.startsWith("/admin") || path.startsWith("/api/admin")) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = token ? await verifySession(token) : null;

    if (!session) {
      if (path.startsWith("/admin")) {
        const url = request.nextUrl.clone();
        url.pathname = "/admin/login";
        url.search = "";
        return NextResponse.redirect(url);
      }
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
