import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import type { RadarPageData, RadarRow } from "../../lib/news-radar/radar-page-types";

// ============================================================================
// News radar page (/admin/blog/radar). Logs in through the real
// /api/admin/login with E2E_ADMIN_PASSWORD (never committed; the spec skips when
// it is unset). The real-data tests use whatever the DEV database holds and
// skip when nothing is eligible; they put back every label they set. States the
// data cannot produce on demand (empty, no key, load error, conflict, save
// failure, a 400-item backlog) are driven by intercepting /api/admin/radar after
// the real first render. Plan DES-D3 to DES-D14.
// ============================================================================

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3007";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const PAGE = "/admin/blog/radar";

// axe-core is already installed (a transitive dependency of the lint stack); it is
// injected into the page, so no new dependency is added for the accessibility check.
const AXE = (() => {
  const dir = readdirSync(join(process.cwd(), "node_modules", ".pnpm")).find((d) => d.startsWith("axe-core@"));
  return dir ? join(process.cwd(), "node_modules", ".pnpm", dir, "node_modules", "axe-core", "axe.min.js") : null;
})();

// One login for the whole file: the admin login is rate limited per process, and a
// login per test would use the hour's allowance up in a single run.
const AUTH_STATE = "test-results/radar-admin-state.json";

test.describe("news radar page", () => {
  test.skip(!ADMIN_PASSWORD, "E2E_ADMIN_PASSWORD not set");
  test.use({ storageState: AUTH_STATE });

  test.beforeAll(async ({ playwright }) => {
    if (!ADMIN_PASSWORD) return;
    const ctx = await playwright.request.newContext({ baseURL: BASE_URL, storageState: undefined });
    const res = await ctx.post("/api/admin/login", {
      data: { password: ADMIN_PASSWORD },
      headers: { Origin: BASE_URL },
    });
    expect(res.status(), "admin login").toBe(200);
    await ctx.storageState({ path: AUTH_STATE });
    await ctx.dispose();
  });

  async function open(page: Page) {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(PAGE, { waitUntil: "networkidle" });
    return errors;
  }

  const keepButtons = (page: Page) => page.getByRole("button", { name: /^Keep: / });

  // -- mocked states ---------------------------------------------------------

  const row = (n: number, over: Partial<RadarRow> = {}): RadarRow => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title: `Mocked headline number ${n}`,
    summary: "A mocked two line summary that is long enough to need the clamp when the row is narrow.",
    category: "ai", sourceUrl: `https://huggingnews.com/ai/mock-${n}`, sourceHost: "huggingnews.com",
    publishedAt: "2026-10-26T03:00:00Z", day: "2026-10-26", status: "scored", cohortVersion: 1, eligible: true,
    audienceFit: { score: 2.5, confidence: 0.9 }, noveltyDistance: 0.5, label: null, latestLabelId: null, ...over,
  });

  function mock(rows: RadarRow[], over: Partial<RadarPageData> = {}): RadarPageData {
    return {
      view: "to-label",
      cohort: { version: 1, startedAt: "2026-10-26T00:00:00Z", isActive: true },
      cohorts: [{ version: 1, startedAt: "2026-10-26T00:00:00Z", isActive: true }],
      counts: { toLabel: rows.length, shortlisted: rows.length, kept: 0, skipped: 0, all: rows.length },
      days: rows.length ? [{ day: "2026-10-26", rows, more: [] }] : [],
      page: null,
      progress: { todayLabelled: 0, todayTotal: rows.length, cohortLabelled: 0, cohortTarget: 50, validDays: 0, targetDays: 7, gateReady: false },
      status: { state: "healthy", lastCheckAt: "2026-10-26T03:00:00Z", failureClass: null, failedSlotAt: null, nextCheckAt: "2026-10-26T05:00:00Z" },
      generatedAt: "2026-10-26T04:00:00Z",
      ...over,
    };
  }

  /** Answer the next view switch with `data`. The first render stays real. */
  async function mockViews(page: Page, data: RadarPageData | { failWith: number }) {
    await page.route("**/api/admin/radar?view=**", (route) => {
      if ("failWith" in data) return route.fulfill({ status: data.failWith, json: { ok: false, error: "x" } });
      return route.fulfill({ json: data });
    });
  }

  test("empty queue, done for today, and the radar is off", async ({ page }) => {
    await open(page);
    await mockViews(page, mock([], { view: "kept" }));
    await page.getByRole("button", { name: /^Kept/ }).click();
    await expect(page.getByText("Nothing kept yet.")).toBeVisible();

    await mockViews(page, mock([], { view: "to-label", progress: { todayLabelled: 8, todayTotal: 8, cohortLabelled: 8, cohortTarget: 50, validDays: 1, targetDays: 7, gateReady: false } }));
    await page.getByRole("button", { name: /^To label/ }).click();
    await expect(page.getByText(/^Done for today\. 8 of 8 labelled\. Next check \d\d:\d\d (AEDT|AEST)\.$/)).toBeVisible();

    await mockViews(page, mock([row(1)], { status: { state: "off", lastCheckAt: null, failureClass: null, failedSlotAt: null, nextCheckAt: "2026-10-26T05:00:00Z" } }));
    await page.getByRole("button", { name: /^Shortlisted/ }).click();
    await expect(page.getByText("Radar is off. Set the news_radar_enabled setting to start it.")).toBeVisible();
  });

  test("no Jev key points at Integrations", async ({ page }) => {
    await open(page);
    await mockViews(page, mock([row(1)], { status: { state: "no-key", lastCheckAt: null, failureClass: null, failedSlotAt: null, nextCheckAt: "2026-10-26T05:00:00Z" } }));
    await page.getByRole("button", { name: /^Shortlisted/ }).click();
    await expect(page.getByText("Jev is not connected. Add the TypeSafe key in Integrations to start scoring.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Integrations" })).toHaveAttribute("href", "/admin/integrations/typesafe");
  });

  test("a failed load says so plainly and Retry recovers", async ({ page }) => {
    await open(page);
    await mockViews(page, { failWith: 500 });
    await page.getByRole("button", { name: /^Kept/ }).click();
    const alert = page.locator("#radar").getByRole("alert");
    await expect(alert).toContainText("Couldn't load the radar.");
    await page.unroute("**/api/admin/radar?view=**");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(alert).toHaveCount(0);
  });

  test("a save that fails reverts the row, says so, and Retry saves", async ({ page }) => {
    await open(page);
    await mockViews(page, mock([row(1)]));
    await page.getByRole("button", { name: /^Skipped/ }).click();

    let calls = 0;
    await page.route("**/api/admin/radar/*", (route) => {
      calls += 1;
      if (calls === 1) return route.fulfill({ status: 500, json: { ok: false, error: "x" } });
      return route.fulfill({ json: { ok: true, label: { id: "l1", decision: "keep" }, latestLabelId: "l1", changed: true } });
    });
    const keep = page.getByRole("button", { name: "Keep: Mocked headline number 1" });
    await keep.click();
    const failed = page.locator("#radar p", { hasText: "Couldn't save." });
    await expect(failed).toBeVisible();
    await expect(keep).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(keep).toHaveAttribute("aria-pressed", "true");
    await expect(failed).toHaveCount(0);
  });

  test("a conflict shows who is current and 'Use mine' wins", async ({ page }) => {
    await open(page);
    await mockViews(page, mock([row(1)]));
    await page.getByRole("button", { name: /^Skipped/ }).click();

    let calls = 0;
    let sentIfLatest: unknown = "unset";
    await page.route("**/api/admin/radar/*", (route) => {
      calls += 1;
      if (calls === 1) {
        return route.fulfill({ status: 409, json: { ok: false, error: "conflict", current: { id: "other", decision: "skip" }, latestLabelId: "other" } });
      }
      sentIfLatest = route.request().postDataJSON().ifLatestLabelId;
      return route.fulfill({ json: { ok: true, label: { id: "mine", decision: "keep" }, latestLabelId: "mine", changed: true } });
    });
    const keep = page.getByRole("button", { name: "Keep: Mocked headline number 1" });
    await keep.click();
    const note = page.locator("#radar p", { hasText: "Changed in another tab." });
    await expect(note).toContainText("Now: Skipped.");
    await expect(page.getByRole("button", { name: "Skip: Mocked headline number 1" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Use mine (Keep)" }).click();
    await expect(keep).toHaveAttribute("aria-pressed", "true");
    await expect(note).toHaveCount(0);
    expect(sentIfLatest).toBe("other");
  });

  test("a 400-item backlog renders in one view without a pager, and All paginates", async ({ page }) => {
    await open(page);
    const rows = Array.from({ length: 400 }, (_, i) => row(i + 1));
    await mockViews(page, mock(rows, { view: "shortlisted" }));
    const t0 = Date.now();
    await page.getByRole("button", { name: /^Shortlisted/ }).click();
    await expect(keepButtons(page)).toHaveCount(0); // read-only outside To label
    await expect(page.locator("[role=group]")).toHaveCount(400);
    expect(Date.now() - t0, "render time for 400 rows").toBeLessThan(5_000);
    await expect(page.getByRole("navigation", { name: "Pages" })).toHaveCount(0);

    await mockViews(page, mock(rows.slice(0, 50), { view: "all", page: { number: 1, pages: 8 } }));
    await page.getByRole("button", { name: /^All/ }).click();
    await expect(page.getByText("1 / 8")).toBeVisible();
  });

  // -- real data -------------------------------------------------------------

  test("status area, hint, tab and a polite live region are present, with no console errors", async ({ page }) => {
    const errors = await open(page);
    await expect(page.getByRole("link", { name: "Radar", exact: true })).toHaveAttribute("href", PAGE);
    await expect(page.getByRole("heading", { level: 1, name: "Radar" })).toBeVisible();
    await expect(page.getByText(/^Today \d+ of \d+ labelled$/)).toBeVisible();
    await expect(page.locator('[aria-live="polite"]').first()).toBeAttached();
    await page.screenshot({ path: "test-results/radar-default.png", fullPage: true });
    expect(errors, "browser console errors").toEqual([]);
  });

  test("labels an item blind, offers Undo, survives a reload, and is put back", async ({ page }) => {
    await open(page);
    const keep = keepButtons(page).first();
    test.skip((await keep.count()) === 0, "no eligible unlabelled item in this database");
    const label = (await keep.getAttribute("aria-label"))!;
    const title = label.replace(/^Keep: /, "");
    const skip = page.getByRole("button", { name: `Skip: ${title}` });

    // Blind: no score text until Show scores is on.
    await expect(page.locator("#radar").getByText(/^Confidence$/)).toHaveCount(0);

    await keep.click();
    await expect(keep).toHaveAttribute("aria-pressed", "true");
    await expect(skip).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page.locator('[aria-live="polite"]').first()).toContainText("Kept");

    // Switch, then clear by pressing the selected one again.
    await skip.click();
    await expect(skip).toHaveAttribute("aria-pressed", "true");
    await expect(keep).toHaveAttribute("aria-pressed", "false");

    // Persisted: after a reload the item has left To label and is in Skipped.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: `Keep: ${title}` })).toHaveCount(0);
    await page.getByRole("button", { name: /^Skipped/ }).click();
    await expect(page.getByRole("link", { name: new RegExp(title.slice(0, 30)) })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Keep: / })).toHaveCount(0); // read-only here

    // Put it back through the API (a clear row), then confirm it is queued again.
    const id = await page.evaluate(
      (t) => [...document.querySelectorAll("[role=group] a")].find((a) => a.textContent?.startsWith(t))?.id.replace("row-", "") ?? null,
      title.slice(0, 30),
    );
    expect(id).toBeTruthy();
    const res = await page.request.patch(`/api/admin/radar/${id}`, {
      data: { decision: "clear", requestId: crypto.randomUUID() },
      headers: { Origin: BASE_URL },
    });
    expect(res.status()).toBe(200);
    await page.getByRole("button", { name: /^To label/ }).click();
    await expect(page.getByRole("button", { name: `Keep: ${title}` })).toBeVisible();
  });

  test("Undo restores the previous label", async ({ page }) => {
    await open(page);
    const keep = keepButtons(page).first();
    test.skip((await keep.count()) === 0, "no eligible unlabelled item in this database");
    await keep.click();
    await expect(keep).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(keep).toHaveAttribute("aria-pressed", "false");
  });

  test("keyboard only: Space labels, focus stays on the button, Enter clears", async ({ page }) => {
    await open(page);
    const keep = keepButtons(page).first();
    test.skip((await keep.count()) === 0, "no eligible unlabelled item in this database");
    const name = (await keep.getAttribute("aria-label"))!;
    await keep.focus();
    await page.keyboard.press("Space");
    await expect(keep).toHaveAttribute("aria-pressed", "true");
    // The button is aria-disabled while the save is in flight (a double press is ignored).
    await expect(keep).toHaveAttribute("aria-disabled", "false");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(name);
    await page.keyboard.press("Enter");
    await expect(keep).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(name);
  });

  test("Show scores reveals the numbers, persists per browser, and switches off", async ({ page }) => {
    await open(page);
    const sw = page.getByRole("switch", { name: "Show scores" });
    test.skip((await keepButtons(page).count()) === 0, "no eligible unlabelled item in this database");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#radar").getByText("Confidence").first()).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("switch", { name: "Show scores" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("switch", { name: "Show scores" }).click();
    await expect(page.locator("#radar").getByText("Confidence")).toHaveCount(0);
  });

  // -- responsive and accessibility -----------------------------------------

  for (const [width, height] of [[375, 800], [768, 900], [1280, 900]] as const) {
    test(`layout at ${width}px: no horizontal page scroll, pills stay on one row`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await open(page);
      await page.screenshot({ path: `test-results/radar-${width}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
      const pills = page.getByRole("navigation", { name: "Radar views" }).getByRole("button");
      const first = await pills.first().boundingBox();
      const last = await pills.last().boundingBox();
      expect(Math.abs((first?.y ?? 0) - (last?.y ?? 1))).toBeLessThan(2);

      const keep = keepButtons(page).first();
      if ((await keep.count()) > 0) {
        const box = (await keep.boundingBox())!;
        if (width < 640) expect(box.height, "touch target").toBeGreaterThanOrEqual(44);
        else expect(box.height).toBeLessThanOrEqual(32);
      }
    });
  }

  test("reduced motion removes the colour transition on the label buttons", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    const keep = keepButtons(page).first();
    test.skip((await keep.count()) === 0, "no eligible unlabelled item in this database");
    expect(await keep.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await keep.evaluate((el) => getComputedStyle(el).transitionDuration)).not.toBe("0s");
  });

  test("axe finds no WCAG A or AA violation inside the radar", async ({ page }) => {
    test.skip(!AXE, "axe-core is not installed");
    await open(page);
    // The site's CSP blocks an injected <script>; evaluating the source over CDP is not subject to it.
    await page.evaluate(readFileSync(AXE!, "utf8"));
    const result = await page.evaluate(async () => {
      // @ts-expect-error injected by addScriptTag
      const r = await window.axe.run("#radar", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
      return r.violations.map((v: { id: string; nodes: { target: string[] }[] }) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 3) }));
    });
    expect(result, "axe violations").toEqual([]);
  });
});

test("the radar endpoints refuse anonymous callers", async ({ request }) => {
  const get = await request.get("/api/admin/radar", { maxRedirects: 0 });
  expect([401, 403, 307]).toContain(get.status());
  const patch = await request.patch("/api/admin/radar/00000000-0000-4000-8000-000000000001", {
    data: { decision: "keep", requestId: "00000000-0000-4000-8000-000000000002" },
    headers: { Origin: BASE_URL },
    maxRedirects: 0,
  });
  expect([401, 403, 307]).toContain(patch.status());
});
