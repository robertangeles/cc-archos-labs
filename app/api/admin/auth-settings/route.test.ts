import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthSettingsMock, updateAuthSettingsMock } = vi.hoisted(() => ({
  getAuthSettingsMock: vi.fn(),
  updateAuthSettingsMock: vi.fn(),
}));

vi.mock("../../../../lib/auth/settings", () => ({
  getAuthSettings: getAuthSettingsMock,
  updateAuthSettings: updateAuthSettingsMock,
}));

import { GET, PATCH } from "./route";

const DEFAULT_VIEW = {
  turnstileEnabled: false,
  turnstileSiteKey: "",
  turnstileHasSecret: false,
  publicSignupEnabled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  getAuthSettingsMock.mockResolvedValue(DEFAULT_VIEW);
  updateAuthSettingsMock.mockResolvedValue(DEFAULT_VIEW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/admin/auth-settings", () => {
  it("returns the redacted view", async () => {
    getAuthSettingsMock.mockResolvedValueOnce({
      ...DEFAULT_VIEW,
      turnstileEnabled: true,
      turnstileHasSecret: true,
    });
    const r = await GET();
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.ok).toBe(true);
    expect(json.settings.turnstileEnabled).toBe(true);
    expect(json.settings.turnstileHasSecret).toBe(true);
    // Critical: response never contains a `turnstileSecretKey` field.
    expect(json.settings.turnstileSecretKey).toBeUndefined();
  });
});

function makeRequest(body: unknown): Request {
  return new Request("https://archoslabs.xyz/api/admin/auth-settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("PATCH /api/admin/auth-settings", () => {
  it("returns 400 on malformed JSON", async () => {
    const r = await PATCH(makeRequest("{not-json"));
    expect(r.status).toBe(400);
  });

  it("returns 400 on invalid body shape (string for boolean)", async () => {
    const r = await PATCH(makeRequest({ turnstileEnabled: "yes" }));
    expect(r.status).toBe(400);
    expect(updateAuthSettingsMock).not.toHaveBeenCalled();
  });

  it("REFUSES turnstileEnabled=true when no secret stored AND none in patch", async () => {
    // Current state: no secret.
    getAuthSettingsMock.mockResolvedValueOnce({
      ...DEFAULT_VIEW,
      turnstileHasSecret: false,
    });
    const r = await PATCH(makeRequest({ turnstileEnabled: true }));
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.error).toContain("secret key");
    expect(updateAuthSettingsMock).not.toHaveBeenCalled();
  });

  it("ALLOWS turnstileEnabled=true when secret is included in the same patch", async () => {
    getAuthSettingsMock.mockResolvedValueOnce({
      ...DEFAULT_VIEW,
      turnstileHasSecret: false,
    });
    const r = await PATCH(
      makeRequest({
        turnstileEnabled: true,
        turnstileSecretKey: "cf-secret-new",
      }),
    );
    expect(r.status).toBe(200);
    expect(updateAuthSettingsMock).toHaveBeenCalledWith({
      turnstileEnabled: true,
      turnstileSecretKey: "cf-secret-new",
    });
  });

  it("ALLOWS turnstileEnabled=true when secret already stored", async () => {
    getAuthSettingsMock.mockResolvedValueOnce({
      ...DEFAULT_VIEW,
      turnstileHasSecret: true,
    });
    const r = await PATCH(makeRequest({ turnstileEnabled: true }));
    expect(r.status).toBe(200);
    expect(updateAuthSettingsMock).toHaveBeenCalledWith({
      turnstileEnabled: true,
    });
  });

  it("clears secret on explicit null", async () => {
    const r = await PATCH(makeRequest({ turnstileSecretKey: null }));
    expect(r.status).toBe(200);
    expect(updateAuthSettingsMock).toHaveBeenCalledWith({
      turnstileSecretKey: null,
    });
  });

  it("happy path: toggles publicSignupEnabled", async () => {
    const r = await PATCH(makeRequest({ publicSignupEnabled: true }));
    expect(r.status).toBe(200);
    expect(updateAuthSettingsMock).toHaveBeenCalledWith({
      publicSignupEnabled: true,
    });
  });
});
