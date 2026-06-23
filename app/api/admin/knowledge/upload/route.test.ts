import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, ingestDocumentMock, IngestErrorClass } = vi.hoisted(() => {
  class IngestError extends Error {}
  return {
    getSessionMock: vi.fn(),
    ingestDocumentMock: vi.fn(),
    IngestErrorClass: IngestError,
  };
});

vi.mock("../../../../../lib/auth-server", () => ({
  getSessionFromCookies: getSessionMock,
}));
vi.mock("../../../../../lib/knowledge/ingest", () => ({
  ingestDocument: ingestDocumentMock,
  IngestError: IngestErrorClass,
}));

import { POST } from "./route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/knowledge/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = { title: "DMBOK ch.1", text: "some knowledge text" };

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ userId: "admin-1" });
  ingestDocumentMock.mockResolvedValue("doc-123");
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/admin/knowledge/upload", () => {
  it("returns 401 when there is no session", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const r = await POST(makeRequest(VALID));
    expect(r.status).toBe(401);
    expect(ingestDocumentMock).not.toHaveBeenCalled();
  });

  it("surfaces a typed IngestError message (409, intentional)", async () => {
    ingestDocumentMock.mockRejectedValueOnce(new IngestErrorClass("Document already exists"));
    const r = await POST(makeRequest(VALID));
    expect(r.status).toBe(409);
    await expect(r.json()).resolves.toEqual({ error: "Document already exists" });
  });

  it("returns a generic 500 without leaking the raw error", async () => {
    ingestDocumentMock.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED postgres://user:pw@10.0.0.5:5432 leaked-secret"),
    );
    const r = await POST(makeRequest(VALID));
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error).toBe("Ingestion failed");
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|postgres:\/\/|leaked-secret|10\.0\.0\.5/i);
  });

  it("returns 200 + documentId on the happy path", async () => {
    const r = await POST(makeRequest(VALID));
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: true, documentId: "doc-123" });
  });
});
