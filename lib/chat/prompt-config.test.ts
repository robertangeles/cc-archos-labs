import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_PROMPT_STARTER,
  ChatPromptSchema,
} from "./prompt-config-shared";

let dbResult: { value: unknown }[] = [];
let dbThrows = false;

vi.mock("../db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (dbThrows) throw new Error("DB unreachable (test)");
            return dbResult;
          },
        }),
      }),
    }),
  }),
}));

const { getChatPrompt } = await import("./prompt-config");

beforeEach(() => {
  dbResult = [];
  dbThrows = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Schema tests (3) ---

describe("ChatPromptSchema", () => {
  it("accepts the starter shape", () => {
    expect(ChatPromptSchema.safeParse(CHAT_PROMPT_STARTER).success).toBe(true);
  });

  it("rejects a prompt shorter than 50 chars", () => {
    const parsed = ChatPromptSchema.safeParse({
      systemPrompt: "too short",
      version: "v1",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing version label", () => {
    const parsed = ChatPromptSchema.safeParse({
      ...CHAT_PROMPT_STARTER,
      version: "",
    });
    expect(parsed.success).toBe(false);
  });
});

// --- Loader tests (5) ---

const VALID_STORED = {
  systemPrompt:
    "You are Metis, the AI assistant for Archos Labs workspace. You help users with AI transformation consulting.",
  version: "v1-metis",
};

describe("getChatPrompt — fallback semantics", () => {
  it("returns stored prompt when DB row is valid", async () => {
    dbResult = [{ value: VALID_STORED }];
    const result = await getChatPrompt();
    expect(result).toEqual(VALID_STORED);
    expect(result).not.toEqual(CHAT_PROMPT_STARTER);
  });

  it("returns starter when DB row is missing", async () => {
    dbResult = [];
    const result = await getChatPrompt();
    expect(result).toEqual(CHAT_PROMPT_STARTER);
  });

  it("returns starter when stored value fails Zod validation", async () => {
    dbResult = [{ value: { garbage: "shape" } }];
    const result = await getChatPrompt();
    expect(result).toEqual(CHAT_PROMPT_STARTER);
  });

  it("returns starter when DB is unreachable", async () => {
    dbThrows = true;
    const result = await getChatPrompt();
    expect(result).toEqual(CHAT_PROMPT_STARTER);
  });

  it("returns starter when stored systemPrompt is too short", async () => {
    dbResult = [{ value: { systemPrompt: "short", version: "v1" } }];
    const result = await getChatPrompt();
    expect(result).toEqual(CHAT_PROMPT_STARTER);
  });
});
