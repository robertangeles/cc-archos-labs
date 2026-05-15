import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Contract:
//   - generateState yields cryptographically random base64url tokens
//   - generateAuthUrl produces a Google consent URL with the right params
//   - exchangeCodeForTokens parses Google's response and demands a refresh token
//   - refreshAccessToken throws GoogleAuthErrorRevoked on invalid_grant
//   - getOAuthConfig throws BookingError when DB config is missing
//
// All HTTP calls go through `fetch` which we stub via vi.stubGlobal.
// integration-config is mocked so the OAuth helpers see a controlled
// clientId/clientSecret without a real DB.

const STUB_CONFIG_VALUES = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "http://localhost:3007/api/admin/google-oauth/cb",
};

// Mutable mock so individual tests can null out clientId/clientSecret
// to exercise the "missing config" branches.
const mockConfig = {
  adminPassword: "x",
  resendApiKey: "x",
  llmApiKey: "x",
  contactRecipientEmail: "x@example.com",
  resendFromEmail: "x@example.com",
  llmModelId: null as string | null,
  googleOauthClientId: STUB_CONFIG_VALUES.clientId as string | null,
  googleOauthClientSecret: STUB_CONFIG_VALUES.clientSecret as string | null,
};

vi.mock("./integration-config", () => ({
  getIntegrationConfig: async () => mockConfig,
}));

// Imports must come after vi.mock — Vitest hoists vi.mock so this still works,
// but co-locating them makes the dependency direction obvious.
const {
  exchangeCodeForTokens,
  generateAuthUrl,
  generateState,
  getOAuthConfig,
  refreshAccessToken,
  REQUIRED_SCOPES,
} = await import("./google-oauth");
const { BookingError, GoogleAuthError, GoogleAuthErrorRevoked } = await import(
  "./errors/booking"
);

beforeEach(() => {
  // Reset mock config + env on each test.
  mockConfig.googleOauthClientId = STUB_CONFIG_VALUES.clientId;
  mockConfig.googleOauthClientSecret = STUB_CONFIG_VALUES.clientSecret;
  process.env.GOOGLE_OAUTH_REDIRECT_URI = STUB_CONFIG_VALUES.redirectUri;
});

afterEach(() => {
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  vi.unstubAllGlobals();
});

function mockFetch(handler: (req: Request) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as string, init);
    return handler(req);
  });
}

// ----------------------------------------------------------------------------
// generateState
// ----------------------------------------------------------------------------

describe("generateState", () => {
  it("returns url-safe base64 strings", () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("yields unique values across many calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateState());
    expect(set.size).toBe(1000);
  });
});

// ----------------------------------------------------------------------------
// getOAuthConfig
// ----------------------------------------------------------------------------

describe("getOAuthConfig", () => {
  it("reads clientId+clientSecret from Settings and redirectUri from env", async () => {
    const cfg = await getOAuthConfig();
    expect(cfg.clientId).toBe(STUB_CONFIG_VALUES.clientId);
    expect(cfg.clientSecret).toBe(STUB_CONFIG_VALUES.clientSecret);
    expect(cfg.redirectUri).toBe(STUB_CONFIG_VALUES.redirectUri);
  });

  it("throws BookingError when client id is missing", async () => {
    mockConfig.googleOauthClientId = null;
    await expect(getOAuthConfig()).rejects.toBeInstanceOf(BookingError);
  });

  it("throws BookingError when client secret is missing", async () => {
    mockConfig.googleOauthClientSecret = null;
    await expect(getOAuthConfig()).rejects.toBeInstanceOf(BookingError);
  });

  it("throws BookingError when redirect URI env var is missing", async () => {
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    await expect(getOAuthConfig()).rejects.toBeInstanceOf(BookingError);
  });
});

// ----------------------------------------------------------------------------
// generateAuthUrl
// ----------------------------------------------------------------------------

