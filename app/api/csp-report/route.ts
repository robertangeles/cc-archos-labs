import { clientIpFromRequest, rateLimit } from "@/lib/rate-limit";

// Collector for Content-Security-Policy violation reports.
//
// This exists so the Report-Only policy in next.config.ts is actually
// OBSERVABLE. A Report-Only header with nowhere to send reports is inert: it
// can never be safely promoted to enforcing, because nobody ever learns what
// enforcing would have broken.
//
// Two wire formats arrive here, and both are handled, because no single
// browser sends both:
//
//   report-uri  → Content-Type: application/csp-report
//                 body: { "csp-report": { "blocked-uri": ..., ... } }
//                 Firefox and Safari support ONLY this. Chrome also sends it.
//
//   report-to   → Content-Type: application/reports+json
//                 body: [ { type: "csp-violation", body: { blockedURL: ... } } ]
//                 Chrome's Reporting API. Requires the group named in the
//                 `report-to` directive to be declared by a separate
//                 Reporting-Endpoints response header — see next.config.ts.
//
// Note the field names differ between the two formats (kebab-case vs camelCase).
// That is the spec, not a typo.
//
// Reports are logged, never persisted: they are transient diagnostics for
// building the enforcing allowlist.
//
// The document URL is REDACTED to its first path segment before logging.
// Several public routes carry single-use secrets in the path rather than a
// query string — /auth/password-reset/[token], /book/manage/[token],
// /share/chat/[token], /tools/ai-readiness/share/[token] — and the CSP header
// is applied site-wide, so an unredacted document-uri would drop a live token
// into Render's log stream. Redacting by position rather than by a list of
// known routes means a token route added later is covered automatically.
//
// blocked-uri is NOT redacted: it names the resource the policy stopped, which
// is the entire signal needed to build the allowlist, and app tokens do not
// appear in resource URLs.

export const dynamic = "force-dynamic";

/** Generous — a single page load can legitimately emit several violations. */
const REPORTS_PER_IP_PER_HOUR = 100;

type LoggedViolation = {
  documentUrl?: string;
  blockedUrl?: string;
  violatedDirective?: string;
  disposition?: string;
};

/** Narrow an unknown JSON value to a string, or undefined. */
function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Reduce a document URL to origin + first path segment, dropping everything
 * deeper along with any query string.
 *
 *   /auth/password-reset/9f3c-secret  →  https://host/auth/…
 *   /blog/some-post                   →  https://host/blog/…
 *   /                                 →  https://host/
 *
 * Enough to know roughly where a violation fired, structurally incapable of
 * carrying a token. Anything that is not an http(s) URL is dropped rather than
 * logged raw — this field is attacker-controlled, and `new URL()` happily
 * parses `javascript:alert(1)` into an origin of "null" with the payload
 * sitting in the pathname.
 */
function redactDocumentUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "(unparseable)";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "(unparseable)";
  }
  const [first] = url.pathname.split("/").filter(Boolean);
  return first ? `${url.origin}/${first}/…` : `${url.origin}/`;
}

function fromReportUri(body: unknown): LoggedViolation[] {
  if (typeof body !== "object" || body === null) return [];
  const report = (body as Record<string, unknown>)["csp-report"];
  if (typeof report !== "object" || report === null) return [];
  const r = report as Record<string, unknown>;
  return [
    {
      documentUrl: str(r["document-uri"]),
      blockedUrl: str(r["blocked-uri"]),
      violatedDirective: str(r["violated-directive"]) ?? str(r["effective-directive"]),
      disposition: str(r["disposition"]),
    },
  ];
}

function fromReportingApi(body: unknown): LoggedViolation[] {
  if (!Array.isArray(body)) return [];
  return body
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null,
    )
    .filter((entry) => entry.type === "csp-violation")
    .map((entry) => {
      const b = (entry.body ?? {}) as Record<string, unknown>;
      return {
        documentUrl: str(b.documentURL),
        blockedUrl: str(b.blockedURL),
        violatedDirective: str(b.effectiveDirective),
        disposition: str(b.disposition),
      };
    });
}

export async function POST(request: Request): Promise<Response> {
  const ip = clientIpFromRequest(request);
  const limit = rateLimit(`csp-report:ip:${ip}`, REPORTS_PER_IP_PER_HOUR);
  // 204 rather than 429: browsers do not retry or surface reporting failures,
  // and a 4xx here would be pure noise in the origin's error metrics.
  if (!limit.ok) return new Response(null, { status: 204 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  const violations = [...fromReportUri(payload), ...fromReportingApi(payload)];

  for (const v of violations) {
    // Single-line and structured so Render's log search can group by directive.
    console.warn(
      "[csp-report]",
      JSON.stringify({
        directive: v.violatedDirective ?? "unknown",
        blocked: v.blockedUrl ?? "unknown",
        document: redactDocumentUrl(v.documentUrl) ?? "unknown",
        disposition: v.disposition ?? "report",
      }),
    );
  }

  // Always 204. The browser has nothing useful to do with any other status.
  return new Response(null, { status: 204 });
}
