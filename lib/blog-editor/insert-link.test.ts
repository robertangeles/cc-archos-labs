import { describe, expect, it } from "vitest";
import { computeLinkInsertion } from "./insert-link";

// Regression suite for the Insert-Link silent-failure bug
// (wiki/synthesis/2026-05-24-blog-tidy-ceo-review.md E2).
//
// Pre-fix behaviour: opening the suggestions drawer without first
// focusing the textarea read selectionStart=0, so the link was
// inserted at the top of the article. On a long scrolled-down post
// the insertion was off-screen — the user concluded "Insert link
// does nothing." This test suite locks the fix in.

const LINK = "[Example post](/blog/example)";

describe("computeLinkInsertion — REGRESSION: never insert at position 0 by default", () => {
  it("appends to END when textarea was never focused (silent-failure regression)", () => {
    // The exact case that broke the user-reported flow: long article,
    // no prior textarea focus, drawer click. Before the fix this would
    // produce { cursor: 0 } and stuff the link at the top.
    const longContent = "# Article\n\n" + "Paragraph.\n\n".repeat(200);
    const result = computeLinkInsertion({
      contentMd: longContent,
      markdown: LINK,
      isLive: false,
      liveStart: null,
      liveEnd: null,
      snapshot: null,
    });
    expect(result.kind).toBe("at_end");
    expect(result.cursor).toBeGreaterThan(longContent.length);
    // Insertion lands AFTER all existing content
    expect(result.nextContent.startsWith(longContent)).toBe(true);
    expect(result.nextContent).toContain(LINK);
  });

  it("prepends a newline at END to avoid running into the last paragraph", () => {
    const result = computeLinkInsertion({
      contentMd: "Last line without trailing newline",
      markdown: LINK,
      isLive: false,
      liveStart: null,
      liveEnd: null,
      snapshot: null,
    });
    expect(result.insertion).toBe("\n" + LINK);
    expect(result.nextContent).toBe(
      "Last line without trailing newline\n" + LINK,
    );
  });

  it("does NOT prepend a newline when content already ends with one", () => {
    const result = computeLinkInsertion({
      contentMd: "Already has newline.\n",
      markdown: LINK,
      isLive: false,
      liveStart: null,
      liveEnd: null,
      snapshot: null,
    });
    expect(result.insertion).toBe(LINK);
    expect(result.nextContent).toBe("Already has newline.\n" + LINK);
  });

  it("does NOT prepend a newline when content is empty", () => {
    const result = computeLinkInsertion({
      contentMd: "",
      markdown: LINK,
      isLive: false,
      liveStart: null,
      liveEnd: null,
      snapshot: null,
    });
    expect(result.insertion).toBe(LINK);
    expect(result.nextContent).toBe(LINK);
  });
});

describe("computeLinkInsertion — three-tier cursor resolution", () => {
  it("uses live selection when textarea is focused", () => {
    const content = "abc def ghi";
    const result = computeLinkInsertion({
      contentMd: content,
      markdown: LINK,
      isLive: true,
      liveStart: 4,
      liveEnd: 4,
      snapshot: { start: 0, end: 0 }, // snapshot ignored when live
    });
    expect(result.kind).toBe("at_cursor");
    expect(result.nextContent).toBe("abc " + LINK + "def ghi");
    expect(result.cursor).toBe(4 + LINK.length);
  });

  it("uses snapshot when textarea is not focused but snapshot exists", () => {
    const content = "abc def ghi";
    const result = computeLinkInsertion({
      contentMd: content,
      markdown: LINK,
      isLive: false,
      liveStart: null,
      liveEnd: null,
      snapshot: { start: 7, end: 7 },
    });
    expect(result.kind).toBe("at_snapshot");
    expect(result.nextContent).toBe("abc def" + LINK + " ghi");
    expect(result.cursor).toBe(7 + LINK.length);
  });

  it("clamps snapshot positions that exceed current content length", () => {
    // User typed text, snapshot captured, then deleted text — snapshot
    // may point past the new end.
    const result = computeLinkInsertion({
      contentMd: "short",
      markdown: LINK,
      isLive: false,
      liveStart: null,
      liveEnd: null,
      snapshot: { start: 999, end: 999 },
    });
    expect(result.kind).toBe("at_snapshot");
    expect(result.nextContent).toBe("short" + LINK);
  });

  it("clamps live selection that returns a negative value", () => {
    const result = computeLinkInsertion({
      contentMd: "abc",
      markdown: LINK,
      isLive: true,
      liveStart: -1,
      liveEnd: -1,
      snapshot: null,
    });
    // Negative clamps to END, not to 0
    expect(result.cursor).toBeGreaterThanOrEqual(LINK.length);
  });
});

describe("computeLinkInsertion — selection wrap", () => {
  it("wraps the selected text inside the link instead of inserting raw markdown", () => {
    const content = "I really like this thing.";
    // Select "this thing"
    const start = 14;
    const end = 24;
    const result = computeLinkInsertion({
      contentMd: content,
      markdown: LINK,
      isLive: true,
      liveStart: start,
      liveEnd: end,
      snapshot: null,
    });
    expect(result.kind).toBe("wrap_selection");
    expect(result.insertion).toBe("[this thing](/blog/example)");
    expect(result.nextContent).toBe(
      "I really like [this thing](/blog/example).",
    );
  });

  it("wraps selection from snapshot path too", () => {
    const content = "I really like this thing.";
    const result = computeLinkInsertion({
      contentMd: content,
      markdown: LINK,
      isLive: false,
      liveStart: null,
      liveEnd: null,
      snapshot: { start: 14, end: 24 },
    });
    expect(result.kind).toBe("wrap_selection");
    expect(result.insertion).toBe("[this thing](/blog/example)");
  });

  it("does not wrap if markdown isn't in [label](url) shape", () => {
    const result = computeLinkInsertion({
      contentMd: "abc def",
      markdown: "**bold**",
      isLive: true,
      liveStart: 4,
      liveEnd: 7,
      snapshot: null,
    });
    // Wrap fails (regex doesn't match), kind still reports
    // wrap_selection because a selection WAS present
    expect(result.kind).toBe("wrap_selection");
    expect(result.insertion).toBe("**bold**");
    expect(result.nextContent).toBe("abc **bold**");
  });
});

describe("computeLinkInsertion — cursor lands AFTER inserted text", () => {
  it("cursor at end of insertion in at_cursor mode", () => {
    const result = computeLinkInsertion({
      contentMd: "abc",
      markdown: LINK,
      isLive: true,
      liveStart: 3,
      liveEnd: 3,
      snapshot: null,
    });
    expect(result.cursor).toBe(3 + LINK.length);
  });

  it("cursor at end of insertion in wrap_selection mode", () => {
    const result = computeLinkInsertion({
      contentMd: "abc xyz",
      markdown: LINK,
      isLive: true,
      liveStart: 4,
      liveEnd: 7,
      snapshot: null,
    });
    // Wrapped insertion is "[xyz](/blog/example)" = 20 chars
    const expectedInsertionLen = "[xyz](/blog/example)".length;
    expect(result.cursor).toBe(4 + expectedInsertionLen);
  });

  it("cursor at end of insertion in at_end mode (accounts for leading newline)", () => {
    const result = computeLinkInsertion({
      contentMd: "abc",
      markdown: LINK,
      isLive: false,
      liveStart: null,
      liveEnd: null,
      snapshot: null,
    });
    // at_end on non-empty + no trailing newline → inserts "\n" + LINK
    expect(result.cursor).toBe(3 + 1 + LINK.length);
  });
});
