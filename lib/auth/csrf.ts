import { getSiteUrl } from "../site-config";

// CSRF defense via explicit Origin/Referer check. Per plan E3:
//   - Every session cookie is SameSite=Lax (set in lib/auth-server.ts +
//     route handlers). Modern browsers block cross-site form posts at
//     the cookie layer.
//   - This helper adds an explicit second-layer check on every mutating
//     route. Defense in depth without the JS-readable-token surface of
//     double-submit cookies.
//   - OAuth callbacks (Google's GET callback) MUST skip this check
//     because the request legitimately originates cross-site. They use
//     the cryptographic state-cookie pattern instead.

export class CsrfOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsrfOriginError";
  }
}

/**
 * Throw CsrfOriginError if the request didn't originate from our own
 * site. Returns void on success.
 *
 * Strategy:
 *   1. Prefer the `Origin` header (sent by browsers on cross-origin
 *      requests and on same-origin POSTs/PUTs/etc.).
 *   2. Fall back to `Referer` if Origin is missing (some agents drop it).
 *   3. If both are missing, reject — we cannot verify the source.
 *   4. Compare the request origin against `getSiteUrl()`. Must match
 *      exactly on protocol + host + port.
 *
 * Why not look at `Sec-Fetch-Site`? It's the cleanest signal but
 * Safari < 16 + some non-Chromium browsers don't send it. Origin +
 * Referer covers everything modern.
 *
 * Call at the top of every mutating route handler under /api/auth/*
 * and /api/admin/*. Example:
 *
 *   export async function POST(request: NextRequest) {
 *     try { assertSameOriginRequest(request); }
 *     catch (err) {
 *       if (err instanceof CsrfOriginError) {
 *         return Response.json({ error: "csrf" }, { status: 403 });
 *       }
 *       throw err;
 *     }
 *     // ... rest of handler
 *   }
 */
export function assertSameOriginRequest(request: Request): void {
  const siteOrigin = normalizeOrigin(getSiteUrl());

  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");

  const claimed = originHeader ?? extractOriginFromUrl(refererHeader);

  if (!claimed) {
    throw new CsrfOriginError(
      "CSRF check: request is missing both Origin and Referer headers",
    );
  }

  const claimedNormalized = normalizeOrigin(claimed);

  if (claimedNormalized !== siteOrigin) {
    throw new CsrfOriginError(
      `CSRF check: request origin ${claimedNormalized} does not match site ${siteOrigin}`,
    );
  }
}

/**
 * Boolean wrapper for callers that prefer Result-style branching.
 * Equivalent to a try/catch around assertSameOriginRequest.
 */
export function isSameOriginRequest(request: Request): boolean {
  try {
    assertSameOriginRequest(request);
    return true;
  } catch {
    return false;
  }
}

// Normalise a URL string to protocol://host[:port] form. Strips path,
// search, hash, trailing slash. Returns empty string on invalid input.
function normalizeOrigin(input: string): string {
  try {
    const u = new URL(input);
    // url.origin already drops path/search/hash and includes port only
    // if non-default. Browsers emit exactly this form in the Origin header.
    return u.origin;
  } catch {
    return "";
  }
}

function extractOriginFromUrl(input: string | null): string | null {
  if (!input) return null;
  try {
    return new URL(input).origin;
  } catch {
    return null;
  }
}
