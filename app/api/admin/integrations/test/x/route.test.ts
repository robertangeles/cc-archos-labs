import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/admin/integrations/test/x
//
// Contract: a real, read-only GET /2/users/me call, signed with the four
// OAuth 1.0a keys, tells the admin whether the stored X keys work and which
// account they act as. The route never echoes a key back.

const getIntegrationConfig = vi.fn();
vi.mock("../../../../../../lib/integration-config", () => ({
  getIntegrationConfig: () => getIntegrationConfig(),
}));

const { POST } = await import("./route");

const KEYS = {
  xApiKey: "fake_consumer_key_k1",
  xApiSecret: "fake_consumer_secret_k2",
  xAccessToken: "123-fake_access_token_k3",
  xAccessTokenSecret: "fake_access_secret_k4",
};
const fetchMock = vi.fn();

beforeEach(() => {
  getIntegrationConfig.mockResolvedValue(KEYS);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  getIntegrationConfig.mockReset();
});

async function run() {
  const res = await POST();
  return { status: res.status, body: await res.json() };
}

function expectNoKeyLeak(body: unknown) {
  const text =
    JSON.stringify(body) + JSON.stringify((console.error as ReturnType<typeof vi.fn>).mock.calls);
  for (const key of Object.values(KEYS)) expect(text).not.toContain(key);
}

describe("POST /api/admin/integrations/test/x", () => {
  it("reports ok and the account handle when X accepts the keys", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "42", username: "robangeles" } }), { status: 200 }),
    );
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, message: "Connected to X as @robangeles." });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.x.com/2/users/me");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toContain(`oauth_consumer_key="${KEYS.xApiKey}"`);
    expect(init.headers.Authorization).toContain(`oauth_token="${KEYS.xAccessToken}"`);
    expectNoKeyLeak(body);
  });

  it.each([401, 403])("tells the admin the keys were rejected on %s", async (code) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ title: "Unauthorized" }), { status: code }));
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: false,
      error: "X rejected the keys. Check them in the X developer portal and try again.",
      status: code,
    });
    expectNoKeyLeak(body);
  });

  it("says X is busy on 429, not that the keys are bad", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 429, headers: { "Retry-After": "30" } }));
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: false, error: "X is busy (429). Try again in a minute.", status: 429 });
  });

  it("says the account is out of credits on 402, not that the service is down", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 402 }));
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: false,
      error:
        "X says the account has no API credits left (402). Add credits or raise the spending cap in the X developer console.",
      status: 402,
    });
    expectNoKeyLeak(body);
  });

  it.each([500, 502])("says the service may be down on %s", async (code) => {
    fetchMock.mockResolvedValue(new Response("{}", { status: code }));
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: false,
      error: `X responded ${code} — service may be down.`,
      status: code,
    });
  });

  it("returns a plain message when X cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError(`fetch failed ${KEYS.xApiSecret}`));
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: false,
      error: "Couldn't reach X. Check your network and try again.",
    });
    expectNoKeyLeak(body);
  });

  it.each(Object.keys(KEYS))("returns 400 and makes no call when %s is missing", async (field) => {
    getIntegrationConfig.mockResolvedValue({ ...KEYS, [field]: null });
    const { status, body } = await run();
    expect(status).toBe(400);
    expect(body).toEqual({ ok: false, error: "X keys are not fully configured." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the integration config cannot be read", async () => {
    getIntegrationConfig.mockRejectedValue(new Error("decrypt failed"));
    const { status, body } = await run();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
