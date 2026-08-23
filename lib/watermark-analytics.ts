// Typed wrapper around lib/analytics.ts, scoped to the watermark remover
// tool. The whole point of the tool's client-side architecture is "we never
// see your content" (docs/designs/watermark-remover.md, Premise 4) — this
// wrapper's prop types are the enforcement mechanism: no field here can ever
// carry a filename, a finding's raw value, or file content. TypeScript
// rejects any extra property at the call site (no index signature), so a
// future call site accidentally passing e.g. `filename` fails to compile.

import { track } from "./analytics";

export type WatermarkSource = "text" | "jpeg" | "png";
export type WatermarkInputKind = "text" | "image";

export interface WatermarkParseProps {
  source: WatermarkSource;
  findingsCount: number;
  stripped: boolean;
}

export function trackWatermarkParseCompleted(props: WatermarkParseProps): void {
  // Spread into a fresh object literal: TypeScript structurally checks a
  // literal against Record<string, X> even without an index signature on
  // WatermarkParseProps — passing the typed variable directly does not.
  track("watermark.parse.completed", { ...props });
}

// Format isn't always known on failure (e.g. the file wasn't even a
// recognizable JPEG/PNG), so this only ever distinguishes text vs. image.
export function trackWatermarkParseFailed(kind: WatermarkInputKind): void {
  track("watermark.parse.failed", { source: kind });
}
