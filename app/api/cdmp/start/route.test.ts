import { beforeEach, describe, expect, it, vi } from "vitest";

// Route-handler tests for POST /api/cdmp/start. The auth boundary, config,
// generation, and DB are mocked so we assert the route's OWN logic: mode
// branching, specialist validation, supply cap, the min-question guard, the
// HTTP status mapping, and the penetration path (missing auth, invalid/tampered
// area). isSpecialistAreaSlug is the REAL pure guard (config-shared, no I/O).

const {
  requireUserMock,
  getCdmpConfigMock,
  getSpecialistAreaMock,
  generateSpecialistExamMock,
  generateQuestionBatchMock,
  distributeQuestionsMock,
  getDbMock,
  valuesMock,
} = vi.hoisted(() => {
  const valuesMock = vi.fn();
  return {
    requireUserMock: vi.fn(),
    getCdmpConfigMock: vi.fn(),
    getSpecialistAreaMock: vi.fn(),
    generateSpecialistExamMock: vi.fn(),
    generateQuestionBatchMock: vi.fn(),
    distributeQuestionsMock: vi.fn(),
    getDbMock: vi.fn(),
    valuesMock,
  };
});

vi.mock("@/lib/cdmp/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/cdmp/config", () => ({ getCdmpConfig: getCdmpConfigMock }));
vi.mock("@/lib/cdmp/specialist", () => ({ getSpecialistArea: getSpecialistAreaMock }));
vi.mock("@/lib/cdmp/generate", () => ({
  generateSpecialistExam: generateSpecialistExamMock,
  generateQuestionBatch: generateQuestionBatchMock,
}));
vi.mock("@/lib/cdmp/weights", () => ({ distributeQuestions: distributeQuestionsMock }));
vi.mock("@/lib/db", () => ({ getDb: getDbMock }));

import { POST } from "./route";

const req = (body: unknown) =>
  new Request("http://localhost/api/cdmp/start", {
    method: "POST",
    body: JSON.stringify(body),
  });

const fakeQuestions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ questionText: `q${i}`, options: [], correctAnswer: "A", explanation: "", knowledgeArea: "data_quality", dmbokChapterRef: "Chapter 13", chunkIds: [] }));

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ ok: true, session: { user: { id: "u1" } } });
  getCdmpConfigMock.mockResolvedValue({
    questionCounts: [20, 40, 60, 100],
    knowledgeAreas: [{ slug: "data_quality", label: "Data Quality", chapter: "Chapter 13", weight: 0.11 }],
    timerMinutesPer100: 90,
  });
  getSpecialistAreaMock.mockResolvedValue({ slug: "data_quality", label: "Data Quality", chapter: "Chapter 13", poolSize: 43, maxQuestions: 86 });
  valuesMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "session-1" }]) });
  getDbMock.mockReturnValue({ insert: vi.fn().mockReturnValue({ values: valuesMock }) });
});

describe("POST /api/cdmp/start — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    requireUserMock.mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) });
    const res = await POST(req({ mode: "specialist", specialistArea: "data_quality" }));
    expect(res.status).toBe(401);
    expect(getSpecialistAreaMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/cdmp/start — specialist validation", () => {
  it("rejects an invalid specialist area (400)", async () => {
    const res = await POST(req({ mode: "specialist", specialistArea: "not_a_real_area" }));
    expect(res.status).toBe(400);
    expect(generateSpecialistExamMock).not.toHaveBeenCalled();
  });

  it("rejects a non-specialist area slug — mode tampering (400)", async () => {
    // data_security is a real knowledge area but NOT one of the 7 specialist exams.
    const res = await POST(req({ mode: "specialist", specialistArea: "data_security", questionCount: 20 }));
    expect(res.status).toBe(400);
    expect(getSpecialistAreaMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the chapter pool is empty (poolSize=0, maxQuestions=0)", async () => {
    getSpecialistAreaMock.mockResolvedValue({ slug: "data_quality", label: "Data Quality", chapter: "Chapter 13", poolSize: 0, maxQuestions: 0 });
    const res = await POST(req({ mode: "specialist", specialistArea: "data_quality", questionCount: 20 }));
    expect(res.status).toBe(503);
    expect(generateSpecialistExamMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the chapter pool is too small to support any valid count (poolSize=5, maxQuestions=10)", async () => {
    // poolSize=5 → maxQuestions=10, which is below the minimum allowed count of 20.
    // Without this guard the route would fall through to a confusing 400 "must be one of 20,40,60,100".
    getSpecialistAreaMock.mockResolvedValue({ slug: "data_quality", label: "Data Quality", chapter: "Chapter 13", poolSize: 5, maxQuestions: 10 });
    const res = await POST(req({ mode: "specialist", specialistArea: "data_quality" }));
    expect(res.status).toBe(503);
    expect(generateSpecialistExamMock).not.toHaveBeenCalled();
  });

  it("rejects a question count above the supply cap (400, returns max)", async () => {
    const res = await POST(req({ mode: "specialist", specialistArea: "data_quality", questionCount: 100 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.maxQuestions).toBe(86);
    expect(generateSpecialistExamMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/cdmp/start — specialist generation", () => {
  it("returns 502 when generation underdelivers (no broken exam, no orphan session)", async () => {
    generateSpecialistExamMock.mockResolvedValue(fakeQuestions(5)); // < 50% of 40
    const res = await POST(req({ mode: "specialist", specialistArea: "data_quality", questionCount: 40 }));
    expect(res.status).toBe(502);
    expect(valuesMock).not.toHaveBeenCalled(); // session NOT inserted on failure
  });

  it("creates a specialist session and returns questions on the happy path", async () => {
    generateSpecialistExamMock.mockResolvedValue(fakeQuestions(40));
    const res = await POST(req({ mode: "specialist", specialistArea: "data_quality", questionCount: 40 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe("session-1");
    expect(body.questions).toHaveLength(40);
    expect(body.config.specialistArea).toBe("data_quality");
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ examType: "specialist", specialistArea: "data_quality" }),
    );
  });
});

describe("POST /api/cdmp/start — fundamentals path still works", () => {
  it("defaults to fundamentals and does not touch the specialist path", async () => {
    distributeQuestionsMock.mockReturnValue([{ slug: "data_quality", label: "Data Quality", chapter: "Chapter 13", questionCount: 20 }]);
    generateQuestionBatchMock.mockResolvedValue(fakeQuestions(20));
    const res = await POST(req({ questionCount: 20 }));
    expect(res.status).toBe(200);
    expect(generateQuestionBatchMock).toHaveBeenCalled();
    expect(getSpecialistAreaMock).not.toHaveBeenCalled();
  });
});
