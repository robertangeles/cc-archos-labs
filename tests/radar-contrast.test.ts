import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Radar page's colour pairs (plan DES-D10), computed from the real tokens in
// app/globals.css so a token edit cannot silently break legibility. The admin is
// dark only (the light values in that file are for print and PDF), so the first
// definition of each token, the @theme block, is the one that renders.

const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

function token(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6});`).exec(css);
  if (!m) throw new Error(`token --color-${name} not found`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(token(a)), luminance(token(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, what it is]
const TEXT_PAIRS: Array<[string, string, string]> = [
  ["ink", "surface-1", "row title on the day panel"],
  ["ink-subtle", "surface-1", "meta, summary and 12px text on the day panel"],
  ["ink-subtle", "canvas", "status lines and hint on the page"],
  ["ink", "canvas", "status line one"],
  ["on-primary", "primary", "selected Keep"],
  ["primary-hover", "surface-1", "links and Undo on the panel"],
  ["primary-hover", "canvas", "links on the page (Refresh, Open Integrations)"],
  ["semantic-error", "surface-1", "save-failed note"],
  ["semantic-success", "canvas", "healthy dot is always beside text, but the colour must still read"],
  ["semantic-warning", "canvas", "stale dot beside text"],
];

// Outlined controls need 3:1 against what is behind them (WCAG 1.4.11).
const BORDER_PAIRS: Array<[string, string, string]> = [
  ["ink-subtle", "surface-1", "outlined Keep and Skip"],
  ["ink", "surface-1", "selected Skip outline"],
  ["primary", "surface-1", "focus ring"],
];

describe("Radar colour pairs", () => {
  it.each(TEXT_PAIRS)("%s on %s is at least 4.5:1 (%s)", (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BORDER_PAIRS)("%s on %s is at least 3:1 (%s)", (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it("keeps the failures DES-D10 found out of the design", () => {
    // hairline borders are decoration only, never a control border (1.24:1)
    expect(ratio("hairline", "surface-1")).toBeLessThan(3);
    // text-primary links are below 4.5:1, which is why links use primary-hover
    expect(ratio("primary", "surface-1")).toBeLessThan(4.5);
    // ink on primary is below 4.5:1, which is why selected Keep uses on-primary
    expect(ratio("ink", "primary")).toBeLessThan(4.5);
  });
});
