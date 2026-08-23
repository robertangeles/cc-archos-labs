import { test, expect } from "@playwright/test";
import path from "node:path";

// ============================================================================
// Watermark Remover E2E. Everything runs client-side (no auth, no server data
// path), so unlike chat-attach-files.spec.ts there's no user registration
// step — just drive the page directly. Follows the same convention: real
// file selection via page.setInputFiles on the hidden <input type="file">,
// not simulated OS-level drag-and-drop DataTransfer events.
//
// Fixture: tests/e2e/fixtures/watermark-e2e-photo.jpg — a small, entirely
// synthetic JPEG (sharp-generated 48x48 solid color) with a real EXIF
// orientation tag and a fake C2PA APP11 segment spliced in. No real
// camera/location data. Generation is documented in the fixture's own
// commit message.
//
// Fixture: tests/e2e/fixtures/watermark-e2e-text.txt — "Hello<ZWSP>World",
// one zero-width space (U+200B), for the text-mode file-upload path.
// ============================================================================

const FIXTURE = path.resolve("tests/e2e/fixtures/watermark-e2e-photo.jpg");
const TEXT_FIXTURE = path.resolve("tests/e2e/fixtures/watermark-e2e-text.txt");

test("drop/select a photo shows findings and a downloadable result", async ({ page }) => {
  await page.goto("/tools/watermark-remover", { waitUntil: "networkidle" });

  await page.getByRole("tab", { name: "Image" }).click();

  await page.locator("#watermark-image-input").setInputFiles(FIXTURE);

  const heading = page.getByRole("heading", { name: /removed \d+ signal/i });
  await expect(heading).toBeVisible({ timeout: 10_000 });

  // Both signal types the fixture carries should be reported.
  await expect(page.getByText("EXIF data", { exact: false })).toBeVisible();
  await expect(page.getByText("C2PA content-credentials manifest", { exact: false })).toBeVisible();

  // Orientation was preserved, not stripped along with the rest of EXIF.
  await expect(page.getByText("orientation preserved")).toBeVisible();

  await expect(page.getByRole("button", { name: "Download cleaned photo" })).toBeVisible();
  await expect(page.getByRole("button", { name: /download removal log/i })).toBeVisible();
});

test("the explain-on-demand toggle reveals plain-English detail for a finding", async ({ page }) => {
  await page.goto("/tools/watermark-remover", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Image" }).click();
  await page.locator("#watermark-image-input").setInputFiles(FIXTURE);

  const exifRow = page.getByRole("button", { name: "EXIF data" });
  await expect(exifRow).toBeVisible({ timeout: 10_000 });
  await expect(exifRow.getByText("What's this?")).toBeVisible();
  await exifRow.click();

  await expect(page.getByText(/camera and device metadata/i)).toBeVisible();
});

test("the image dropzone is reachable and operable by keyboard alone", async ({ page }) => {
  await page.goto("/tools/watermark-remover", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Image" }).click();

  // Tab order: Text tab -> Image tab (already clicked, focus stays there
  // per browser default after a click) -> next Tab should reach the file
  // input directly (it's a real, natively focusable <input type="file">
  // with sr-only styling, not a fake div-based dropzone).
  await page.keyboard.press("Tab");
  const fileInput = page.locator("#watermark-image-input");
  await expect(fileInput).toBeFocused();

  // A focused native file input responds to Enter/Space by opening the OS
  // picker — that's standard browser behavior, not something this app
  // implements or can assert on in a headless run. What we CAN assert is
  // that the control is the right element, focusable, and in tab order.
  expect(await fileInput.getAttribute("type")).toBe("file");
});

test("text mode strips invisible Unicode live as you type, no submit button", async ({ page }) => {
  await page.goto("/tools/watermark-remover", { waitUntil: "networkidle" });

  const textarea = page.getByLabel("Paste text to check for hidden AI watermarks");
  await textarea.fill(`Hello${String.fromCharCode(0x200b)}World`);

  await expect(page.getByRole("heading", { name: "Removed 1 signal" })).toBeVisible();
  await expect(page.getByText("Zero-width space", { exact: false })).toBeVisible();
});

test("uploading a .txt file populates the textarea and shows results", async ({ page }) => {
  await page.goto("/tools/watermark-remover", { waitUntil: "networkidle" });

  await page.locator("#watermark-text-file-input").setInputFiles(TEXT_FIXTURE);

  // The textarea mirrors the raw uploaded content verbatim (same as typing)
  // — stripping only ever happens in the derived results panel, never in place.
  const textarea = page.getByLabel("Paste text to check for hidden AI watermarks");
  await expect(textarea).toHaveValue(`Hello${String.fromCharCode(0x200b)}World`);
  await expect(page.getByRole("heading", { name: "Removed 1 signal" })).toBeVisible();
  await expect(page.getByText("Zero-width space", { exact: false })).toBeVisible();
});

test("uploading a non-text file to the text-mode input shows a friendly rejection", async ({ page }) => {
  await page.goto("/tools/watermark-remover", { waitUntil: "networkidle" });

  await page.locator("#watermark-text-file-input").setInputFiles(FIXTURE);

  // Not getByRole("alert") — Next.js's own route-announcer element
  // (__next-route-announcer__) also carries role="alert" on every page.
  await expect(page.getByText("doesn't look like a text file", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Paste text to check for hidden AI watermarks")).toHaveValue("");
});
