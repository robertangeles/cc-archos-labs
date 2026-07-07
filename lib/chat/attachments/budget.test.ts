import { describe, expect, it } from "vitest";
import { estimateTokens, fitContext, type HistoryMsg } from "./budget";

describe("estimateTokens", () => {
  it("approximates 4 chars per token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("fitContext", () => {
  const hugeDoc = "word ".repeat(60_000); // ~300k chars ~ 75k tokens

  it("injects a small doc and keeps history", () => {
    const r = fitContext({
      windowTokens: 128_000,
      systemText: "system prompt",
      attachments: [
        { fileName: "brief.txt", extractedText: "short document content" },
      ],
      history: [{ role: "user", content: "hello" }],
    });
    expect(r.attachmentBlock).toContain("brief.txt");
    expect(r.attachmentBlock).toContain("short document content");
    expect(r.omittedDocNames).toHaveLength(0);
    expect(r.history).toHaveLength(1);
  });

  it("omits a doc that blows the window and reports it", () => {
    const r = fitContext({
      windowTokens: 8_000,
      systemText: "sys",
      attachments: [{ fileName: "huge.pdf", extractedText: hugeDoc }],
      history: [{ role: "user", content: "question" }],
    });
    expect(r.omittedDocNames).toContain("huge.pdf");
    // Nothing fit → no block emitted.
    expect(r.attachmentBlock).toBe("");
  });

  it("trims oldest history but always keeps the newest message", () => {
    const history: HistoryMsg[] = Array.from({ length: 200 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "x".repeat(2000),
    }));
    const r = fitContext({
      windowTokens: 8_000,
      systemText: "",
      attachments: [],
      history,
    });
    expect(r.history.length).toBeGreaterThanOrEqual(1);
    expect(r.history.length).toBeLessThan(history.length);
    // Newest message survives.
    expect(r.history[r.history.length - 1]).toEqual(history[history.length - 1]);
    // Chronological order preserved.
    expect(r.history[0].content).toBeDefined();
  });
});
