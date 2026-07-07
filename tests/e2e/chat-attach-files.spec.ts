import { test, expect } from "@playwright/test";
import path from "node:path";

// ============================================================================
// Chat Attach Files E2E. Registers a fresh user via the real API (sets the
// archos_session cookie in the page's context — no test backdoor, Turnstile
// bypassed for register), then drives the workspace: attach a .txt via the
// hidden file input and confirm it reaches the READY chip state (which proves
// the full upload -> extract -> private-R2 store -> DB insert path), then
// removes it. Requires the R2 "Chat Documents" integration configured in the
// DEV DB (else the upload 503s and the chip errors).
// ============================================================================

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3007";
const ORIGIN = { headers: { origin: BASE_URL } };

test("attach a document shows a ready chip, then removes it", async ({ page }) => {
  const stamp =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const register = await page.request.post("/api/auth/register", {
    ...ORIGIN,
    data: {
      email: `e2e-attach-${stamp}@example.com`,
      password: "Password123!",
      firstName: "E2E",
      lastName: "Attach",
      acceptTos: true,
    },
  });
  expect(register.ok(), `register: ${register.status()}`).toBeTruthy();

  await page.goto("/account/workspace", { waitUntil: "networkidle" });

  // Wait for the model picker to populate — attaching before the enabled-models
  // fetch resolves would create a conversation with an empty model (400).
  await expect(
    page.getByRole("button", {
      name: /instruct|sonnet|claude|qwen|gpt|haiku|gemini|opus|llama|mistral/i,
    }),
  ).toBeVisible({ timeout: 15_000 });

  const fixture = path.resolve("tests/e2e/fixtures/attach-e2e.txt");
  await page.setInputFiles('input[type="file"]', fixture);

  const chip = page
    .getByRole("listitem")
    .filter({ hasText: "attach-e2e.txt" });
  await expect(chip).toBeVisible();

  // The E2 char-count meta ("… chars") renders ONLY on a ready chip — proving
  // upload -> extraction -> R2 store -> DB insert all succeeded.
  await expect(chip).toContainText(/chars/, { timeout: 20_000 });
  await expect(chip).not.toContainText(
    /couldn't|unsupported|scanned|not configured|too large/i,
  );

  // Detach — the chip disappears.
  await chip
    .getByRole("button", { name: /remove attach-e2e\.txt/i })
    .click();
  await expect(chip).toHaveCount(0);
});
