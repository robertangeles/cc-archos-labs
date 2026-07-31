import { describe, expect, it } from "vitest";
import {
  audienceFor,
  ChatPromptSchema,
  coverageNotice,
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

  // Reasoning quality and source disclosure are separate concerns. A client
  // turn is entitled to the first without the second — withholding it made
  // Metis measurably worse at reasoning for no protective benefit.
  it("gives client turns the reasoning lift, not just a ban", () => {
    const text = ragInstruction("client");
    expect(text).toMatch(/take a position/i);
    expect(text).toMatch(/tension/i);
    // Epistemic honesty, framed as precision rather than hedging — the stored
    // identity block forbids hedging, and phrasing this as "my judgement call"
    // measured 0/10 on the client arm because of that conflict.
    expect(text).toMatch(/established practice ends/i);
    expect(text).toMatch(/not hedging/i);
  });

  // The whole boundary is carried by wording, so the wording is asserted.
  // Anything here that implies a corpus exists confirms what KNOWLEDGE SOURCE
  // PROTECTION is written to deny — and a future edit adding "where two sources
  // disagree" would read as a harmless clarification while breaking it.
  it("client instruction never uses vocabulary that implies a corpus exists", () => {
    const text = ragInstruction("client");
    for (const banned of [
      /\bsources?\b/i,
      /\bdocuments?\b/i,
      /\bbooks?\b/i,
      /\bauthors?\b/i,
      /\bthe literature\b/i,
      /\bknowledge base\b/i,
      /\bcorpus\b/i,
      /\blibrary\b/i,
      /\bretrieved\b/i,
      /\bcitation\b/i,
    ]) {
      // "Never say ... no 'the literature'" is an instruction ABOUT the word,
      // so allow it only inside the explicit prohibition line.
      const offending = text
        .split("\n")
        .filter((l) => banned.test(l) && !/^- Never say or imply/.test(l));
      expect(
        offending,
        `client instruction leaks corpus-implying vocabulary ${banned}: ${offending.join(" | ")}`,
      ).toEqual([]);
    }
  });

  it("still forbids client turns from surfacing tension BETWEEN texts", () => {
    // The safe framing is a tension in the problem; the unsafe one is a
    // disagreement between things Metis read. The instruction must say so.
    expect(ragInstruction("client")).toMatch(/never between texts/i);
  });
});

describe("script copies stay in sync with the source of truth", () => {
  // scripts/metis-source-blocks.mjs duplicates the internal RAG instruction
  // because plain node scripts cannot import a `server-only` module. A drifted
  // copy would silently make the prompt A/B a measurement of a prompt that
  // never ships — the worst kind of wrong, because the number still looks real.
  // Read as TEXT rather than imported: tsconfig excludes scripts/**/*, so a
  // module import type-checks locally under vitest and then fails `tsc
  // --noEmit` in CI. Reading the source also makes this independent of module
  // format — it would still catch drift if the script became CJS or TS.
  it("NEW_RAG_INSTRUCTION matches ragInstruction('internal') exactly", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../scripts/metis-source-blocks.mjs", import.meta.url),
      "utf8",
    );
    // The runtime string cannot be compared to the source text line by line:
    // the literal is built by concatenation ("...excerpt " + "is labelled..."),
    // so no runtime line appears contiguously in the source. Normalising away
    // whitespace, quotes, the `+` joins and escaped newlines makes both sides
    // one comparable run of significant characters.
    // Order matters: drop escaped-newline sequences before stripping lone
    // backslashes, or `\n` would survive as a stray `n`. Backslashes must go
    // too — the source escapes its inner quotes (\"Block's point\") while the
    // runtime string carries them bare.
    const normalise = (s: string) =>
      s.replace(/\\n/g, "").replace(/[\\"'+\s]/g, "");
    expect(
      normalise(src).includes(normalise(ragInstruction("internal"))),
      "scripts/metis-source-blocks.mjs NEW_RAG_INSTRUCTION has drifted from ragInstruction('internal')",
    ).toBe(true);
    expect(
      normalise(src).includes(normalise(ragInstruction("client"))),
      "scripts/metis-source-blocks.mjs CLIENT_RAG_INSTRUCTION has drifted from ragInstruction('client')",
    ).toBe(true);
  });
});

