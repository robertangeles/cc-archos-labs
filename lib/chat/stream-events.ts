// Out-of-band events carried inside the chat response byte stream.
//
// Two kinds so far:
//   progress  transient status while a tool-using turn works (its answer is
//             not streamed, so without this the pane is blank for up to 20s)
//   sources   which works the answer was grounded in, for the citation strip
//
// Both are emitted BEFORE the answer and wrapped in U+001F (ASCII unit
// separator), a control character that cannot occur in prose. The client reads
// them, renders them, and keeps them out of the message text.
//
// Only the LEADING run is parsed as events. That is what makes a stray
// delimiter inside the answer harmless — an earlier version split on every
// delimiter and silently ate 40 characters of a real answer that happened to
// mention a record separator.
//
// A sentinel rather than a second channel because the response is a plain byte
// stream read by exactly one consumer (hooks/use-chat.ts); SSE framing would be
// a far larger change for the same result.

export const EVENT_DELIM = "\u001F";

/** A work the answer drew on. Rendered under the answer as the citation strip. */
export interface SourceRef {
  title: string;
  author: string | null;
}

export type StreamEvent =
  | { t: "p"; label: string }
  | { t: "s"; sources: SourceRef[] };

export function encodeEvent(e: StreamEvent): string {
  // Strip the delimiter from the payload so a crafted string can never inject a
  // fake event boundary. Server-authored today; that is the kind of assumption
  // that quietly stops being true.
  const body = JSON.stringify(e).split(EVENT_DELIM).join("");
  return `${EVENT_DELIM}${body}${EVENT_DELIM}`;
}

/** Remove delimiters from model-authored content before it enters the stream. */
export function stripDelimiters(content: string): string {
  return content.split(EVENT_DELIM).join("");
}

export interface ParsedStream {
  /** Latest progress label, or null. Transient — not persisted. */
  progress: string | null;
  /** Works the answer drew on. Empty when the turn was not grounded, or when
   *  the audience is not allowed to see them. */
  sources: SourceRef[];
  /** The answer itself, verbatim. */
  content: string;
}

/**
 * Split a raw accumulated stream into its events and the answer.
 *
 * PURE, and shared by the client and the tests, so the two agree by
 * construction rather than by two implementations that look similar.
 *
 * A malformed event is skipped rather than thrown on: a parse error here would
 * take down the whole reply over a display concern.
 */
export function parseStream(raw: string): ParsedStream {
  let progress: string | null = null;
  const sources: SourceRef[] = [];
  let i = 0;

  while (raw[i] === EVENT_DELIM) {
    const end = raw.indexOf(EVENT_DELIM, i + 1);
    // Opening delimiter with no close yet: the event is still arriving. It is
    // neither content nor a complete event — rendering it as either flashes a
    // broken fragment into the message body.
    if (end === -1) return { progress, sources, content: "" };

    const body = raw.slice(i + 1, end);
    try {
      const e = JSON.parse(body) as StreamEvent;
      if (e.t === "p") progress = e.label;
      else if (e.t === "s" && Array.isArray(e.sources)) sources.push(...e.sources);
    } catch {
      // Malformed event — ignore it. Never throw: this is display metadata,
      // and losing the answer over it would be a far worse failure.
    }
    i = end + 1;
  }

  return { progress, sources, content: raw.slice(i) };
}
