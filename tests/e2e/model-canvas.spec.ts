import { test, expect, type APIRequestContext } from "@playwright/test";

// ============================================================================
// Model Studio canvas E2E. Seeds a real user + org + project + model through
// the API (no test backdoor), then drives the canvas UI: add an entity, add an
// attribute, and confirm the entity persists across a reload (proving the
// server round-trip, not just local React state).
//
// Auth: register sets the archos_session cookie; creating the org sets
// archos_org and makes the user its owner (so owner|admin mutations are
// allowed). page.request shares the browser context cookie jar, so the
// subsequent page.goto is authenticated.
// ============================================================================

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3007";
const ORIGIN = { headers: { origin: BASE_URL } };

interface Seeded {
  modelId: string;
  email: string;
}

async function seedModel(request: APIRequestContext, stamp: string): Promise<Seeded> {
  const email = `e2e-${stamp}@example.com`;

  const register = await request.post("/api/auth/register", {
    ...ORIGIN,
    data: {
      email,
      password: "Password123!",
      firstName: "E2E",
      lastName: "Tester",
      acceptTos: true,
    },
  });
  expect(register.ok(), `register: ${register.status()}`).toBeTruthy();

  // Creating the org also sets it as the active org (archos_org cookie).
  const org = await request.post("/api/organisations", {
    ...ORIGIN,
    data: { name: `E2E Org ${stamp}` },
  });
  expect(org.ok(), `org: ${org.status()}`).toBeTruthy();

  const project = await request.post("/api/projects", {
    ...ORIGIN,
    data: { name: `E2E Project ${stamp}` },
  });
  expect(project.ok(), `project: ${project.status()}`).toBeTruthy();
  const projectId = (await project.json()).project.id as string;

  const model = await request.post("/api/model-studio", {
    ...ORIGIN,
    data: { name: `E2E Model ${stamp}`, projectId },
  });
  expect(model.ok(), `model: ${model.status()}`).toBeTruthy();
  const modelId = (await model.json()).model.id as string;

  return { modelId, email };
}

test("entity + attribute can be created on the canvas and persist across reload", async ({ page }) => {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const { modelId } = await seedModel(page.request, stamp);

  await page.goto(`/workspace/model-studio/${modelId}`);

  // Add an entity via the toolbar dialog.
  await page.getByTestId("add-entity").click();
  await page.getByTestId("entity-dialog").waitFor();
  await page.getByTestId("entity-name").fill("Customer");
  await page.getByTestId("entity-save").click();

  // The new node renders on the canvas.
  const node = page.locator('[data-testid="entity-dialog"]');
  await expect(node).toHaveCount(0); // dialog closed
  await expect(page.getByText("Customer", { exact: true })).toBeVisible();

  // Open the entity's attribute panel (single click) and add an attribute.
  await page.getByText("Customer", { exact: true }).click();
  await page.getByTestId("attribute-panel").waitFor();
  await page.getByTestId("add-attribute").click();
  await page.getByTestId("attribute-name").fill("email");
  await page.getByTestId("attribute-save").click();
  // "email" renders in both the panel row and inside the entity node.
  await expect(page.getByText("email").first()).toBeVisible();

  // Reload — the entity is server-persisted, so it survives a fresh fetch.
  await page.reload();
  await expect(page.getByText("Customer", { exact: true })).toBeVisible();
});
