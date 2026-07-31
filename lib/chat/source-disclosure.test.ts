import { describe, expect, it } from "vitest";
import {
  audienceFor,
  ChatPromptSchema,
  ragInstruction,
  resolveSourceBlock,
  type ChatPrompt,
} from "./prompt-config-shared";

// The practice library is commercial IP. `internal` turns may name it; `client`
// turns may not. These tests exist because every failure here is a silent leak
// of the thing that took the most work to build — there is no error, no log, no
// symptom, just Metis telling a prospect which books to buy.

const PROMPT: ChatPrompt = {
  systemPrompt: "x".repeat(60),
  sourceProtection: "PROTECT: never name a source.",
  sourceAttribution: "ATTRIBUTE: name the work you draw on.",
  version: "test-v1",
};

describe("audienceFor", () => {
  it("treats admin as internal", () => {
    expect(audienceFor("admin")).toBe("internal");
  });

  // Everything that is not exactly 'admin' is a client. Listed exhaustively
  // rather than spot-checked: this is the whole security boundary, and a
  // future refactor that loosens it (trim, lowercase, startsWith) should
  // break here loudly rather than pass quietly.
  it.each([
    ["member", "the normal signup role"],
    ["Admin", "case variation"],
    ["ADMIN", "case variation"],
    [" admin", "leading whitespace"],
    ["admin ", "trailing whitespace"],
    ["administrator", "prefix match"],
    ["", "empty string"],
    ["owner", "an org role, not a users.role"],
  ])("treats %j as client (%s)", (role) => {
    expect(audienceFor(role)).toBe("client");
  });

  it.each([[null], [undefined]])("treats %j as client", (role) => {
    expect(audienceFor(role)).toBe("client");
  });
});

describe("resolveSourceBlock", () => {
  it("gives internal turns the attribution block", () => {
    expect(resolveSourceBlock(PROMPT, "internal")).toBe(PROMPT.sourceAttribution);
  });

  it("gives client turns the protection block", () => {
    expect(resolveSourceBlock(PROMPT, "client")).toBe(PROMPT.sourceProtection);
  });

  it("never returns both blocks at once", () => {
    // The blocks contradict each other by design. Any turn receiving both would
    // be asking the model to resolve a conflict, which is precisely the
    // ambiguity the two-field split exists to remove.
    for (const audience of ["internal", "client"] as const) {
      const block = resolveSourceBlock(PROMPT, audience);
      const hasBoth =
        block.includes(PROMPT.sourceProtection!) &&
        block.includes(PROMPT.sourceAttribution!);
      expect(hasBoth).toBe(false);
    }
  });

  it("FAILS CLOSED: a client turn gets nothing when protection is unset, never attribution", () => {
    const missingProtection: ChatPrompt = {
      ...PROMPT,
      sourceProtection: undefined,
    };
    expect(resolveSourceBlock(missingProtection, "client")).toBe("");
  });

  it("returns nothing for a stored prompt that predates the split", () => {
    // Such a row carries its source rules inline in systemPrompt. Appending
    // nothing preserves today's behaviour byte for byte.
    const legacy: ChatPrompt = { systemPrompt: "x".repeat(60), version: "v0" };
    expect(resolveSourceBlock(legacy, "client")).toBe("");
    expect(resolveSourceBlock(legacy, "internal")).toBe("");
  });
});

describe("ragInstruction", () => {
  it("tells internal turns to name the work and take a position", () => {
    const text = ragInstruction("internal");
    expect(text).toMatch(/name the work/i);
    expect(text).toMatch(/take a position/i);
    expect(text).toMatch(/different directions/i);
  });

  it("forbids client turns from naming or alluding to a source", () => {
    const text = ragInstruction("client");
    expect(text).toMatch(/do not name/i);
    expect(text).toMatch(/allude/i);
  });

  it("never tells a client turn to cite, name, or reference a source", () => {
    // The regression this locks down: stream.ts used to inject "Cite the source
    // title when relevant" on EVERY turn while the stored prompt said "I don't
    // cite sources... under all conditions". Both shipped together, every turn.
    const text = ragInstruction("client");
    expect(text).not.toMatch(/\bcite\b/i);
    expect(text).not.toMatch(/name the (work|source|title)/i);
    expect(text).not.toMatch(/source title/i);
  });

  it("produces materially different instructions per audience", () => {
    expect(ragInstruction("internal")).not.toBe(ragInstruction("client"));
  });
});

describe("script copies stay in sync with the source of truth", () => {
  // scripts/_metis-source-blocks.mjs duplicates the internal RAG instruction
  // because plain node scripts cannot import a `server-only` module. A drifted
  // copy would silently make the prompt A/B a measurement of a prompt that
  // never ships — the worst kind of wrong, because the number still looks real.
  it("NEW_RAG_INSTRUCTION matches ragInstruction('internal') exactly", async () => {
    const { NEW_RAG_INSTRUCTION } = await import(
      "../../scripts/_metis-source-blocks.mjs"
    );
    expect(NEW_RAG_INSTRUCTION).toBe(ragInstruction("internal"));
  });
});

describe("ChatPromptSchema", () => {
  it("accepts a legacy row with neither source block", () => {
    const parsed = ChatPromptSchema.safeParse({
      systemPrompt: "x".repeat(60),
      version: "brain-memory-v1",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a row carrying both blocks", () => {
    expect(ChatPromptSchema.safeParse(PROMPT).success).toBe(true);
  });

  it("rejects a source block over the size cap", () => {
    const parsed = ChatPromptSchema.safeParse({
      ...PROMPT,
      sourceProtection: "x".repeat(8001),
    });
    expect(parsed.success).toBe(false);
  });
});
