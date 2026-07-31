import { describe, expect, it } from "vitest";
import {
  PROGRESS_DELIM,
  encodeProgress,
  splitProgress,
  stripDelimiters,
} from "./progress-protocol";

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

  // Once content has started, there are no more events — the server emits
  // every progress label before the answer. So a delimiter appearing after
  // content is just content, and treating it as an event boundary is what lost
  // 40 characters of a real answer.
  it("treats a delimiter after content as content, not an event", () => {
    const raw = `some text${PROGRESS_DELIM}and more`;
    expect(splitProgress(raw)).toEqual({ labels: [], content: raw });
  });

  it("strips the leading run of events out of the content", () => {
    const raw = encodeProgress("x") + encodeProgress("y") + "answer";
    const { labels, content } = splitProgress(raw);
    expect(labels).toEqual(["x", "y"]);
    expect(content).toBe("answer");
    expect(content).not.toContain(PROGRESS_DELIM);
  });

  // Events never interleave with content in the real protocol, and the server
  // additionally strips delimiters the model itself produced. Both halves are
  // needed: this one keeps a stray delimiter out of the stream, splitProgress
  // keeps a stray one from eating the answer.
  it("the server-side strip makes an interleaved delimiter impossible", () => {
    expect(stripDelimiters(`answer${PROGRESS_DELIM}more`)).toBe("answermore");
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

describe("splitProgress — adversarial", () => {
  // THE BUG THIS LOCKS DOWN. The first implementation split on every delimiter,
  // so an answer legitimately containing U+001F — discussing record separators,
  // or emitting one in a code block — had everything after it silently dropped.
  // Measured: 40 characters of a real answer vanished, and no test caught it.
  it("keeps answer text that itself contains a delimiter", () => {
    const answer = `Use a record separator like ${PROGRESS_DELIM} to delimit fields. That is the answer.`;
    const raw = encodeProgress("Consulting the practice library") + answer;
    const out = splitProgress(raw);
    expect(out.labels).toEqual(["Consulting the practice library"]);
    expect(out.content).toBe(answer);
    expect(out.content.length).toBe(answer.length); // nothing lost
  });

  it("handles an odd number of delimiters in the answer", () => {
    const answer = `a${PROGRESS_DELIM}b${PROGRESS_DELIM}c${PROGRESS_DELIM}d`;
    expect(splitProgress(encodeProgress("x") + answer).content).toBe(answer);
  });

  it("handles a delimiter as the very last character of the answer", () => {
    const answer = `the end${PROGRESS_DELIM}`;
    expect(splitProgress(encodeProgress("x") + answer).content).toBe(answer);
  });

  it("handles an empty label", () => {
    expect(splitProgress(encodeProgress("") + "answer")).toEqual({
      labels: [""],
      content: "answer",
    });
  });

  it("handles content with no events at all, delimiters included", () => {
    const answer = `plain ${PROGRESS_DELIM} answer`;
    // No LEADING delimiter, so nothing is parsed as an event.
    expect(splitProgress(answer)).toEqual({ labels: [], content: answer });
  });

  it("handles an empty stream", () => {
    expect(splitProgress("")).toEqual({ labels: [], content: "" });
  });
});

describe("stripDelimiters", () => {
  it("removes every delimiter from model-authored content", () => {
    const dirty = `a${PROGRESS_DELIM}b${PROGRESS_DELIM}c`;
    expect(stripDelimiters(dirty)).toBe("abc");
    expect(stripDelimiters(dirty)).not.toContain(PROGRESS_DELIM);
  });

  it("leaves clean content untouched", () => {
    expect(stripDelimiters("a normal answer")).toBe("a normal answer");
  });
});
