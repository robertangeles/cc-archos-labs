import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

// Both browser wire formats have to be understood, because no single browser
// sends both: Firefox and Safari emit the legacy `report-uri` shape, Chrome
// emits the Reporting API array. The field names differ between them
// (kebab-case vs camelCase) — that is the spec, and getting it wrong means the
// endpoint accepts reports and logs "unknown" for every field, which looks like
// it works.

function reportUriRequest(body: unknown, ip = "203.0.113.1"): Request {
  return new Request("https://archoslabs.xyz/api/csp-report", {
    method: "POST",
    headers: {
      "content-type": "application/csp-report",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

/** The JSON blob passed to console.warn for the Nth logged violation. */
function logged(n = 0): Record<string, string> {
  return JSON.parse(warn.mock.calls[n][1] as string);
}

describe("POST /api/csp-report", () => {
  it("parses the report-uri format (Firefox, Safari)", async () => {
    const res = await POST(
      reportUriRequest({
        "csp-report": {
          "document-uri": "https://archoslabs.xyz/blog",
          "blocked-uri": "https://evil.example.com/x.js",
          "violated-directive": "script-src",
          disposition: "report",
        },
      }),
    );

    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(logged()).toMatchObject({
      directive: "script-src",
      blocked: "https://evil.example.com/x.js",
      document: "https://archoslabs.xyz/blog",
    });
  });

  it("parses the Reporting API format (Chrome)", async () => {
    const res = await POST(
      reportUriRequest(
        [
          {
            type: "csp-violation",
            body: {
              documentURL: "https://archoslabs.xyz/",
              blockedURL: "https://connect.facebook.net/en_US/fbevents.js",
              effectiveDirective: "script-src-elem",
              disposition: "reporting",
            },
          },
        ],
        "203.0.113.2",
      ),
    );

    expect(res.status).toBe(204);
    expect(logged()).toMatchObject({
      directive: "script-src-elem",
      blocked: "https://connect.facebook.net/en_US/fbevents.js",
    });
  });

  it("ignores non-CSP entries in a Reporting API batch", async () => {
    await POST(
      reportUriRequest(
        [
          { type: "deprecation", body: { id: "something-else" } },
          {
            type: "csp-violation",
            body: { blockedURL: "inline", effectiveDirective: "style-src" },
          },
        ],
        "203.0.113.3",
      ),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(logged().directive).toBe("style-src");
  });

  // --- Hostile input. This endpoint is unauthenticated and internet-facing. ---

  it("returns 204 and logs nothing on a malformed body", async () => {
    const res = await POST(
      new Request("https://archoslabs.xyz/api/csp-report", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.4" },
        body: "this is not json",
      }),
    );

    expect(res.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it("survives null, a bare string, and a wrong-shaped object", async () => {
    for (const [i, body] of [null, "nope", { unexpected: true }].entries()) {
      const res = await POST(reportUriRequest(body, `198.51.100.${i}`));
      expect(res.status).toBe(204);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not crash when csp-report fields are the wrong types", async () => {
    const res = await POST(
      reportUriRequest(
        {
          "csp-report": {
            "document-uri": 42,
            "blocked-uri": { nested: "object" },
            "violated-directive": null,
          },
        },
        "198.51.100.9",
      ),
    );

    expect(res.status).toBe(204);
    // Non-strings are dropped rather than stringified into the log.
    expect(logged()).toMatchObject({
      directive: "unknown",
      blocked: "unknown",
      document: "unknown",
    });
  });

  it("rate-limits a flooding IP without erroring", async () => {
    const ip = "198.51.100.200";
    const body = {
      "csp-report": { "blocked-uri": "inline", "violated-directive": "script-src" },
    };

    // The limit is 100/IP/hr; 130 attempts must all answer 204 and the logging
    // must stop once the budget is spent.
    for (let i = 0; i < 130; i += 1) {
      const res = await POST(reportUriRequest(body, ip));
      expect(res.status).toBe(204);
    }

    expect(warn.mock.calls.length).toBeLessThanOrEqual(100);
    expect(warn.mock.calls.length).toBeGreaterThan(0);
  });
});
