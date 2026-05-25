import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isTurnstileEnabled,
  requireTurnstile,
  verifyTurnstileToken,
} from "./turnstile";

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("isTurnstileEnabled", () => {
  it("returns false when both env vars unset (default OFF)", () => {
    expect(isTurnstileEnabled()).toBe(false);
  });

  it("returns false when secret missing even if enable=true", () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(isTurnstileEnabled()).toBe(false);
  });

  it("returns false when enable flag missing even if secret set", () => {
    vi.stubEnv("TURNSTILE_ENABLED", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    expect(isTurnstileEnabled()).toBe(false);
  });

  it("returns true when both env vars set to true / present", () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    expect(isTurnstileEnabled()).toBe(true);
  });

  it("accepts '1' as truthy for TURNSTILE_ENABLED", () => {
    vi.stubEnv("TURNSTILE_ENABLED", "1");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    expect(isTurnstileEnabled()).toBe(true);
  });

  it("rejects arbitrary truthy strings (only 'true'/'1' count)", () => {
    vi.stubEnv("TURNSTILE_ENABLED", "yes");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    expect(isTurnstileEnabled()).toBe(false);
  });
});

describe("requireTurnstile — bypass when disabled", () => {
  it("returns ok+bypassed without calling fetch", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const r = await requireTurnstile({ token: "anything", remoteIp: "1.2.3.4" });
    expect(r).toEqual({ ok: true, errorCodes: [], bypassed: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("bypasses even when no token is provided (flag off)", async () => {
    const r = await requireTurnstile({});
    expect(r.ok).toBe(true);
    expect(r.bypassed).toBe(true);
  });
});

describe("requireTurnstile — active path", () => {
  beforeEach(() => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
  });

  it("returns ok=true on Cloudflare success=true", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const r = await requireTurnstile({
      token: "valid-cf-token",
      remoteIp: "1.2.3.4",
    });
    expect(r).toEqual({ ok: true, errorCodes: [], bypassed: false });
    // Verifies the POST body shape — secret + response + remoteip.
    const callArgs = fetchSpy.mock.calls[0][1];
    expect(callArgs?.method).toBe("POST");
    const bodyStr = String(callArgs?.body);
    expect(bodyStr).toContain("secret=test-secret");
    expect(bodyStr).toContain("response=valid-cf-token");
    expect(bodyStr).toContain("remoteip=1.2.3.4");
  });

  it("returns ok=false with error codes on Cloudflare success=false", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          "error-codes": ["invalid-input-response", "timeout-or-duplicate"],
        }),
        { status: 200 },
      ),
    );
    const r = await requireTurnstile({ token: "bad-token" });
    expect(r.ok).toBe(false);
    expect(r.bypassed).toBe(false);
    expect(r.errorCodes).toEqual([
      "invalid-input-response",
      "timeout-or-duplicate",
    ]);
  });

  it("returns ok=false with 'missing-token' when token is empty", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const r = await requireTurnstile({ token: "" });
    expect(r.ok).toBe(false);
    expect(r.errorCodes).toEqual(["missing-token"]);
    // Critical: we never call Cloudflare with an empty token.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns ok=false on non-200 HTTP from Cloudflare", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("server error", { status: 503 }),
    );
    const r = await requireTurnstile({ token: "x" });
    expect(r.ok).toBe(false);
    expect(r.errorCodes).toEqual(["http-503"]);
  });

  it("returns ok=false on network error", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ENETUNREACH"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await requireTurnstile({ token: "x" });
    expect(r.ok).toBe(false);
    expect(r.errorCodes).toEqual(["network-error"]);
    expect(errSpy).toHaveBeenCalled();
  });

  it("returns ok=false on malformed JSON response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const r = await requireTurnstile({ token: "x" });
    expect(r.ok).toBe(false);
    expect(r.errorCodes).toEqual(["malformed-response"]);
  });
});

describe("verifyTurnstileToken (direct)", () => {
  it("returns missing-secret when TURNSTILE_SECRET_KEY unset", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const r = await verifyTurnstileToken({ token: "any" });
    expect(r.ok).toBe(false);
    expect(r.errorCodes).toEqual(["missing-secret"]);
  });

  it("omits remoteip from body when not provided", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await verifyTurnstileToken({ token: "t" });
    const bodyStr = String(fetchSpy.mock.calls[0][1]?.body);
    expect(bodyStr).not.toContain("remoteip=");
  });
});