describe("users.role default", () => {
  // audienceFor reads users.role to decide whether Metis may name the practice
  // library. That makes the column default part of the security boundary, not a
  // convenience: an insert path that omits the field must produce someone who
  // CANNOT read the library out. It defaulted to 'admin' until migration 0038,
  // which failed open in exactly the wrong direction.
  it("defaults to member so a forgotten field fails closed", async () => {
    const { users } = await import("../db/schema");
    const col = users.role as unknown as { hasDefault: boolean; default: unknown };
    expect(col.hasDefault).toBe(true);
    expect(col.default).toBe("member");
    // The property that actually matters, stated directly.
    expect(audienceFor(col.default as string)).toBe("client");
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

describe("coverageNotice", () => {
  // "I looked and found nothing" and "I could not look" are different facts.
  // Conflating them teaches the user the notice is noise.
  it("words uncovered and degraded differently for each audience", () => {
    const combos = [
      coverageNotice("uncovered", "internal"),
      coverageNotice("uncovered", "client"),
      coverageNotice("degraded", "internal"),
      coverageNotice("degraded", "client"),
    ];
    expect(new Set(combos).size).toBe(4);
  });

  it("tells an internal turn plainly that the library is empty or unreachable", () => {
    expect(coverageNotice("uncovered", "internal")).toMatch(/library/i);
    expect(coverageNotice("degraded", "internal")).toMatch(/could not be reached/i);
  });

  // The leak that matters: "I could not reach the library" confirms a library
  // exists, which is precisely what the protection block denies.
  it("never reveals a corpus to a client turn, in either state", () => {
    for (const state of ["uncovered", "degraded"] as const) {
      const text = coverageNotice(state, "client");
      for (const banned of [
        /\blibrary\b/i,
        /\bsources?\b/i,
        /\bbooks?\b/i,
        /\bdocuments?\b/i,
        /\bcorpus\b/i,
        /\bretriev/i,
        /\bknowledge base\b/i,
      ]) {
        expect(text, `client ${state} notice leaks ${banned}: ${text}`).not.toMatch(banned);
      }
    }
  });

  it("forbids naming a work when nothing was retrieved", () => {
    // Nothing came back, so any named work would be invented.
    expect(coverageNotice("uncovered", "internal")).toMatch(/not name a work|NOT name a work/i);
    expect(coverageNotice("degraded", "internal")).toMatch(/not name any work|do not name/i);
  });
});

describe("coverageNotice — the thin state", () => {
  // The defect this locks down: the partial-coverage branch injected real,
  // titled excerpts and then appended the UNCOVERED notice, which asserts
  // "nothing relevant was retrieved, so naming a work would be an invention".
  // Flatly false with excerpts directly above it, and worse than saying nothing.
  it("never claims nothing was retrieved", () => {
    for (const audience of ["internal", "client"] as const) {
      const text = coverageNotice("thin", audience);
      expect(text).not.toMatch(/nothing (?:relevant )?was retrieved/i);
      expect(text).not.toMatch(/no substantive material/i);
      expect(text).not.toMatch(/would be an invention/i);
    }
  });

  it("is distinct from every other state, for both audiences", () => {
    const all = (["uncovered", "thin", "degraded"] as const).flatMap((s) => [
      coverageNotice(s, "internal"),
      coverageNotice(s, "client"),
    ]);
    expect(new Set(all).size).toBe(6);
  });

  it("lets an internal turn name the works it was actually given", () => {
    expect(coverageNotice("thin", "internal")).toMatch(/name those works/i);
  });

  it("still leaks nothing to a client turn", () => {
    const text = coverageNotice("thin", "client");
    for (const banned of [/\blibrary\b/i, /\bsources?\b/i, /\bbooks?\b/i, /\bmaterial\b/i, /\bretriev/i]) {
      expect(text, `thin client notice leaks ${banned}: ${text}`).not.toMatch(banned);
    }
  });
});

describe("citation strip is internal-only", () => {
  // The strip lists works by name. Showing it to a client is a louder version
  // of the exact disclosure the protection block forbids — louder because it is
  // a list, not a passing mention the model might soften.
  //
  // Asserted at the source level: stream.ts must gate citedSources on audience,
  // and the realistic regression is someone "simplifying" that ternary away
  // while wiring a UI change.
  it("stream.ts only cites sources for an internal audience", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../lib/chat/stream.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(
      /citedSources\s*=\s*audience === "internal"\s*\?\s*retrieval\.sources\s*:\s*\[\]/,
    );
    // And nothing else may assign it.
    expect(src.match(/const citedSources/g) ?? []).toHaveLength(1);
  });
});

describe("the citation strip covers every grounded branch", () => {
  const src = () =>
    import("node:fs").then(({ readFileSync }) =>
      readFileSync(new URL("../../lib/chat/stream.ts", import.meta.url), "utf8"),
    );

  // The strip's whole value is that a work named in the answer but absent from
  // the strip means fabrication. That inference only holds if EVERY branch that
  // grounds an answer in the library also cites it — otherwise the strip
  // reports real retrievals as fabrications, which is worse than no strip.
  it("merges works search_library found mid-answer into the strip", async () => {
    const s = await src();
    // The tool loop must collect served works and union them with the pre-turn set.
    expect(s).toMatch(/servedSources:\s*toolSources/);
    expect(s).toMatch(/const allSources\s*=/);
    expect(s).toMatch(/toolSources\.filter\(/);
    // And the merged set, not the stale pre-turn one, is what ships.
    expect(s).toMatch(/encodeEvent\(\{ t: "s", sources: allSources \}\)/);
  });

  it("keeps the tool-loop merge audience-gated", async () => {
    const s = await src();
    // allSources must be [] for a client turn regardless of what tools found.
    expect(s).toMatch(/const allSources\s*=\s*\n?\s*audience === "internal"/);
  });

  it("cites the library on the web-search and perplexity branches too", async () => {
    const s = await src();
    // Both build the same ragContext, so both must carry the strip. Counted
    // rather than spot-checked: a branch added later without it is the failure.
    const emits = s.match(/encodeEvent\(\{ t: "s", sources:/g) ?? [];
    expect(emits.length).toBeGreaterThanOrEqual(3);
    const saves = s.match(/undefined,\s*\n\s*(citedSources|allSources),/g) ?? [];
    expect(saves.length).toBeGreaterThanOrEqual(3);
  });
});
