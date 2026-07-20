import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks so the vi.mock factories can reference them.
const m = vi.hoisted(() => ({
  execute: vi.fn(),
  txExecute: vi.fn(),
  transaction: vi.fn(),
  embedText: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: () => ({ execute: m.execute, transaction: m.transaction }),
}));
vi.mock("../embeddings", () => ({ embedText: m.embedText }));

import {
  ingestEntity,
  deactivateEntityMemory,
  isWorkspaceMemoryEnabled,
} from "./workspace-ingest";

const KEY = {
  orgId: "11111111-1111-1111-1111-111111111111",
  sourceType: "project",
  sourceEntityId: "22222222-2222-2222-2222-222222222222",
};

beforeEach(() => {
  m.execute.mockReset().mockResolvedValue(undefined);
  m.txExecute.mockReset().mockResolvedValue(undefined);
  m.transaction
    .mockReset()
    .mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({ execute: m.txExecute }),
    );
  m.embedText.mockReset().mockResolvedValue(Array(1024).fill(0.1));
  delete process.env.WORKSPACE_MEMORY_INGEST;
});

afterEach(() => {
  delete process.env.WORKSPACE_MEMORY_INGEST;
});

describe("workspace-ingest feature flag", () => {
  it("reads WORKSPACE_MEMORY_INGEST", () => {
    expect(isWorkspaceMemoryEnabled()).toBe(false);
    process.env.WORKSPACE_MEMORY_INGEST = "true";
    expect(isWorkspaceMemoryEnabled()).toBe(true);
  });

  it("ingestEntity is a no-op when the flag is off (no embed, no DB)", async () => {
    await ingestEntity({ ...KEY, body: "Project Acme is active." });
    expect(m.embedText).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.execute).not.toHaveBeenCalled();
  });

  it("deactivateEntityMemory is a no-op when the flag is off", async () => {
    await deactivateEntityMemory(KEY);
    expect(m.execute).not.toHaveBeenCalled();
  });
});

describe("workspace-ingest (flag on)", () => {
  beforeEach(() => {
    process.env.WORKSPACE_MEMORY_INGEST = "true";
  });

  it("embeds the body and runs supersede + insert in a transaction", async () => {
    await ingestEntity({ ...KEY, body: "Project Acme Rebuild is active." });
    expect(m.embedText).toHaveBeenCalledWith("Project Acme Rebuild is active.");
    expect(m.transaction).toHaveBeenCalledTimes(1);
    // Two statements inside the tx: supersede (UPDATE) then insert.
    expect(m.txExecute).toHaveBeenCalledTimes(2);
  });

  it("empty body routes to deactivate (supersede only, no embed/insert)", async () => {
    await ingestEntity({ ...KEY, body: "   " });
    expect(m.embedText).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
    // One direct execute — the supersede UPDATE.
    expect(m.execute).toHaveBeenCalledTimes(1);
  });

  it("caps the embedded body length", async () => {
    const long = "x".repeat(5000);
    await ingestEntity({ ...KEY, body: long });
    expect(m.embedText.mock.calls[0][0]).toHaveLength(2000);
  });

  it("never throws when the pipeline fails (fail-soft)", async () => {
    m.embedText.mockRejectedValue(new Error("embed down"));
    await expect(
      ingestEntity({ ...KEY, body: "Project Acme is active." }),
    ).resolves.toBeUndefined();
  });

  it("deactivateEntityMemory issues one supersede UPDATE", async () => {
    await deactivateEntityMemory(KEY);
    expect(m.execute).toHaveBeenCalledTimes(1);
  });
});
