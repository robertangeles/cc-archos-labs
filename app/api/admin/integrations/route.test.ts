import { beforeEach, describe, expect, it, vi } from "vitest";

// PATCH /api/admin/integrations must accept the TypeSafe (Jev) key, encrypt it
// via updateIntegrationSecret, and answer with the redacted display only. The
// Integrations panel's Save button depends on this: a field missing from
// PATCH_FIELDS would 400 and the key could never be stored.

const updateIntegrationSecret = vi.fn();
const getIntegrationConfigRedacted = vi.fn();
vi.mock("../../../../lib/integration-config", () => ({
  updateIntegrationSecret: (...a: unknown[]) => updateIntegrationSecret(...a),
  getIntegrationConfigRedacted: () => getIntegrationConfigRedacted(),
}));
vi.mock("../../../../lib/db", () => ({ getDb: () => ({}) }));

const { PATCH } = await import("./route");

const KEY = "ts_secret_key_do_not_leak";

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/admin/integrations", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  updateIntegrationSecret.mockReset().mockResolvedValue(undefined);
  getIntegrationConfigRedacted
    .mockReset()
    .mockResolvedValue({ typesafeApiKey: "••••leak" });
});

describe("PATCH /api/admin/integrations typesafeApiKey", () => {
  it("stores the key and returns only the redacted display", async () => {
    const res = await patch({ field: "typesafeApiKey", value: KEY });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(updateIntegrationSecret).toHaveBeenCalledWith(
      "typesafeApiKey",
      KEY,
      "admin",
    );
    expect(body).toEqual({
      ok: true,
      field: "typesafeApiKey",
      redacted: "••••leak",
    });
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it("rejects an empty string with 400 and writes nothing", async () => {
    const res = await patch({ field: "typesafeApiKey", value: "" });
    expect(res.status).toBe(400);
    expect(updateIntegrationSecret).not.toHaveBeenCalled();
  });

  it("rejects a non-string value with 400 and writes nothing", async () => {
    const res = await patch({ field: "typesafeApiKey", value: 12345 });
    expect(res.status).toBe(400);
    expect(updateIntegrationSecret).not.toHaveBeenCalled();
  });

  it("rejects an unknown field with 400", async () => {
    const res = await patch({ field: "notAField", value: KEY });
    expect(res.status).toBe(400);
    expect(updateIntegrationSecret).not.toHaveBeenCalled();
  });
});
