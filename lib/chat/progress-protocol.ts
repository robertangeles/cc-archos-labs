// Wire format for tool-loop progress inside the chat response stream.
//
// A tool-using turn's answer is produced non-streamed, so without this the user
// watches a blank pane for up to 20 seconds (WALL_CLOCK_MS in tool-loop.ts).
// That reads as a hang, and the user aborts before the better answer lands —
// which would make the tool loop feel strictly worse than the shallow-but-
// instant behaviour it replaces.
//
// Events are written into the SAME byte stream ahead of the answer, wrapped in
// U+001F (ASCII unit separator), a control character that cannot occur in
// prose. The client shows them live and strips them from the message it saves.
//
// A sentinel rather than a second channel because the response is a plain byte
// stream read by exactly one consumer (hooks/use-chat.ts). Introducing SSE
// framing or a side channel would be a far larger change for the same result.

export const PROGRESS_DELIM = "\u001F";

export function encodeProgress(label: string): string {
  // Strip any delimiter appearing in the label so a crafted string can never
  // inject a fake event boundary. Labels are server-authored today, but this
  // is the kind of assumption that quietly stops being true.
  return `${PROGRESS_DELIM}${label.split(PROGRESS_DELIM).join("")}${PROGRESS_DELIM}`;
}

/**
 * Strip the delimiter from model-authored content before it enters the stream.
 *
 * Belt to splitProgress's braces. An answer that legitimately contains U+001F
 * — discussing record separators, or emitting one in a code block — would
 * otherwise be parsed as an event boundary. Measured on the first
 * implementation: 40 characters of a real answer silently vanished.
 */
export function stripDelimiters(content: string): string {
  return content.split(PROGRESS_DELIM).join("");
}

/**
 * Split a raw accumulated stream into the progress labels seen so far and the
 * real content.
 *
 * PURE, and shared by the client and the tests, so the two agree by
 * construction rather than by two implementations that look similar.
 *
 * Parses ONLY THE LEADING RUN of complete events. That is safe because the
 * server emits every progress event before the answer (see stream.ts), and it
 * is what makes a stray delimiter inside the answer harmless: once the leading
 * run ends, the rest is content verbatim, delimiters and all.
 *
 * A naive split-on-every-delimiter looked equivalent and lost answer text. It
 * is the kind of bug that only shows up on the one answer that happens to
 * mention a control character.
 */
export function splitProgress(raw: string): { labels: string[]; content: string } {
  const labels: string[] = [];
  let i = 0;

  while (raw[i] === PROGRESS_DELIM) {
    const end = raw.indexOf(PROGRESS_DELIM, i + 1);
    // Opening delimiter with no closing one yet: the event is still arriving.
    // It is neither content nor a completed label — rendering it as either
    // flashes a broken fragment into the message body.
    if (end === -1) return { labels, content: "" };
    labels.push(raw.slice(i + 1, end));
    i = end + 1;
  }

  return { labels, content: raw.slice(i) };
}
