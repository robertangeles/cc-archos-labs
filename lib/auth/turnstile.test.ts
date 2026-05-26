import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// turnstile.ts now consults ./settings (DB) first, env fallback. Mock
// settings as a default-disabled view so env-based tests still pass.
// Per-test overrides exercise the DB-first path explicitly.
const { getAuthSettingsMock, getTurnstileSecretPlainMock } = vi.hoisted(() => ({
  getAuthSettingsMock: vi.fn(),
  getTurnstileSecretPlainMock: vi.fn(),
}));

vi.mock("./settings", () => ({
  getAuthSettings: getAuthSettingsMock,
  getTurnstileSecretPlain: getTurnstileSecretPlainMock,
}));

import {
  isTurnstileEnabled,
  requireTurnstile,
  verifyTurnstileToken,
} from "./turnstile";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  // Default DB view: all OFF → helper falls through to env.
  getAuthSettingsMock.mockResolvedValue({
    turnstileEnabled: false,
    turnstileSiteKey: "",
    turnstileHasSecret: false,
    publicSignupEnabled: false,
  });
  getTurnstileSecretPlainMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("isTurnstileEnabled", () => {
  it("returns false when both env vars unset (default OFF)", async () => {
    expect(await isTurnstileEnabled()).toBe(false);
  });

  it("returns false when secret missing even if enable=true", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(await isTurnstileEnabled()).toBe(false);
  });

  it("returns false when enable flag missing even if secret set", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    expect(await isTurnstileEnabled()).toBe(false);
  });

  it("returns true when both env vars set to true / present", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    expect(await isTurnstileEnabled()).toBe(true);
  });

  it("accepts '1' as truthy for TURNSTILE_ENABLED", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "1");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    expect(await isTurnstileEnabled()).toBe(true);
  });

  it("rejects arbitrary truthy strings (only 'true'/'1' count)", async () => {
    vi.stubEnv("TURNSTILE_ENABLED", "yes");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    expect(await isTurnstileEnabled()).toBe(false);
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

describe("DB-first config resolution (T8)", () => {
  it("uses DB secret when DB says enabled, ignoring env entirely", async () => {
    // DB says enabled with a stored secret.
    getAuthSettingsMock.mockResolvedValue({
      turnstileEnabled: true,
      turnstileSiteKey: "0xSITE",
      turnstileHasSecret: true,
      publicSignupEnabled: false,
    });
    getTurnstileSecretPlainMock.mockResolvedValue("db-secret-value");
    // Env says disabled — DB wins.
    vi.stubEnv("TURNSTILE_ENABLED", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const r = await requireTurnstile({ token: "t" });
    expect(r.ok).toBe(true);
    expect(r.bypassed).toBe(false);
    const bodyStr = String(fetchSpy.mock.calls[0][1]?.body);
    expect(bodyStr).toContain("secret=db-secret-value");
  });

  it("falls back to env secret when DB enabled but secret missing", async () => {
    getAuthSettingsMock.mockResolvedValue({
      turnstileEnabled: true,
      turnstileSiteKey: "",
      turnstileHasSecret: false, // no DB secret
      publicSignupEnabled: false,
    });
    getTurnstileSecretPlainMock.mockResolvedValue(null);
    vi.stubEnv("TURNSTILE_SECRET_KEY", "env-fallback-secret");

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const r = await requireTurnstile({ token: "t" });
    expect(r.ok).toBe(true);
    const bodyStr = String(fetchSpy.mock.calls[0][1]?.body);
    expect(bodyStr).toContain("secret=env-fallback-secret");
  });

  it("bypasses when DB throws AND env not configured", async () => {
    getAuthSettingsMock.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await requireTurnstile({ token: "t" });
    expect(r).toEqual({ ok: true, errorCodes: [], bypassed: true });
    expect(errSpy).toHaveBeenCalled();
  });
});

describe("verifyTurnstileToken (direct)", () => {
  it("returns missing-secret when TURNSTILE_SECRET_KEY unset", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const r = await verifyTurnstileToken({ token: "any" });
    expect(r.ok).toBe(false);
    expect(r.errorCodes).toEqual(["missing-secret"]);
  });

  it("omits remoteip from body when not provided (with explicit secret override)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    await verifyTurnstileToken({ token: "t", secret: "test-secret" });
    const bodyStr = String(fetchSpy.mock.calls[0][1]?.body);
    expect(bodyStr).not.toContain("remoteip=");
  });
});
