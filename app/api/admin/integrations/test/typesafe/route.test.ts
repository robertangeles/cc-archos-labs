import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/admin/integrations/test/typesafe
//
// Contract: a real, read-only GET /v1/models call tells the admin whether the
// stored TypeSafe (Jev) key works. Observed live on 2026-10-25: a bad key
// returns 401 {"detail":{"error_type":"authentication_error",...}}, no key
// returns 403. The route never echoes the key back.

const getIntegrationConfig = vi.fn();
vi.mock("../../../../../../lib/integration-config", () => ({
  getIntegrationConfig: () => getIntegrationConfig(),
}));

const { POST } = await import("./route");

const KEY = "ts_secret_key_do_not_leak";
const fetchMock = vi.fn();

beforeEach(() => {
  getIntegrationConfig.mockResolvedValue({ typesafeApiKey: KEY });
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

describe("POST /api/admin/integrations/test/typesafe", () => {
  it("reports ok and the model count when TypeSafe accepts the key", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "jev-1.13.0" }, { id: "jev-1.14.0" }] }), {
        status: 200,
      }),
    );
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toContain("2");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/models");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("still reports ok when the model list has an unexpected shape", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const { body } = await run();
    expect(body.ok).toBe(true);
  });

  it.each([401, 403])("tells the admin the key was rejected on %s", async (code) => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { error_type: "authentication_error" } }),
        { status: code },
      ),
    );
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/rejected the API key/i);
  });

  it.each([429, 529])("says TypeSafe is busy on %s, not that the key is bad", async (code) => {
    fetchMock.mockResolvedValue(new Response("{}", { status: code }));
    const { body } = await run();
    expect(body.ok).toBe(false);
    expect(body.error).not.toMatch(/rejected the API key/i);
    expect(body.error).toMatch(/try again/i);
  });

  it("says the service may be down on a 5xx", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 502 }));
    const { body } = await run();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/502/);
  });

  it("returns a plain message when TypeSafe cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/couldn't reach/i);
  });

  it("returns 400 and makes no call when no key is configured", async () => {
    getIntegrationConfig.mockResolvedValue({ typesafeApiKey: null });
    const { status, body } = await run();
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the integration config cannot be read", async () => {
    getIntegrationConfig.mockRejectedValue(new Error("decrypt failed"));
    const { status, body } = await run();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never includes the key in any response or log", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const { body } = await run();
    expect(JSON.stringify(body)).not.toContain(KEY);
    const logged = JSON.stringify((console.error as ReturnType<typeof vi.fn>).mock.calls);
    expect(logged).not.toContain(KEY);
  });
});
