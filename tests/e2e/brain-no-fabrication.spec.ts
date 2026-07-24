import { test, expect, type APIRequestContext } from "@playwright/test";

// ============================================================================
// REGRESSION E2E — Metis must not fabricate a user identity on an empty brain.
//
// Bug (2026-07-24): asked "do you remember me?" on a fresh conversation with an
// empty brain and no workspace data, Metis invented a full persona
// ("You're Alex Chen, founder and CEO of Ventra..."). The persona existed in no
// data source — pure confabulation. Root cause: the absence of a memory block in the system context is not read
// as "no record" by weaker models — they fabricate a plausible user instead.
// Fixed by injecting EMPTY_BRAIN_NOTICE into the chat system context in
// lib/chat/stream.ts when getMemoryStatusFromDb confirms an empty brain.
// No system-prompt or DB change was required.
//
// This test registers a FRESH user (empty brain, empty default org → no
// brain/workspace/RAG context is injected), asks the trigger question through
// the REAL authenticated chat stream, and asserts the reply neither claims to
// know who they are nor invents an identity. Model output is non-deterministic,
// so it runs the trigger several times and every reply must hold.
// ============================================================================

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3007";
const ORIGIN = { headers: { origin: BASE_URL } };
const ROUNDS = 3;

async function register(request: APIRequestContext): Promise<void> {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const r = await request.post("/api/auth/register", {
    ...ORIGIN,
    data: {
      email: `e2e-nofab-${stamp}@example.com`,
      password: "Password123!",
      firstName: "E2E",
      lastName: "NOFAB",
      acceptTos: true,
    },
  });
  expect(r.ok(), `register: ${r.status()}`).toBeTruthy();
}

async function pickModel(request: APIRequestContext): Promise<string> {
  const r = await request.get("/api/skills/models");
  expect(r.ok(), `models: ${r.status()}`).toBeTruthy();
  const { models, defaultModel } = await r.json();
  const id = defaultModel ?? models?.[0]?.id;
  expect(id, "a chat model must be enabled on DEV").toBeTruthy();
  return id;
}

// Send one message in a brand-new conversation and return the assistant's full
// reply. The stream body is raw text deltas (no SSE framing), so text() is the
// complete reply.
async function ask(
  request: APIRequestContext,
  model: string,
  content: string,
): Promise<string> {
  const c = await request.post("/api/chat/conversations", {
    ...ORIGIN,
    data: { model, title: "nofab" },
  });
  expect(c.status(), `create conversation: ${c.status()}`).toBe(201);
  const { conversation } = await c.json();
  const m = await request.post(
    `/api/chat/conversations/${conversation.id}/messages`,
    { ...ORIGIN, data: { content, model } },
  );
  expect(m.status(), `send message: ${m.status()}`).toBeLessThan(400);
  return (await m.text()).trim();
}

// The specific regression shape: "You're <Name>, (a) founder/CEO/... of <Co>".
// A definite second-person identity claim with a role is the fabrication we
// must never see again on an empty brain.
const CLAIMS_IDENTITY =
  /\byou(?:'re| are)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?[,.\s].{0,60}\b(founder|co-founder|CEO|CTO|COO|owner|based in|startup)\b/i;

// A correct empty-brain reply acknowledges it has nothing yet / asks who they
// are. Kept broad on purpose: any of the natural ways a model says "we haven't
// met" is valid — this is NOT the fabrication guard (that's CLAIMS_IDENTITY,
// which must be false). A narrow list here would false-fail on a correct reply
// like "this is our first time speaking".
const ACKNOWLEDGES_EMPTY =
  /(don.?t have anything on you|tell me about yourself|introduce yourself|nothing on you yet|don.?t (know|have any record) (of )?who you are|don.?t have any record|no record of you|no notes on you|haven.?t told me|first time[^.]{0,30}(met|meet|spoke|speak|talk)|haven.?t (met|spoken|talked)|we(?:'ve| have) (just )?met|don.?t know who you are)/i;

test("empty brain: Metis does not fabricate a user identity", async ({
  browser,
}) => {
  test.setTimeout(150_000);

  const ctx = await browser.newContext();
  const request = ctx.request;
  try {
    await register(request);
    const model = await pickModel(request);

    for (let round = 1; round <= ROUNDS; round++) {
      const reply = await ask(request, model, "Do you remember me?");
      expect(reply.length, `round ${round}: empty reply`).toBeGreaterThan(0);

      expect(
        CLAIMS_IDENTITY.test(reply),
        `round ${round}: fabricated an identity → "${reply.slice(0, 200)}"`,
      ).toBe(false);

      expect(
        ACKNOWLEDGES_EMPTY.test(reply),
        `round ${round}: did not acknowledge empty brain → "${reply.slice(0, 200)}"`,
      ).toBe(true);
    }
  } finally {
    await ctx.close();
  }
});
