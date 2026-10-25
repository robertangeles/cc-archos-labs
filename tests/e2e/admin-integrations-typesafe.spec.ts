import { test, expect } from "@playwright/test";

// ============================================================================
// Admin Integrations: Jev (TypeSafe) API key. Logs in through the real
// /api/admin/login with the password from E2E_ADMIN_PASSWORD (never committed;
// the spec skips when it is unset). Read-only: it never saves a key, so the
// DEV integration_secrets row is untouched. The Test button's wording depends
// on whether a key is stored, so it asserts "a plain-language result", not one
// exact string.
// ============================================================================

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3007";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.describe("admin integrations: Jev (TypeSafe)", () => {
  test.skip(!ADMIN_PASSWORD, "E2E_ADMIN_PASSWORD not set");

  test.beforeEach(async ({ context }) => {
    const res = await context.request.post("/api/admin/login", {
      data: { password: ADMIN_PASSWORD },
      headers: { Origin: BASE_URL },
    });
    expect(res.status(), "admin login").toBe(200);
  });

  test("the grid lists a Jev (TypeSafe) card that opens its page", async ({ page }) => {
    await page.goto("/admin/integrations", { waitUntil: "networkidle" });

    const card = page.locator("a[href='/admin/integrations/typesafe']");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { name: "Jev (TypeSafe)" })).toBeVisible();
    await expect(card).toContainText(/configured/i);
    await page.screenshot({ path: "test-results/typesafe-grid.png", fullPage: true });

    await card.click();
    await expect(page).toHaveURL(/\/admin\/integrations\/typesafe$/);
    await expect(page.getByRole("heading", { level: 1, name: "Jev (TypeSafe)" })).toBeVisible();
  });

  test("the detail page has an API key field and a Test TypeSafe button that answers in plain language", async ({ page }) => {
    // Chrome logs every 4xx as "Failed to load resource". The route answers 400
    // by design when no key is stored, so that line is not an app error.
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) {
        consoleErrors.push(m.text());
      }
    });
    page.on("pageerror", (e) => consoleErrors.push(e.message));

    await page.goto("/admin/integrations/typesafe", { waitUntil: "networkidle" });

    await expect(page.getByText("API key", { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: "test-results/typesafe-panel.png", fullPage: true });

    await page.getByRole("button", { name: "Test TypeSafe" }).click();
    const result = page.locator("p", { hasText: /^[✓✗]/ });
    await expect(result).toBeVisible({ timeout: 20_000 });
    await expect(result).toContainText(
      /not configured|Connected to TypeSafe|rejected the API key|busy|responded \d+|reach TypeSafe/i,
    );
    await page.screenshot({ path: "test-results/typesafe-test-result.png", fullPage: true });

    expect(consoleErrors, "browser console errors").toEqual([]);
  });

  test("an unknown integration slug is still a 404", async ({ page }) => {
    const res = await page.goto("/admin/integrations/not-a-real-thing");
    expect(res?.status()).toBe(404);
  });
});

test("the Test TypeSafe endpoint refuses anonymous callers", async ({ request }) => {
  const res = await request.post("/api/admin/integrations/test/typesafe", {
    headers: { Origin: BASE_URL },
    maxRedirects: 0,
  });
  expect([401, 403, 307]).toContain(res.status());
});
