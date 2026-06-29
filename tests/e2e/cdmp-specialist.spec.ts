import { test, expect } from "@playwright/test";

// ============================================================================
// CDMP Specialist exam E2E. The generation + auth are mocked (page.route) so
// the test is deterministic and fast — it exercises the CLIENT flow: the
// two-mode config + supply caps, and the tailored single-subject results.
// The real generation pipeline is covered by the backend tests in PR2a.
// The supply-cap test hits the real getSpecialistAreas (DEV chapter counts).
// ============================================================================

const QUESTION = {
  questionText: "E2E specialist question about data quality dimensions?",
  options: [
    { code: "A", label: "Completeness" },
    { code: "B", label: "Accuracy" },
    { code: "C", label: "Timeliness" },
    { code: "D", label: "Consistency" },
    { code: "E", label: "Validity" },
  ],
  correctAnswer: "A",
  explanation: "Completeness is a core data quality dimension.",
  knowledgeArea: "data_quality",
  dmbokChapterRef: "Chapter 13 — Data Quality",
  chunkIds: [],
};

const SPECIALIST_RESULT = {
  examType: "specialist",
  specialistLabel: "Data Quality",
  totalQuestions: 1,
  correctCount: 1,
  percentCorrect: 100,
  thresholds: {
    associate: { score: 60, passed: true },
    practitioner: { score: 70, passed: true },
    master: { score: 80, passed: true },
  },
  perChapter: [
    { slug: "data_quality", label: "Data Quality", totalQuestions: 1, correctCount: 1, percentCorrect: 100 },
  ],
};

test("specialist deep-link: locked config → exam → tailored single-subject results", async ({ page }) => {
  await page.route("**/api/cdmp/start", (r) =>
    r.fulfill({
      json: {
        sessionId: "e2e-spec-1",
        config: { questionCount: 1, timerEnabled: false, timerSeconds: 0, mode: "specialist", specialistArea: "data_quality" },
        questions: [QUESTION],
        totalQuestions: 1,
      },
    }),
  );
  await page.route("**/api/cdmp/answer", (r) => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/cdmp/complete", (r) => r.fulfill({ json: { result: SPECIALIST_RESULT } }));

  await page.goto("/tools/cdmp-practice?mode=specialist&area=data_quality");

  // Subject is pre-locked (chip), no Fundamentals/Specialist toggle shown.
  await expect(page.getByText("Subject", { exact: true })).toBeVisible();
  await expect(page.getByText("Data Quality").first()).toBeVisible();
  await expect(page.getByRole("radio", { name: "Fundamentals" })).toHaveCount(0);

  await page.getByRole("button", { name: "Begin exam" }).click();

  // Exam: answer the single question, then finish.
  await expect(page.getByText(QUESTION.questionText)).toBeVisible();
  await page.getByText("Completeness").click();
  await page.getByRole("button", { name: /finish exam/i }).click();

  // Tailored specialist results — the single-subject "Subject mastery" panel.
  const mastery = page.getByText("Subject mastery");
  await expect(mastery).toBeVisible();
  await expect(page.getByText("Master level reached").first()).toBeVisible();
  // The 14-area "Competency Profile" radar must NOT appear for a specialist exam.
  await expect(page.getByText("Competency Profile")).toHaveCount(0);
});

test("specialist config: toggle reveals the picker and caps over-supply counts", async ({ page }) => {
  await page.goto("/tools/cdmp-practice");
  await page.getByRole("button", { name: /start practicing/i }).click();

  // Fundamentals by default; all counts enabled.
  await expect(page.getByRole("radio", { name: "Fundamentals" })).toBeVisible();
  await expect(page.getByRole("button", { name: /100 questions/ })).toBeEnabled();

  // Switch to Specialist → 7-subject picker appears.
  await page.getByRole("radio", { name: "Specialist" }).click();
  await expect(page.getByRole("radio", { name: "Data Quality" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Metadata Management" })).toBeVisible();

  // Metadata Management caps at 46 → 60 and 100 disabled, 20 enabled.
  await page.getByRole("radio", { name: "Metadata Management" }).click();
  await expect(page.getByText(/supports up to 46 questions/)).toBeVisible();
  await expect(page.getByRole("button", { name: /100 questions/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /60 questions/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /20 questions/ })).toBeEnabled();
});
