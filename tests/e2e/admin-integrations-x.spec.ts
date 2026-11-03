import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// ============================================================================
// Admin Integrations: X (Articles) card. Logs in through the real
// /api/admin/login with E2E_ADMIN_PASSWORD (never committed; the spec skips when
// it is unset). Unlike the Jev spec this one writes: the Incomplete and
// Configured chips are rendered from the stored keys, so the tests save fake
// keys and clear them in a finally block. They run only against a local server
// whose X card is empty (a card holding real keys skips the tests, so real keys
// are never cleared) and never call X: the Test route answer is mocked in the
// browser.
// ============================================================================

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3007";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const IS_LOCAL = ["localhost", "127.0.0.1"].includes(new URL(BASE_URL).hostname);

const KEYS = [
  { field: "xApiKey", label: /^API key/, value: "e2e-api-key" },
  { field: "xApiSecret", label: /^API secret/, value: "e2e-api-secret" },
  { field: "xAccessToken", label: /^Access token(?! secret)/, value: "e2e-access-token" },
  { field: "xAccessTokenSecret", label: /^Access token secret/, value: "e2e-access-token-secret" },
] as const;

async function saveKey(page: Page, key: (typeof KEYS)[number]) {
  const field = page.locator("label", { hasText: key.label }).locator("xpath=..");
  await field.getByRole("button", { name: "Edit" }).click();
  await field.locator("input").fill(key.value);
  await field.getByRole("button", { name: "Save" }).click();
  await expect(field.getByText("Saved.")).toBeVisible();
}

async function xIsEmpty(request: APIRequestContext) {
  const res = await request.get("/api/admin/integrations");
  expect(res.status(), "read integrations").toBe(200);
  const { config } = await res.json();
  return KEYS.every((k) => !config[k.field]) && config.xArticlesMode === "off";
}

async function clearX(request: APIRequestContext) {
  const writes = [...KEYS.map((k) => [k.field, null] as const), ["xArticlesMode", "off"] as const];
  for (const [field, value] of writes) {
    const res = await request.patch("/api/admin/integrations", {
      data: { field, value },
      headers: { Origin: BASE_URL },
    });
    expect(res.status(), `clear ${field}`).toBe(200);
  }
}

test.describe("admin integrations: X (Articles)", () => {
  test.skip(!ADMIN_PASSWORD, "E2E_ADMIN_PASSWORD not set");
  test.skip(!IS_LOCAL, "writes keys: local server only");
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ context }) => {
    const res = await context.request.post("/api/admin/login", {
      data: { password: ADMIN_PASSWORD },
      headers: { Origin: BASE_URL },
    });
    expect(res.status(), "admin login").toBe(200);
    test.skip(!(await xIsEmpty(context.request)), "the X card already holds settings; not overwriting them");
  });

  test("the card walks Not configured, Incomplete after three keys, Configured after four", async ({ page, context }) => {
    const card = page.locator("a[href='/admin/integrations/x']");
    try {
      await page.goto("/admin/integrations", { waitUntil: "networkidle" });
      await expect(card.getByRole("heading", { name: "X (Articles)" })).toBeVisible();
      await expect(card).toContainText("Not configured");

      await card.click();
      await expect(page).toHaveURL(/\/admin\/integrations\/x$/);
      await expect(page.getByRole("heading", { level: 1, name: "X (Articles)" })).toBeVisible();

      for (const key of KEYS.slice(0, 3)) await saveKey(page, key);
      await page.goto("/admin/integrations", { waitUntil: "networkidle" });
      await expect(card).toContainText("Incomplete");
      await expect(card).not.toContainText(/configured/i);

      await card.click();
      await saveKey(page, KEYS[3]);
      await page.goto("/admin/integrations", { waitUntil: "networkidle" });
      await expect(card).toContainText("Configured");
      await expect(card).not.toContainText(/incomplete|not configured/i);
      await page.screenshot({ path: "test-results/x-grid-configured.png", fullPage: true });
    } finally {
      await clearX(context.request);
    }
  });

  test("the mode select warns on Publish and saves", async ({ page, context }) => {
    try {
      await page.goto("/admin/integrations/x", { waitUntil: "networkidle" });
      const mode = page.getByLabel("Mode", { exact: true });
      const warning = page.getByText(/makes every new blog post public on X/i);

      await expect(mode).toHaveValue("off");
      await expect(warning).toBeHidden();

      await mode.selectOption("publish");
      await expect(warning).toBeVisible();
      await page.screenshot({ path: "test-results/x-mode-publish-warning.png", fullPage: true });

      await mode.selectOption("draft");
      await expect(warning).toBeHidden();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Saved.")).toBeVisible();

      await page.reload({ waitUntil: "networkidle" });
      await expect(mode).toHaveValue("draft");
    } finally {
      await clearX(context.request);
    }
  });

  test("the Test X button shows the route's message or error in plain language", async ({ page }) => {
    const testRoute = "**/api/admin/integrations/test/x";
    await page.route(testRoute, (route) =>
      route.fulfill({ status: 200, json: { ok: true, message: "Connected to X as @example." } }),
    );
    await page.goto("/admin/integrations/x", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Test X" }).click();
    await expect(page.getByText("✓ Connected to X as @example.")).toBeVisible();

    await page.unroute(testRoute);
    await page.route(testRoute, (route) =>
      route.fulfill({ status: 400, json: { ok: false, error: "X rejected the keys." } }),
    );
    await page.getByRole("button", { name: "Test X" }).click();
    await expect(page.getByText("✗ X rejected the keys.")).toBeVisible();
  });
});

test("the X endpoints refuse anonymous callers", async ({ request }) => {
  const patch = await request.patch("/api/admin/integrations", {
    data: { field: "xArticlesMode", value: "publish" },
    headers: { Origin: BASE_URL },
    maxRedirects: 0,
  });
  expect(patch.status()).toBe(401);

  const testX = await request.post("/api/admin/integrations/test/x", {
    headers: { Origin: BASE_URL },
    maxRedirects: 0,
  });
  expect(testX.status()).toBe(401);
});
