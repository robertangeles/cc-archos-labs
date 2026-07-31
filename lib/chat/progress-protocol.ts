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
 * Split a raw accumulated stream into the progress labels seen so far and the
 * real content.
 *
 * PURE, and shared by the server tests and the client, so the two agree by
 * construction rather than by two implementations that look similar.
 *
 * Handles a partially-arrived event: a trailing unterminated segment is neither
 * content nor a completed label, and must not be rendered as either. Getting
 * that wrong would flash half a label into the message body mid-stream.
 */
export function splitProgress(raw: string): { labels: string[]; content: string } {
  const parts = raw.split(PROGRESS_DELIM);
  const labels: string[] = [];
  let content = "";

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Even segments sit outside any delimiter pair: real content.
      content += parts[i];
    } else if (i < parts.length - 1) {
      // Odd segment with something after it: the closing delimiter arrived.
      labels.push(parts[i]);
    }
    // Odd segment that is last: still streaming. Drop it — it is not content,
    // and it is not yet a complete label.
  }

  return { labels, content };
}
