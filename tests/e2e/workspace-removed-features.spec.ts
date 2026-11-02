import { test, expect } from "@playwright/test";

// ============================================================================
// Skills, Workflows, Social posts and Model Studio were removed from the Metis workspace.
// Registers a fresh user through the real API (same approach as the other specs),
// then proves: the nav no longer offers them, their pages and APIs are gone, and
// the one thing that used to live under /api/skills and still matters — the list
// of enabled chat models — works at its new address with its auth intact.
// ============================================================================

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3007";
const ORIGIN = { headers: { origin: BASE_URL } };

const REMOVED_PAGES = [
  "/account/skills",
  "/account/skills/new",
  "/account/workflows",
  "/account/workflows/new",
  "/account/scheduled-posts",
  "/account/social-accounts",
  "/workspace/model-studio",
];

const REMOVED_GETS = [
  "/api/skills",
  "/api/skills/models",
  "/api/workflows",
  "/api/social/scheduled",
  "/api/social/twitter/status",
  "/api/social/linkedin/status",
  "/api/social/bluesky/status",
  "/api/chat/slash-command",
  "/api/model-studio",
  "/api/model-studio/flag",
];

test("removed features are gone from the workspace, and the model list still works", async ({ page, request }) => {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const register = await page.request.post("/api/auth/register", {
    ...ORIGIN,
    data: {
      email: `e2e-removed-${stamp}@example.com`,
      password: "Password123!",
      firstName: "E2E",
      lastName: "Removed",
      acceptTos: true,
    },
  });
  expect(register.ok(), `register: ${register.status()}`).toBeTruthy();

  // Nav: neither the chat sidebar nor the workspace nav links to the removed pages.
  for (const path of ["/account/workspace", "/account/brain"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    for (const gone of ["/account/skills", "/account/workflows", "/account/scheduled-posts", "/workspace/model-studio"]) {
      await expect(page.locator(`a[href="${gone}"]`), `${path} still links to ${gone}`).toHaveCount(0);
    }
    await expect(page.locator('a[href="/account/clients"]').first()).toBeVisible();
  }

  // Profile tabs: no Social Accounts.
  await page.goto("/account", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: "Social Accounts" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Organisation" })).toBeVisible();

  // The pages are gone, not redirected.
  for (const path of REMOVED_PAGES) {
    const res = await page.request.get(path, { maxRedirects: 0 });
    expect(res.status(), `GET ${path}`).toBe(404);
  }

  // The APIs are gone, even for a signed-in user.
  for (const path of REMOVED_GETS) {
    const res = await page.request.get(path);
    expect(res.status(), `GET ${path}`).toBe(404);
  }
  const cron = await request.post("/api/cron/process-scheduled-social", ORIGIN);
  expect(cron.status(), "POST /api/cron/process-scheduled-social").toBe(404);

  // The model list moved to /api/models: signed-in gets it, anonymous does not.
  const models = await page.request.get("/api/models");
  expect(models.status(), "GET /api/models").toBe(200);
  const body = await models.json();
  expect(Array.isArray(body.models)).toBe(true);
  expect((await request.get("/api/models")).status(), "anonymous GET /api/models").toBe(401);

  // And the chat model picker, which reads it, still renders.
  await page.goto("/account/workspace", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("button", {
      name: /instruct|sonnet|claude|qwen|gpt|haiku|gemini|opus|llama|mistral|deepseek/i,
    }),
  ).toBeVisible({ timeout: 15_000 });
});
