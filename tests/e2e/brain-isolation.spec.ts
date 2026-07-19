import { test, expect, type APIRequestContext } from "@playwright/test";

// ============================================================================
// PRIVACY E2E — per-user brain memory isolation (in-app pgvector backend).
//
// Two separate users (A and B), each registered against the real API, each
// captures a distinct secret into their brain via a real chat turn. The test
// then proves, through the REAL authenticated HTTP surface + the My Brain UI,
// that neither user can READ or DELETE the other's memory. A leak here is a
// data-privacy breach — the whole isolation guarantee is the server-side
// `WHERE user_id = <session user>` scoping, and this exercises the exact
// auth → session → route → query path that enforces it.
//
// The in-app pgvector brain is the only backend, so this exercises the real
// capture → recall → isolation path directly (no env flag required).
// ============================================================================

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3007";
const ORIGIN = { headers: { origin: BASE_URL } };

const SECRET_A = "NIGHTINGALEFOUR"; // A's confidential token — B must never see it
const SECRET_B = "FALCONNINE"; //     B's confidential token — A must never see it

async function register(request: APIRequestContext, tag: string): Promise<void> {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const r = await request.post("/api/auth/register", {
    ...ORIGIN,
    data: {
      email: `e2e-iso-${tag}-${stamp}@example.com`,
      password: "Password123!",
      firstName: "E2E",
      lastName: tag.toUpperCase(),
      acceptTos: true,
    },
  });
  expect(r.ok(), `register ${tag}: ${r.status()}`).toBeTruthy();
}

async function pickModel(request: APIRequestContext): Promise<string> {
  const r = await request.get("/api/skills/models");
  expect(r.ok(), `models: ${r.status()}`).toBeTruthy();
  const { models, defaultModel } = await r.json();
  const id = defaultModel ?? models?.[0]?.id;
  expect(id, "a chat model must be enabled on DEV for capture to run").toBeTruthy();
  return id;
}

// Capture a memory the real way: create a conversation, send one message, and
// drain the streamed reply so the server finishes and the fire-and-forget
// extract → embed → insert runs.
async function captureViaChat(
  request: APIRequestContext,
  model: string,
  content: string,
): Promise<void> {
  const c = await request.post("/api/chat/conversations", {
    ...ORIGIN,
    data: { model, title: "iso" },
  });
  expect(c.status(), `create conversation: ${c.status()}`).toBe(201);
  const { conversation } = await c.json();
  const m = await request.post(
    `/api/chat/conversations/${conversation.id}/messages`,
    { ...ORIGIN, data: { content, model } },
  );
  await m.body(); // read the stream to completion → capture fires on cleanup
  expect(m.status(), `send message: ${m.status()}`).toBeLessThan(400);
}

interface Memory {
  slug: string;
  title: string;
  content: string;
}

async function listMemories(request: APIRequestContext): Promise<Memory[]> {
  const r = await request.get("/api/brain/memories");
  expect(r.ok(), `list memories: ${r.status()}`).toBeTruthy();
  const { memories } = await r.json();
  return memories as Memory[];
}

const has = (mems: Memory[], needle: string): boolean =>
  mems.some((m) => `${m.title}\n${m.content}`.includes(needle));

async function waitForMemory(
  request: APIRequestContext,
  needle: string,
  timeoutMs = 60_000,
): Promise<Memory> {
  const deadline = Date.now() + timeoutMs;
  let last: Memory[] = [];
  while (Date.now() < deadline) {
    last = await listMemories(request);
    const hit = last.find((m) => `${m.title}\n${m.content}`.includes(needle));
    if (hit) return hit;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(
    `memory containing "${needle}" never appeared (saw ${last.length} memories)`,
  );
}

test("per-user brain memory is isolated — no cross-user read or delete", async ({
  browser,
}) => {
  test.setTimeout(150_000);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const A = ctxA.request;
  const B = ctxB.request;

  try {
    await register(A, "a");
    await register(B, "b");
    const model = await pickModel(A);

    // Each user captures their own secret.
    await captureViaChat(
      A,
      model,
      `${SECRET_A} is my confidential project codename, owned by PriyaKapoor. Please remember it.`,
    );
    await captureViaChat(
      B,
      model,
      `${SECRET_B} is my confidential project codename, owned by DmitriVolkov. Please remember it.`,
    );

    const aMem = await waitForMemory(A, SECRET_A);
    await waitForMemory(B, SECRET_B);

    // ── API isolation: the core privacy proof ─────────────────────────
    const aList = await listMemories(A);
    const bList = await listMemories(B);

    expect(has(aList, SECRET_A), "A should see its own memory").toBe(true);
    expect(
      has(aList, SECRET_B),
      "PRIVACY BREACH: user A can read user B's memory",
    ).toBe(false);

    expect(has(bList, SECRET_B), "B should see its own memory").toBe(true);
    expect(
      has(bList, SECRET_A),
      "PRIVACY BREACH: user B can read user A's memory",
    ).toBe(false);

    // ── Write isolation: B cannot delete A's memory by id ─────────────
    const del = await B.delete(
      `/api/brain/memories?slug=${encodeURIComponent(aMem.slug)}`,
      ORIGIN,
    );
    expect(
      del.status(),
      "B deleting A's memory by id must be refused (404)",
    ).toBe(404);
    const aAfter = await listMemories(A);
    expect(
      aAfter.some((m) => m.slug === aMem.slug),
      "A's memory must survive B's delete attempt",
    ).toBe(true);

    // ── UI isolation: B's My Brain page never renders A's secret ──────
    const pageB = await ctxB.newPage();
    await pageB.goto("/account/brain", { waitUntil: "networkidle" });
    await expect(
      pageB.getByText(SECRET_B).first(),
      "B's own memory should render on the Brain page",
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      pageB.getByText(SECRET_A),
      "PRIVACY BREACH: A's secret appears on B's Brain page",
    ).toHaveCount(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
