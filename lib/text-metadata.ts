// Strips invisible Unicode watermark artifacts from pasted text — the ranges
// named in docs/designs/watermark-remover.md (Target User & Narrowest Wedge),
// sourced from Rumi's April 2025 report on OpenAI's o3/o4-mini leaving
// U+202F/U+200B/U+2003 plus the standard invisible/bidi ranges.
//
// Codepoint-aware (regex `u` flag): the tag block (U+E0000-U+E007F) is
// outside the Basic Multilingual Plane and is represented as a UTF-16
// surrogate pair. Matching without `u` operates on code units, not code
// points, and can split a pair — corrupting adjacent text.

import type { Finding } from "./watermark-finding";

export const MAX_TEXT_LENGTH = 2_000_000;

export class TextTooLargeError extends Error {
  constructor(length: number) {
    super(`Input is ${length} characters, over the ${MAX_TEXT_LENGTH} limit`);
    this.name = "TextTooLargeError";
  }
}

interface CodepointRange {
  id: string;
  label: string;
  start: number;
  end: number;
}

const RANGES: CodepointRange[] = [
  { id: "zwsp", label: "Zero-width space", start: 0x200b, end: 0x200b },
  { id: "zwnj", label: "Zero-width non-joiner", start: 0x200c, end: 0x200c },
  { id: "zwj", label: "Zero-width joiner", start: 0x200d, end: 0x200d },
  { id: "word-joiner", label: "Word joiner", start: 0x2060, end: 0x2060 },
  {
    id: "bom",
    label: "Zero-width no-break space (BOM)",
    start: 0xfeff,
    end: 0xfeff,
  },
  {
    id: "nnbsp",
    label: "Narrow no-break space",
    start: 0x202f,
    end: 0x202f,
  },
  { id: "em-space", label: "Em space", start: 0x2003, end: 0x2003 },
  { id: "thin-space", label: "Thin space", start: 0x2009, end: 0x2009 },
  {
    id: "bidi-control",
    label: "Bidirectional control character",
    start: 0x202a,
    end: 0x202e,
  },
  {
    id: "bidi-isolate",
    label: "Bidirectional isolate control",
    start: 0x2066,
    end: 0x2069,
  },
  {
    id: "variation-selector",
    label: "Variation selector",
    start: 0xfe00,
    end: 0xfe0f,
  },
  {
    id: "tag-block",
    label: "Unicode tag character",
    start: 0xe0000,
    end: 0xe007f,
  },
];

function toPattern(range: CodepointRange): string {
  const start = range.start.toString(16);
  if (range.start === range.end) return `\\u{${start}}`;
  return `[\\u{${start}}-\\u{${range.end.toString(16)}}]`;
}

const STRIP_REGEX = new RegExp(RANGES.map(toPattern).join("|"), "gu");

export interface TextStripResult {
  cleaned: string;
  findings: Finding[];
}

export function stripText(input: string): TextStripResult {
  if (typeof input !== "string") {
    throw new TypeError("stripText expects a string");
  }
  if (input.length > MAX_TEXT_LENGTH) {
    throw new TextTooLargeError(input.length);
  }

  const counts = new Map<string, number>();
  const cleaned = input.replace(STRIP_REGEX, (match) => {
    const codepoint = match.codePointAt(0);
    const range = RANGES.find(
      (r) => codepoint !== undefined && codepoint >= r.start && codepoint <= r.end,
    );
    if (range) counts.set(range.id, (counts.get(range.id) ?? 0) + 1);
    return "";
  });

  const findings: Finding[] = RANGES.filter((r) => counts.has(r.id)).map(
    (r) => {
      const count = counts.get(r.id) ?? 0;
      return {
        id: r.id,
        label: r.label,
        detail: `${count} occurrence${count === 1 ? "" : "s"}`,
      };
    },
  );

  return { cleaned, findings };
}
