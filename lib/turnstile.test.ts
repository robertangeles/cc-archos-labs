import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnstileError } from "./errors/booking";

// Mutable mock config so tests can null out the secret key to exercise
// the "not configured" branch.
const mockConfig = {
  adminPassword: "x",
  resendApiKey: "x",
  llmApiKey: "x",
  contactRecipientEmail: "x@example.com",
  resendFromEmail: "x@example.com",
  llmModelId: null as string | null,
  googleOauthClientId: null as string | null,
  googleOauthClientSecret: null as string | null,
  turnstileSiteKey: "test-site-key" as string | null,
  turnstileSecretKey: "test-secret-key" as string | null,
};

vi.mock("./integration-config", () => ({
  getIntegrationConfig: async () => mockConfig,
}));

const { verifyTurnstile, isTurnstileConfigured } = await import("./turnstile");

beforeEach(() => {
  mockConfig.turnstileSiteKey = "test-site-key";
  mockConfig.turnstileSecretKey = "test-secret-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(handler: (req: Request) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as string, init);
      return handler(req);
    },
  );
}

describe("isTurnstileConfigured", () => {
  it("returns true when the secret key is set", async () => {
    expect(await isTurnstileConfigured()).toBe(true);
  });

  it("returns false when the secret key is null", async () => {
    mockConfig.turnstileSecretKey = null;
    expect(await isTurnstileConfigured()).toBe(false);
  });
});

describe("verifyTurnstile", () => {
  it("throws TurnstileError when secret key is missing", async () => {
    mockConfig.turnstileSecretKey = null;
    await expect(verifyTurnstile({ token: "x" })).rejects.toBeInstanceOf(
      TurnstileError,
    );
  });

  it("returns true on Cloudflare success response", async () => {
    mockFetch(() => Response.json({ success: true }));
    const result = await verifyTurnstile({ token: "good-token" });
    expect(result).toBe(true);
  });

  it("throws TurnstileError when Cloudflare returns success=false", async () => {
    mockFetch(() =>
      Response.json({
        success: false,
        "error-codes": ["invalid-input-response"],
      }),
    );
    await expect(verifyTurnstile({ token: "bad" })).rejects.toBeInstanceOf(
      TurnstileError,
    );
  });

  it("forwards the remoteIp parameter when provided", async () => {
    let capturedBody = "";
    mockFetch(async (req) => {
      capturedBody = await req.text();
      return Response.json({ success: true });
    });
    await verifyTurnstile({ token: "x", remoteIp: "1.2.3.4" });
    expect(capturedBody).toContain("remoteip=1.2.3.4");
  });

  it("throws TurnstileError when fetch fails (network unreachable)", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    await expect(verifyTurnstile({ token: "x" })).rejects.toBeInstanceOf(
      TurnstileError,
    );
  });

  it("throws TurnstileError when Cloudflare returns non-JSON", async () => {
    mockFetch(() => new Response("<html>oops</html>", { status: 200 }));
    await expect(verifyTurnstile({ token: "x" })).rejects.toBeInstanceOf(
      TurnstileError,
    );
  });
});
