import { describe, expect, it } from "vitest";
import {
  EVENT_DELIM,
  encodeEvent,
  parseStream,
  stripDelimiters,
} from "./stream-events";

// Events share one byte stream with the answer. Getting the split wrong either
// puts control characters into the user's message or loses part of the answer —
// both worse than the blank pane and missing citations this replaces.

describe("parseStream — basics", () => {
  it("returns plain content untouched when there are no events", () => {
    expect(parseStream("a normal answer")).toEqual({
      progress: null,
      sources: [],
      content: "a normal answer",
    });
  });

  it("reads sources and keeps them out of the content", () => {
    const raw =
      encodeEvent({
        t: "s",
        sources: [{ title: "Flawless Consulting", author: "Peter Block" }],
      }) + "Here is the answer.";
    const out = parseStream(raw);
    expect(out.sources).toEqual([
      { title: "Flawless Consulting", author: "Peter Block" },
    ]);
    expect(out.content).toBe("Here is the answer.");
    expect(out.content).not.toContain(EVENT_DELIM);
  });

  it("keeps only the latest progress label", () => {
    const raw =
      encodeEvent({ t: "p", label: "Consulting the practice library" }) +
      encodeEvent({ t: "p", label: "Pulling it together" }) +
      "answer";
    expect(parseStream(raw).progress).toBe("Pulling it together");
  });

  it("carries sources and progress together", () => {
    const raw =
      encodeEvent({ t: "s", sources: [{ title: "DAMA-DMBOK", author: null }] }) +
      encodeEvent({ t: "p", label: "Consulting the practice library" }) +
      "answer";
    const out = parseStream(raw);
    expect(out.sources).toHaveLength(1);
    expect(out.progress).toBe("Consulting the practice library");
    expect(out.content).toBe("answer");
  });
});

describe("parseStream — adversarial", () => {
  // The bug this locks down: an earlier protocol split on EVERY delimiter, so
  // an answer legitimately containing U+001F had everything after it silently
  // dropped. Measured at the time: 40 characters of a real answer vanished.
  it("keeps answer text that itself contains a delimiter", () => {
    const answer = `Use a record separator like ${EVENT_DELIM} to delimit fields. Done.`;
    const raw = encodeEvent({ t: "p", label: "Working" }) + answer;
    const out = parseStream(raw);
    expect(out.content).toBe(answer);
    expect(out.content.length).toBe(answer.length);
  });

  it("ignores an event still arriving", () => {
    const raw = `${EVENT_DELIM}{"t":"p","lab`;
    expect(parseStream(raw)).toEqual({ progress: null, sources: [], content: "" });
  });

  // A malformed event must never take down the reply — it is display metadata,
  // and throwing here would lose the answer over a citation.
  it("skips a malformed event and still returns the answer", () => {
    const raw = `${EVENT_DELIM}not json at all${EVENT_DELIM}the answer`;
    const out = parseStream(raw);
    expect(out.content).toBe("the answer");
    expect(out.sources).toEqual([]);
    expect(out.progress).toBeNull();
  });

  it("skips an event with an unknown type", () => {
    const raw = `${EVENT_DELIM}{"t":"zzz"}${EVENT_DELIM}answer`;
    expect(parseStream(raw).content).toBe("answer");
  });

  it("ignores a sources event whose payload is not an array", () => {
    const raw = `${EVENT_DELIM}{"t":"s","sources":"nope"}${EVENT_DELIM}answer`;
    const out = parseStream(raw);
    expect(out.sources).toEqual([]);
    expect(out.content).toBe("answer");
  });

  it("treats a delimiter after content as content, not an event", () => {
    const raw = `some text${EVENT_DELIM}and more`;
    expect(parseStream(raw).content).toBe(raw);
  });

  it("handles an empty stream", () => {
    expect(parseStream("")).toEqual({ progress: null, sources: [], content: "" });
  });
});

describe("encodeEvent / stripDelimiters", () => {
  it("strips a delimiter smuggled into a payload", () => {
    const encoded = encodeEvent({
      t: "p",
      label: `evil${EVENT_DELIM}injected`,
    });
    // Exactly two delimiters: the boundaries. Nothing inside.
    expect(encoded.split(EVENT_DELIM)).toHaveLength(3);
    expect(parseStream(encoded + "answer").content).toBe("answer");
  });

  it("removes every delimiter from model-authored content", () => {
    expect(stripDelimiters(`a${EVENT_DELIM}b${EVENT_DELIM}c`)).toBe("abc");
  });

  it("round-trips a source with a null author", () => {
    const raw = encodeEvent({ t: "s", sources: [{ title: "T", author: null }] });
    expect(parseStream(raw + "x").sources).toEqual([{ title: "T", author: null }]);
  });
});
