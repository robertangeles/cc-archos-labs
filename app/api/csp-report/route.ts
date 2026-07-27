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
// building the enforcing allowlist, and a violation report can contain the URL
// the user was on.

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
        document: v.documentUrl ?? "unknown",
        disposition: v.disposition ?? "report",
      }),
    );
  }

  // Always 204. The browser has nothing useful to do with any other status.
  return new Response(null, { status: 204 });
}