describe("generateAuthUrl", () => {
  it("contains the consent endpoint", async () => {
    const url = new URL(await generateAuthUrl({ state: "xyz" }));
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  });

  it("requests all REQUIRED_SCOPES", async () => {
    const url = new URL(await generateAuthUrl({ state: "xyz" }));
    const scope = url.searchParams.get("scope") ?? "";
    for (const required of REQUIRED_SCOPES) {
      expect(scope).toContain(required);
    }
  });

  it("requests offline access + consent prompt so a refresh token is issued", async () => {
    const url = new URL(await generateAuthUrl({ state: "xyz" }));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("forwards the state nonce", async () => {
    const url = new URL(await generateAuthUrl({ state: "the-csrf-nonce" }));
    expect(url.searchParams.get("state")).toBe("the-csrf-nonce");
  });

  it("uses the configured client_id and redirect_uri", async () => {
    const url = new URL(await generateAuthUrl({ state: "xyz" }));
    expect(url.searchParams.get("client_id")).toBe(STUB_CONFIG_VALUES.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(
      STUB_CONFIG_VALUES.redirectUri,
    );
  });
});

// ----------------------------------------------------------------------------
// exchangeCodeForTokens
// ----------------------------------------------------------------------------

describe("exchangeCodeForTokens", () => {
  it("returns tokens + computed expiresAt on the happy path", async () => {
    mockFetch(() =>
      Response.json({
        access_token: "acc-tok",
        refresh_token: "ref-tok",
        expires_in: 3600,
        scope: REQUIRED_SCOPES.join(" "),
        token_type: "Bearer",
      }),
    );
    const before = Math.floor(Date.now() / 1000);
    const result = await exchangeCodeForTokens("the-code");
    const after = Math.floor(Date.now() / 1000);
    expect(result.accessToken).toBe("acc-tok");
    expect(result.refreshToken).toBe("ref-tok");
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3600);
    expect(result.expiresAt).toBeLessThanOrEqual(after + 3600);
  });

  it("throws GoogleAuthError when Google returns an error body", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            error: "invalid_request",
            error_description: "Missing code",
          }),
          { status: 400 },
        ),
    );
    await expect(exchangeCodeForTokens("bad")).rejects.toBeInstanceOf(
      GoogleAuthError,
    );
  });

  it("throws GoogleAuthError when Google omits the refresh token", async () => {
    mockFetch(() =>
      Response.json({
        access_token: "acc-tok",
        expires_in: 3600,
        scope: REQUIRED_SCOPES.join(" "),
        token_type: "Bearer",
        // refresh_token deliberately absent
      }),
    );
    await expect(exchangeCodeForTokens("the-code")).rejects.toBeInstanceOf(
      GoogleAuthError,
    );
  });
});

// ----------------------------------------------------------------------------
// refreshAccessToken
// ----------------------------------------------------------------------------

describe("refreshAccessToken", () => {
  it("returns a fresh access token + expiresAt", async () => {
    mockFetch(() =>
      Response.json({
        access_token: "fresh-tok",
        expires_in: 3600,
        scope: REQUIRED_SCOPES.join(" "),
        token_type: "Bearer",
      }),
    );
    const result = await refreshAccessToken("ref-tok");
    expect(result.accessToken).toBe("fresh-tok");
    expect(typeof result.expiresAt).toBe("number");
  });

  it("throws GoogleAuthErrorRevoked on invalid_grant", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          }),
          { status: 400 },
        ),
    );
    await expect(refreshAccessToken("ref-tok")).rejects.toBeInstanceOf(
      GoogleAuthErrorRevoked,
    );
  });

  it("throws GoogleAuthError on a 5xx", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ error: "backend_error" }), {
          status: 503,
        }),
    );
    const error = await refreshAccessToken("ref-tok").catch((e) => e);
    expect(error).toBeInstanceOf(GoogleAuthError);
    expect(error).not.toBeInstanceOf(GoogleAuthErrorRevoked);
  });
});
