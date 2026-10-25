import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

// The Integrations page and the admin PATCH route can load this module as two
// separate instances in one server process (Next compiles pages and route
// handlers into separate module graphs). A save clears the cache in the
// route's instance; the page's instance must see that too, or the page shows
// the pre-save config (a just-saved key reads blank) until the server restarts.

const dbReads = vi.hoisted(() => ({ count: 0 }));
vi.mock("./db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            dbReads.count++;
            return [];
          },
        }),
      }),
    }),
  }),
}));

// An empty site_setting read plus the env fallback is the cheapest way to get a
// loadable config without encrypting a stored blob.
beforeEach(() => {
  vi.stubEnv("BOOKING_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("INTEGRATION_FALLBACK_ENABLED", "true");
  vi.stubEnv("ADMIN_PASSWORD", "test-admin-password");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
  vi.stubEnv("CONTACT_RECIPIENT_EMAIL", "rob@archoslabs.xyz");
  vi.stubEnv("RESEND_FROM_EMAIL", "Archos Labs <hello@archoslabs.xyz>");
  dbReads.count = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("integration config cache across module instances", () => {
  it("a clear in one instance makes the other instance reload from the DB", async () => {
    vi.resetModules();
    const page = await import("./integration-config");
    vi.resetModules();
    const route = await import("./integration-config");
    expect(route).not.toBe(page);

    page.clearIntegrationConfigCache();
    await page.getIntegrationConfig();
    await page.getIntegrationConfig();
    expect(dbReads.count).toBe(1);

    route.clearIntegrationConfigCache();
    await page.getIntegrationConfig();
    expect(dbReads.count).toBe(2);
  });
});
