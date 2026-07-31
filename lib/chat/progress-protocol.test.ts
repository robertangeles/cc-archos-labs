import { describe, expect, it } from "vitest";
import { PROGRESS_DELIM, encodeProgress, splitProgress } from "./progress-protocol";

// Progress events share one byte stream with the answer. If the split is wrong
// the user either sees control characters in their message, or loses part of
// the answer — both worse than the blank pane this replaces.

describe("splitProgress", () => {
  it("returns plain content untouched when there are no events", () => {
    expect(splitProgress("a normal answer")).toEqual({
      labels: [],
      content: "a normal answer",
    });
  });

  it("separates completed events from the answer", () => {
    const raw =
      encodeProgress("Consulting the practice library") +
      encodeProgress("Pulling it together") +
      "Here is the answer.";
    expect(splitProgress(raw)).toEqual({
      labels: ["Consulting the practice library", "Pulling it together"],
      content: "Here is the answer.",
    });
  });

  // Mid-stream the closing delimiter may not have arrived. A half-label is
  // neither content nor a label, and rendering it either way flashes a broken
  // fragment into the message body.
  it("ignores an event that is still arriving", () => {
    const raw = `${PROGRESS_DELIM}Consulting the pract`;
    expect(splitProgress(raw)).toEqual({ labels: [], content: "" });
  });

  it("keeps content that arrived before a partial event", () => {
    const raw = `some text${PROGRESS_DELIM}half a lab`;
    expect(splitProgress(raw)).toEqual({ labels: [], content: "some text" });
  });

  it("never leaves a delimiter in the content", () => {
    const raw = encodeProgress("x") + "answer" + encodeProgress("y") + " more";
    const { content } = splitProgress(raw);
    expect(content).not.toContain(PROGRESS_DELIM);
    expect(content).toBe("answer more");
  });

  it("strips a delimiter smuggled inside a label", () => {
    // Labels are server-authored today; this stops that assumption from
    // silently becoming an injection point.
    const encoded = encodeProgress(`evil${PROGRESS_DELIM}injected`);
    expect(splitProgress(encoded + "real")).toEqual({
      labels: ["evilinjected"],
      content: "real",
    });
  });

  it("round-trips an empty answer", () => {
    expect(splitProgress(encodeProgress("Working")).content).toBe("");
  });
});
